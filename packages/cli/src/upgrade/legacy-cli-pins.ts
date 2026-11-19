import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { CLI_PACKAGE_NAME } from "../version";

import { compareAtlasVersions, isExactAtlasReleaseVersion } from "./version-compare";

import type { UpgradePlanItem } from "./types";

/**
 * Projects generated before Atlas 1.3.0 called the CLI through a version pin written into files the
 * consumer owns (`pnpm dlx @blitzcraftlabs/atlas@1.2.2 doctor` in CI and docs). Upgrades never
 * rewrite consumer-owned files, so those pins outlive the upgrade. Once the contract changes, the old
 * CLI cannot parse atlas.config.json and CI fails right after a clean upgrade.
 *
 * This module finds those pins so Doctor and `atlas upgrade` can report them. It never edits files.
 */

export type CliReferenceScope = "workflow" | "documentation";

export interface LegacyCliPin {
  relativePath: string;
  scope: CliReferenceScope;
  line: number;
  column: number;
  /** Pinned CLI version, e.g. "1.2.2". */
  version: string;
  /** Atlas command after the package spec, e.g. "doctor" (absent when none follows). */
  command?: string;
  /** True when the pinned version is older than the version the project expects. */
  olderThanExpected: boolean;
}

const DOCUMENTATION_FILES = ["README.md", "AGENTS.md"];
const DOCUMENTATION_DIRECTORY = "docs/how-we-build";
const WORKFLOW_DIRECTORY = ".github/workflows";

/**
 * `@blitzcraftlabs/atlas@1.2.2` with a concrete version (CLI_PACKAGE_NAME).
 * Placeholders like `@<version>` or `@latest` do not match.
 */
const PINNED_SPEC = /@blitzcraftlabs\/atlas@(\d+\.\d+\.\d+)(?![\d.])/g;
/** Optional prerelease suffix right after the version core, e.g. `-rc.1`. */
const PRERELEASE_SUFFIX = /^-[0-9A-Za-z.-]*[0-9A-Za-z]/;
/** A package runner earlier on the same line, so prose and changelog mentions are not flagged. */
const RUNNER_BEFORE =
  /(?:\bpnpm\s+dlx|\bpnpx|\bnpx|\b(?:pnpm|npm)\s+exec|\byarn\s+dlx|\bbunx)\b[^`'"]*$/;

function listFiles(repoRoot: string, directory: string, extensions: string[]): string[] {
  const absolute = path.join(repoRoot, directory);
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
    return [];
  }
  return readdirSync(absolute)
    .filter((name) => extensions.some((extension) => name.endsWith(extension)))
    .filter((name) => statSync(path.join(absolute, name)).isFile())
    .sort()
    .map((name) => path.posix.join(directory, name));
}

/** Consumer-owned files that commonly invoke the Atlas CLI. */
export function listCliReferenceFiles(
  repoRoot: string
): { relativePath: string; scope: CliReferenceScope }[] {
  const documentation = [
    ...DOCUMENTATION_FILES.filter((file) => existsSync(path.join(repoRoot, file))),
    ...listFiles(repoRoot, DOCUMENTATION_DIRECTORY, [".md"]),
  ];
  return [
    ...listFiles(repoRoot, WORKFLOW_DIRECTORY, [".yml", ".yaml"]).map((relativePath) => ({
      relativePath,
      scope: "workflow" as const,
    })),
    ...documentation.map((relativePath) => ({ relativePath, scope: "documentation" as const })),
  ];
}

function isOlder(version: string, expectedVersion: string): boolean {
  try {
    return compareAtlasVersions(version, expectedVersion) < 0;
  } catch {
    return false;
  }
}

/** Find pinned CLI invocations in `content` whose version differs from `expectedVersion`. */
export function findPinnedCliInvocations(
  content: string,
  expectedVersion: string
): Omit<LegacyCliPin, "relativePath" | "scope">[] {
  const pins: Omit<LegacyCliPin, "relativePath" | "scope">[] = [];
  const lines = content.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(PINNED_SPEC)) {
      const start = match.index ?? 0;
      if (!RUNNER_BEFORE.test(line.slice(0, start))) {
        continue;
      }
      const prerelease = PRERELEASE_SUFFIX.exec(line.slice(start + match[0].length))?.[0] ?? "";
      const version = `${match[1] ?? ""}${prerelease}`;
      if (version === expectedVersion) {
        continue;
      }
      const rest = line.slice(start + match[0].length + prerelease.length);
      const command = /^\s+([a-z][a-z-]*)\b/.exec(rest)?.[1];
      // `pnpm dlx @blitzcraftlabs/atlas@1.3.1 upgrade --to 1.3.1` is a deliberate one-release
      // upgrade step, not a stale pin.
      const upgradeTarget = /--to(?:\s+|=)([^\s`'"]+)/.exec(rest)?.[1];
      if (command === "upgrade" && upgradeTarget === version) {
        continue;
      }
      pins.push({
        line: index + 1,
        column: start + 1,
        version,
        command,
        olderThanExpected: isOlder(version, expectedVersion),
      });
    }
  }

  return pins;
}

