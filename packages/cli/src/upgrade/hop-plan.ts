import { spawnSync, type SpawnSyncReturns } from "node:child_process";

import { CliError, CliErrorCode } from "../errors/cli-error";
import { CLI_PACKAGE_NAME } from "../version";

import { STRANDED_PUBLISHED_RELEASE_BRIDGES } from "./release-constants";
import { type CommandRunner, pnpmExecutable } from "./release-discovery";
import { compareAtlasVersions, isExactAtlasReleaseVersion } from "./version-compare";

export interface ReleaseBridge {
  faultyRelease: string;
  strandedSources: readonly string[];
}

/**
 * Ordered upgrade hops from `sourceVersion` to `targetVersion`.
 *
 * Every published Atlas CLI supports upgrades from its immediately previous npm-published
 * release (plus declared recovery bridges). A consumer more than one release behind therefore
 * walks the published releases in order. A hop is skipped when a recovery bridge says that
 * release's catalog stranded the current source; the next published release accepts it.
 *
 * Returns `[targetVersion]` (a single direct hop) when the target is not an npm-published
 * release, so explicit `--to` behavior and its errors stay unchanged.
 */
export function planUpgradeHops(options: {
  sourceVersion: string;
  targetVersion: string;
  publishedVersions: readonly string[];
  bridges?: readonly ReleaseBridge[];
}): string[] {
  const { sourceVersion, targetVersion } = options;
  const bridges = options.bridges ?? STRANDED_PUBLISHED_RELEASE_BRIDGES;
  const published = [
    ...new Set(options.publishedVersions.filter((version) => isExactAtlasReleaseVersion(version))),
  ].sort(compareAtlasVersions);

  if (
    compareAtlasVersions(sourceVersion, targetVersion) >= 0 ||
    !published.includes(targetVersion)
  ) {
    return [targetVersion];
  }

  const hops: string[] = [];
  let current = sourceVersion;
  while (current !== targetVersion) {
    const from = current;
    const next = published.find(
      (version) =>
        compareAtlasVersions(version, from) > 0 &&
        compareAtlasVersions(version, targetVersion) <= 0 &&
        !bridges.some(
          (bridge) => bridge.faultyRelease === version && bridge.strandedSources.includes(from)
        )
    );
    if (!next) {
      throw new CliError(
        CliErrorCode.UPGRADE_PREREQUISITE,
        `No published upgrade path from Atlas ${from} to ${targetVersion}.`
      );
    }
    hops.push(next);
    current = next;
  }
  return hops;
}

export function formatHopPath(sourceVersion: string, hops: readonly string[]): string {
  return [sourceVersion, ...hops].join(" → ");
}

export function parsePublishedVersionsOutput(stdout: string): string[] {
  const parsed = JSON.parse(stdout.trim() || "[]") as unknown;
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.filter(
    (value): value is string => typeof value === "string" && isExactAtlasReleaseVersion(value)
  );
}

/** All npm-published versions of the Atlas CLI, via `pnpm view <pkg> versions --json`. */
export function discoverPublishedReleases(options: {
  cwd: string;
  spawn?: CommandRunner;
  env?: NodeJS.ProcessEnv;
}): string[] {
  const spawn = options.spawn ?? spawnSync;
  const result = spawn(pnpmExecutable(), ["view", CLI_PACKAGE_NAME, "versions", "--json"], {
    cwd: options.cwd,
    encoding: "utf8",
    shell: false,
    env: options.env ?? process.env,
  }) as SpawnSyncReturns<string>;
  if (result.error || result.status !== 0) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Could not list published ${CLI_PACKAGE_NAME} releases to plan a multi-release upgrade.`,
      { details: [String(result.stderr || result.stdout || result.error?.message || "")] }
    );
  }
  return parsePublishedVersionsOutput(String(result.stdout ?? ""));
}
