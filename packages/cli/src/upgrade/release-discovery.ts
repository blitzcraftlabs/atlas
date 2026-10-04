import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";

import { CliError, CliErrorCode } from "../errors/cli-error";
import { CLI_PACKAGE_NAME } from "../version";

import { assertExactAtlasReleaseVersion } from "./version-compare";

export const LATEST_RELEASE_DISCOVERY_ERROR = [
  `Could not resolve the latest published ${CLI_PACKAGE_NAME} release.`,
  "",
  "Your project remains unchanged.",
  "",
  "Retry when registry access is available, or specify an exact target:",
  "  pnpm atlas upgrade --to <version>",
].join("\n");

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions
) => SpawnSyncReturns<string>;

export function pnpmExecutable(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function commandText(value: string | Buffer | null | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value) {
    return value.toString("utf8").trim();
  }
  return "";
}

export function parseLatestReleaseOutput(stdout: string): string {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    throw new Error("Registry latest query returned no version.");
  }

  const direct = readVersionCandidate(trimmed);
  if (direct) {
    return direct;
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const last = lines.at(-1);
  const fromLast = last ? readVersionCandidate(last) : undefined;
  if (fromLast) {
    return fromLast;
  }

  throw new Error(`Registry latest query returned ${JSON.stringify(trimmed)}.`);
}

function readVersionCandidate(value: string): string | undefined {
  if (value.startsWith("{") || value.startsWith("[") || value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed === "string" && isSafeVersion(parsed)) {
        return parsed;
      }
      if (parsed && typeof parsed === "object" && "latest" in parsed) {
        const latest = (parsed as { latest?: unknown }).latest;
        if (typeof latest === "string" && isSafeVersion(latest)) {
          return latest;
        }
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  return isSafeVersion(value) ? value : undefined;
}

function isSafeVersion(version: string): boolean {
  try {
    assertExactAtlasReleaseVersion(version);
    return true;
  } catch {
    return false;
  }
}

export function discoverLatestPublishedRelease(options: {
  cwd: string;
  spawn?: CommandRunner;
  env?: NodeJS.ProcessEnv;
}): string {
  const spawn = options.spawn ?? spawnSync;
  let result: SpawnSyncReturns<string>;
  try {
    result = spawn(pnpmExecutable(), ["view", CLI_PACKAGE_NAME, "dist-tags.latest", "--json"], {
      cwd: options.cwd,
      encoding: "utf8",
      shell: false,
      env: options.env ?? process.env,
    }) as SpawnSyncReturns<string>;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Registry query failed.";
    throw new CliError(CliErrorCode.UPGRADE_PREREQUISITE, LATEST_RELEASE_DISCOVERY_ERROR, {
      details: [message],
    });
  }

  if (result.error || result.status !== 0) {
    const detail =
      commandText(result.stderr) ||
      commandText(result.stdout) ||
      (result.error instanceof Error ? result.error.message : "") ||
      "pnpm view failed.";
    throw new CliError(CliErrorCode.UPGRADE_PREREQUISITE, LATEST_RELEASE_DISCOVERY_ERROR, {
      details: [detail],
    });
  }

  try {
    return parseLatestReleaseOutput(commandText(result.stdout));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid registry version.";
    throw new CliError(CliErrorCode.UPGRADE_PREREQUISITE, LATEST_RELEASE_DISCOVERY_ERROR, {
      details: [message],
    });
  }
}
