import path from "node:path";

import { readAtlasProjectContractFile } from "@atlas/project";

import { CliError, CliErrorCode } from "../errors/cli-error";
import { writeCommandSuccess } from "../output/write";
import { resolveRepoRootFromOptions } from "../project/find-root";
import { readContractPlatformBaseline } from "../upgrade/baseline";
import {
  ATLAS_UPGRADE_HANDOFF_ENV,
  decideUpgradeHandoff,
  executeUpgradeHandoff,
  isUpgradeHandoffChild,
} from "../upgrade/cli-handoff";
import { repairStaleWorkspaceVersions } from "../upgrade/hop-normalize";
import { discoverPublishedReleases, formatHopPath, planUpgradeHops } from "../upgrade/hop-plan";
import {
  type CommandRunner,
  discoverLatestPublishedRelease,
  LATEST_RELEASE_DISCOVERY_ERROR,
} from "../upgrade/release-discovery";
import { runUpgrade } from "../upgrade/run";
import { assertExactAtlasReleaseVersion, compareAtlasVersions } from "../upgrade/version-compare";
import { assertCleanWorktreeForMutation } from "../upgrade/worktree";
import { readCliAtlasVersion } from "../version";

import type { OutputWriter } from "../output/write";
import type { UpgradeRunResult } from "../upgrade/types";

export interface UpgradeCommandOptions {
  cwd?: string;
  targetVersion?: string;
  dryRun?: boolean;
  allowDirty?: boolean;
  merge?: boolean;
  json?: boolean;
  releasesDir?: string;
  skipValidation?: boolean;
  writer: OutputWriter;
  runningVersion?: string;
  env?: NodeJS.ProcessEnv;
  spawn?: CommandRunner;
  resolveLatest?: (options: { cwd: string }) => string;
  resolvePublished?: (options: { cwd: string }) => string[];
  assertCleanWorktree?: (options: { repoRoot: string; allowDirty: boolean }) => void;
}

export function formatUpgradeHumanResult(result: UpgradeRunResult): string[] {
  const lines = [
    `Current baseline: ${result.sourceVersion}`,
    ...(result.latestStable ? [`Latest stable: ${result.latestStable}`] : []),
    `Target: ${result.targetVersion}`,
    ...(result.hops && result.hops.length > 1
      ? [`Upgrade path: ${formatHopPath(result.sourceVersion, result.hops)}`]
      : []),
    `Mode: ${result.mode}`,
    `Status: ${result.status}`,
    "",
    `Safe replacements: ${result.summary.replacements}`,
    `Package updates: ${result.summary.packageUpdates}`,
    `Generated surfaces: ${result.summary.regenerations}`,
    `Migrations: ${result.migrations.length}`,
    `Conflicts: ${result.conflicts.length}`,
    `Manual reviews: ${result.summary.manual}`,
  ];

  if (result.messages.length > 0) {
    lines.push("");
    for (const message of result.messages) {
      lines.push(message);
    }
  }

  if (result.items.length > 0) {
    lines.push("");
    lines.push("Plan items:");
    for (const item of result.items) {
      if (item.manifestChange && item.action !== "skip") {
        const from = item.manifestChange.sourceValue ?? "(absent)";
        const to =
          item.manifestChange.operation === "remove"
            ? "(removed)"
            : (item.manifestChange.targetValue ?? "(absent)");
        lines.push(`  - ${item.relativePath}:`);
        lines.push(`      ${from} → ${to}`);
        lines.push(`      ${item.category}${item.manifestChange.recovery ? " recovery" : ""}`);
        continue;
      }
      const flags = [item.action, item.category, item.conflict ? "conflict" : "ok"].join(" | ");
      lines.push(`  - ${item.relativePath}: ${flags}`);
    }
  }

  if (result.conflicts.length > 0) {
    lines.push("");
    lines.push("Blocking conflicts:");
    for (const conflict of result.conflicts) {
      lines.push(`  - ${conflict.relativePath}: ${conflict.message}`);
    }
  }

  if (result.appliedPaths.length > 0) {
    lines.push("");
    lines.push(`Applied paths (${result.appliedPaths.length}):`);
    for (const appliedPath of result.appliedPaths) {
      lines.push(`  - ${appliedPath}`);
    }
  }

  lines.push("");
  lines.push(`Baseline updated: ${result.baselineUpdated ? "yes" : "no"}`);

  return lines;
}

