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
import {
  type CommandRunner,
  discoverLatestPublishedRelease,
  LATEST_RELEASE_DISCOVERY_ERROR,
} from "../upgrade/release-discovery";
import { runUpgrade } from "../upgrade/run";
import { assertExactAtlasReleaseVersion, compareAtlasVersions } from "../upgrade/version-compare";
import { readCliAtlasVersion } from "../version";

import type { OutputWriter } from "../output/write";
import type { UpgradeRunResult } from "../upgrade/types";

export interface UpgradeCommandOptions {
  cwd?: string;
  targetVersion?: string;
  dryRun?: boolean;
  allowDirty?: boolean;
  json?: boolean;
  releasesDir?: string;
  skipValidation?: boolean;
  writer: OutputWriter;
  runningVersion?: string;
  env?: NodeJS.ProcessEnv;
  spawn?: CommandRunner;
  resolveLatest?: (options: { cwd: string }) => string;
}

export function formatUpgradeHumanResult(result: UpgradeRunResult): string[] {
  const lines = [
    `Current baseline: ${result.sourceVersion}`,
    ...(result.latestStable ? [`Latest stable: ${result.latestStable}`] : []),
    `Target: ${result.targetVersion}`,
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
    "",
    "Usage:",
    "  atlas upgrade [--to <version>] [options]",
    "",
    "Options:",
    "  --to <version>       Upgrade to an exact Atlas release (default: latest stable)",
    "  --dry-run            Plan without filesystem mutations",
    "  --json               Emit machine-readable JSON on stdout",
    "  --allow-dirty        Allow mutations on a dirty Git worktree (use with caution)",
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

  if (decision === "handoff" && !releasesDir) {
    const handoff = executeUpgradeHandoff({
      request: {
        repoRoot,
        targetVersion,
        dryRun: options.dryRun,
        json: options.json,
        allowDirty: options.allowDirty,
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