/** Scan consumer-owned CI workflows and docs for CLI pins that differ from `expectedVersion`. */
export function findLegacyCliPins(options: {
  repoRoot: string;
  expectedVersion: string;
}): LegacyCliPin[] {
  const pins: LegacyCliPin[] = [];
  for (const file of listCliReferenceFiles(options.repoRoot)) {
    let content: string;
    try {
      content = readFileSync(path.join(options.repoRoot, file.relativePath), "utf8");
    } catch {
      continue;
    }
    for (const pin of findPinnedCliInvocations(content, options.expectedVersion)) {
      pins.push({ relativePath: file.relativePath, scope: file.scope, ...pin });
    }
  }
  return pins;
}

/** Exact `@blitzcraftlabs/atlas` version pinned in the root package.json, if any. */
export function readConsumerCliPin(repoRoot: string): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    const spec =
      manifest.devDependencies?.[CLI_PACKAGE_NAME] ?? manifest.dependencies?.[CLI_PACKAGE_NAME];
    return typeof spec === "string" && isExactAtlasReleaseVersion(spec) ? spec : undefined;
  } catch {
    return undefined;
  }
}

export function describeLegacyCliPin(pin: LegacyCliPin): string {
  const invocation = `${CLI_PACKAGE_NAME}@${pin.version}${pin.command ? ` ${pin.command}` : ""}`;
  return `${pin.relativePath}:${pin.line} runs ${invocation}`;
}

/**
 * Non-blocking upgrade review items for consumer-owned files that will keep running an old CLI after
 * the upgrade pins `@blitzcraftlabs/atlas@<targetVersion>`. One item per file.
 */
export function planLegacyCliPinReview(options: {
  repoRoot: string;
  sourceVersion: string;
  targetVersion: string;
}): { items: UpgradePlanItem[]; messages: string[] } {
  const pins = findLegacyCliPins({
    repoRoot: options.repoRoot,
    expectedVersion: options.targetVersion,
  });
  if (pins.length === 0) {
    return { items: [], messages: [] };
  }

  const byFile = new Map<string, LegacyCliPin[]>();
  for (const pin of pins) {
    byFile.set(pin.relativePath, [...(byFile.get(pin.relativePath) ?? []), pin]);
  }

  const items: UpgradePlanItem[] = [...byFile.entries()].map(([relativePath, filePins]) => ({
    relativePath,
    ownershipChannel: "consumer-owned-source",
    category: "manual",
    action: "manual-review",
    message: `Consumer-owned file still runs a pinned Atlas CLI (${filePins
      .map((pin) => `line ${pin.line}: ${CLI_PACKAGE_NAME}@${pin.version}`)
      .join(", ")}). Replace with \`pnpm atlas <command>\`; Atlas does not rewrite this file.`,
    conflict: false,
    securityCritical: false,
    sourceVersion: options.sourceVersion,
    targetVersion: options.targetVersion,
    pathScope: "repository",
  }));

  const files = [...byFile.keys()];
  return {
    items,
    messages: [
      `${files.length} consumer-owned file${files.length === 1 ? "" : "s"} still run${
        files.length === 1 ? "s" : ""
      } a pinned Atlas CLI instead of \`pnpm atlas\`: ${files.join(", ")}. ` +
        `After this upgrade they would keep running an older CLI that may not parse atlas.config.json. ` +
        `Replace each \`pnpm dlx ${CLI_PACKAGE_NAME}@<version> <command>\` with \`pnpm atlas <command>\` ` +
        `(see "Post-upgrade: consumer-owned CLI references" in docs/how-we-build/upgrades.md).`,
    ],
  };
}