export function upgradeExitCodeFromResult(result: UpgradeRunResult): number {
  switch (result.status) {
    case "success":
    case "already-current":
    case "planned":
      return 0;
    case "blocked":
      return 9;
    case "validation-failed":
    case "migration-failed":
      return 8;
    case "failed":
      return 1;
    default:
      return 1;
  }
}

export function writeUpgradeHelp(writer: OutputWriter, json: boolean): void {
  const lines = [
    "Atlas upgrade — plan and apply supported Atlas release upgrades",
    "",
    "Upgrades respect ownership channels and platform.baseline checksum evidence.",
    "Consumer-owned and modified synced paths are never overwritten automatically.",
    "Production release evidence is loaded from the installed @blitzcraftlabs/atlas package.",
    "When the baseline is more than one published release behind, the upgrade walks each",
    "published release in order and stops at the first hop that needs attention.",
    "",
    "Usage:",
    "  atlas upgrade [--to <version>] [options]",
    "",
    "Options:",
    "  --to <version>       Upgrade to an exact Atlas release (default: latest stable)",
    "  --dry-run            Plan without filesystem mutations",
    "  --json               Emit machine-readable JSON on stdout",
    "  --allow-dirty        Allow mutations on a dirty Git worktree (use with caution)",
    "  --merge              Apply clean three-way merges for files you modified; write",
    "                       conflict-marked .atlas/merge/<path>.merge sidecars otherwise",
    "  --skip-validation    Expert/test escape hatch: skip post-upgrade atlas doctor only (migrations, package updates, and baseline capture still run)",
    "  --releases-dir <dir> Explicit fixture/maintainer override for release snapshots",
    "  --cwd <path>         Resolve the Atlas repository from a starting directory",
    "",
    "Exit behavior:",
    "  0 — successful dry-run or completed upgrade",
    "  9 — blocking conflicts in plan",
    "  10 — missing baseline, packaged snapshot, unsupported version, or migration chain",
    "  8 — post-upgrade validation failed",
    "",
    "See docs/how-we-build/upgrades.md for ownership, support window, and conflict policy.",
  ];

  if (json) {
    writer.writeStdout(
      JSON.stringify({
        ok: true,
        command: "upgrade-help",
        result: { lines },
      })
    );
    return;
  }

  for (const line of lines) {
    writer.writeStdout(line);
  }
}

export async function runUpgradeCommand(options: UpgradeCommandOptions): Promise<number> {
  const repoRoot = resolveRepoRootFromOptions({ cwd: options.cwd });
  const releasesDir = options.releasesDir
    ? path.resolve(options.cwd ?? process.cwd(), options.releasesDir)
    : undefined;
  const contract = readAtlasProjectContractFile(repoRoot);
  const baseline = readContractPlatformBaseline(contract);
  if (!baseline) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      "platform.baseline is missing from atlas.config.json. Record a baseline via atlas init before upgrading."
    );
  }

  const runningVersion = options.runningVersion ?? readCliAtlasVersion();
  const env = options.env ?? process.env;
  const handoffChild = isUpgradeHandoffChild(env);
  const sourceVersion = baseline.atlasVersion;

  let targetVersion = options.targetVersion;
  let latestStable: string | undefined;
  let targetResolution: UpgradeRunResult["targetResolution"];

  if (targetVersion) {
    try {
      targetVersion = assertExactAtlasReleaseVersion(targetVersion, "--to");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid --to version.";
      throw new CliError(CliErrorCode.USAGE_ERROR, message);
    }
    targetResolution = "explicit";
  } else {
    targetResolution = "latest";
    try {
      latestStable = options.resolveLatest
        ? options.resolveLatest({ cwd: repoRoot })
        : discoverLatestPublishedRelease({ cwd: repoRoot, spawn: options.spawn, env });
    } catch (error) {
      if (error instanceof CliError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "Registry query failed.";
      throw new CliError(CliErrorCode.UPGRADE_PREREQUISITE, LATEST_RELEASE_DISCOVERY_ERROR, {
        details: [message],
      });
    }
    targetVersion = latestStable;
  }

  if (compareAtlasVersions(sourceVersion, targetVersion) > 0) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Downgrade from Atlas ${sourceVersion} to ${targetVersion} is not supported.`
    );
  }

  const decision = decideUpgradeHandoff({
    runningVersion,
    targetVersion,
    handoffChild,
  });
  if (decision === "refuse-recursion") {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Refusing to launch another Atlas CLI. This process is already the ${ATLAS_UPGRADE_HANDOFF_ENV} target, but it is Atlas ${runningVersion} rather than ${targetVersion}.`
    );
  }

  if (compareAtlasVersions(sourceVersion, targetVersion) === 0) {
    const result: UpgradeRunResult = {
      sourceVersion,
      targetVersion,
      mode: options.dryRun ? "dry-run" : "apply",
      status: "already-current",
      summary: {
        patchSafe: 0,
        mergeRequired: 0,
        migrationRequired: 0,
        manual: 0,
        securityCritical: 0,
        skipped: 0,
        packageUpdates: 0,
        regenerations: 0,
        replacements: 0,
      },
      items: [],
      conflicts: [],
      migrations: [],
      validation: { doctor: "skipped", apiGen: "skipped" },
      baselineUpdated: false,
      appliedPaths: [],
      messages: [`Atlas is already current (${sourceVersion}).`],
      latestStable,
      targetResolution,
      dependencyInstall: "not-run",
    };
    writeCommandSuccess(
      options.writer,
      "upgrade",
      result,
      options.json ?? false,
      formatUpgradeHumanResult
    );
    return upgradeExitCodeFromResult(result);
  }

  if (!handoffChild && !releasesDir) {
    const { hops, published } = planHops({ options, repoRoot, sourceVersion, targetVersion, env });
    if (hops.length > 1) {
      return runMultiHopUpgrade({
        options,
        repoRoot,
        sourceVersion,
        targetVersion,
        hops,
        published,
        env,
        latestStable,
        targetResolution,
      });
    }
  }

  if (decision === "handoff" && !releasesDir) {
    const handoff = executeUpgradeHandoff({
      request: {
        repoRoot,
        targetVersion,
        dryRun: options.dryRun,
        json: options.json,
        allowDirty: options.allowDirty,
        merge: options.merge,
        skipValidation: options.skipValidation,
        releasesDir,
      },
      spawn: options.spawn,
      env,
      stdio: options.spawn ? "pipe" : "inherit",
    });
    if (handoff.signal && !options.spawn) {
      process.kill(process.pid, handoff.signal);
    }
    return handoff.exitCode;
  }

  const result = await runUpgrade({
    repoRoot,
    targetVersion,
    dryRun: options.dryRun,
    allowDirty: options.allowDirty,
    merge: options.merge,
    releasesDir,
    skipValidation: options.skipValidation,
  });
  result.latestStable = latestStable;
  result.targetResolution = targetResolution;

  writeCommandSuccess(
    options.writer,
    "upgrade",
    result,
    options.json ?? false,
    formatUpgradeHumanResult
  );

  return upgradeExitCodeFromResult(result);
}

function planHops(input: {
  options: UpgradeCommandOptions;
  repoRoot: string;
  sourceVersion: string;
  targetVersion: string;
  env: NodeJS.ProcessEnv;
}): { hops: string[]; published: string[] } {
  const { options, repoRoot, sourceVersion, targetVersion, env } = input;
  let published: string[];
  try {
    published = options.resolvePublished
      ? options.resolvePublished({ cwd: repoRoot })
      : discoverPublishedReleases({ cwd: repoRoot, spawn: options.spawn, env });
  } catch {
    // Without the published list, keep the direct (adjacent) behavior and its errors.
    return { hops: [targetVersion], published: [] };
  }
  return {
    hops: planUpgradeHops({ sourceVersion, targetVersion, publishedVersions: published }),
    published,
  };
}

function emptySummary(): UpgradeRunResult["summary"] {
  return {
    patchSafe: 0,
    mergeRequired: 0,
    migrationRequired: 0,
    manual: 0,
    securityCritical: 0,
    skipped: 0,
    packageUpdates: 0,
    regenerations: 0,
    replacements: 0,
  };
}

/**
 * Walk published releases one hop at a time. Each hop runs that release's CLI
 * (`pnpm dlx @blitzcraftlabs/atlas@<hop> upgrade --to <hop>`), which applies, installs,
 * validates with Doctor, and only then advances platform.baseline. The walk stops at the
 * first hop that does not succeed; rerunning `atlas upgrade` resumes from the new baseline.
 */
function runMultiHopUpgrade(input: {
  options: UpgradeCommandOptions;
  repoRoot: string;
  sourceVersion: string;
  targetVersion: string;
  hops: string[];
  published: string[];
  env: NodeJS.ProcessEnv;
  latestStable?: string;
  targetResolution: UpgradeRunResult["targetResolution"];
}): number {
  const { options, repoRoot, sourceVersion, targetVersion, hops, env } = input;
  const json = options.json ?? false;
  const path = formatHopPath(sourceVersion, hops);
  const base: UpgradeRunResult = {
    sourceVersion,
    targetVersion,
    mode: options.dryRun ? "dry-run" : "apply",
    status: "planned",
    summary: emptySummary(),
    items: [],
    conflicts: [],
    migrations: [],
    validation: { doctor: "skipped", apiGen: "skipped" },
    baselineUpdated: false,
    appliedPaths: [],
    messages: [],
    latestStable: input.latestStable,
    targetResolution: input.targetResolution,
    dependencyInstall: "not-run",
    hops,
    hopResults: [],
  };

  const knownAtlasVersions = [...input.published, sourceVersion];
  if (options.dryRun) {
    for (const repair of repairStaleWorkspaceVersions({
      repoRoot,
      baselineVersion: sourceVersion,
      knownAtlasVersions,
      dryRun: true,
    })) {
      base.messages.push(
        `Will align ${repair.relativePath}#version ${repair.from} → ${repair.to} (left behind by an older Atlas CLI).`
      );
    }
    base.messages.push(
      `Atlas ${sourceVersion} is ${hops.length} published releases behind ${targetVersion}.`,
      `Upgrade path: ${path}`,
      "Each hop runs that release's CLI and advances platform.baseline only after Doctor passes.",
      `File-level plan for the first hop: pnpm atlas upgrade --to ${hops[0]} --dry-run`
    );
    writeCommandSuccess(options.writer, "upgrade", base, json, formatUpgradeHumanResult);
    return 0;
  }

  (options.assertCleanWorktree ?? assertCleanWorktreeForMutation)({
    repoRoot,
    allowDirty: options.allowDirty ?? false,
  });

  if (!json) {
    options.writer.writeStderr(`Upgrade path: ${path}`);
  }

  let reached = sourceVersion;
  let repairedBeforeFirstHop = false;
  for (const [index, hop] of hops.entries()) {
    if (!json) {
      options.writer.writeStderr(`\n[${index + 1}/${hops.length}] Atlas ${reached} → ${hop}`);
    }
    const repairs = repairStaleWorkspaceVersions({
      repoRoot,
      baselineVersion: reached,
      knownAtlasVersions,
    });
    if (index === 0 && repairs.length > 0) {
      repairedBeforeFirstHop = true;
    }
    for (const repair of repairs) {
      base.messages.push(
        `Aligned ${repair.relativePath}#version ${repair.from} → ${repair.to} before the ${hop} hop (left behind by an older Atlas CLI).`
      );
    }
    const handoff = executeUpgradeHandoff({
      request: {
        repoRoot,
        targetVersion: hop,
        json,
        // Later hops start from the previous hop's uncommitted changes. Cleanliness was
        // checked once before the first hop.
        allowDirty: index > 0 || repairedBeforeFirstHop ? true : options.allowDirty,
        skipValidation: options.skipValidation,
      },
      spawn: options.spawn,
      env,
      stdio: json || options.spawn ? "pipe" : "inherit",
    });
    base.hopResults?.push({
      targetVersion: hop,
      exitCode: handoff.exitCode,
      result: json ? parseChildJson(handoff.stdout) : undefined,
    });
    if (handoff.exitCode !== 0) {
      base.status = handoff.exitCode === 9 ? "blocked" : "failed";
      base.sourceVersion = sourceVersion;
      base.baselineUpdated = reached !== sourceVersion;
      base.messages.push(
        `Stopped at hop ${index + 1}/${hops.length} (Atlas ${reached} → ${hop}).`,
        `platform.baseline is ${reached}. Resolve the reported issues, commit, and rerun pnpm atlas upgrade to continue.`
      );
      writeCommandSuccess(options.writer, "upgrade", base, json, formatUpgradeHumanResult);
      return handoff.exitCode;
    }
    reached = hop;
  }

  base.status = "success";
  base.baselineUpdated = true;
  base.messages.push(`Upgraded Atlas ${path}.`);
  writeCommandSuccess(options.writer, "upgrade", base, json, formatUpgradeHumanResult);
  return 0;
}

/** Last JSON line of a hop's stdout; `pnpm dlx` progress lines can precede the envelope. */
export function parseChildJson(stdout: string | undefined): unknown {
  if (!stdout) return undefined;
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .reverse();
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as { result?: unknown };
      return parsed.result ?? parsed;
    } catch {
      // keep looking
    }
  }
  return undefined;
}
