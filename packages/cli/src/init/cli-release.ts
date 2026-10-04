import { CLI_PACKAGE_NAME } from "../version";

/**
 * Published npm 1.1.0 does not include `atlas enable`. Until Changesets assigns the
 * next CLI version, generated enable commands use this placeholder. Do not invent a
 * version number here — the Version PR replaces it by leaving that release out of
 * `CLI_RELEASES_WITHOUT_ENABLE`.
 */
export const ENABLE_CLI_RELEASE_PLACEHOLDER = "<next-cli-release>";

/** CLI releases that exist on npm without the `enable` command. */
export const CLI_RELEASES_WITHOUT_ENABLE = new Set(["1.0.0", "1.0.1", "1.1.0"]);

export function atlasDlx(atlasVersion: string): string {
  return `pnpm dlx ${CLI_PACKAGE_NAME}@${atlasVersion}`;
}

export function cliReleaseIncludesEnable(atlasVersion: string): boolean {
  return !CLI_RELEASES_WITHOUT_ENABLE.has(atlasVersion);
}

export interface EnableCliVersionOptions {
  /**
   * Version of the CLI binary currently generating the docs. Prefer this for
   * `atlas enable` pins when it includes the command. Never substitute a
   * consumer `platform.baseline.atlasVersion` that predates enable.
   */
  runningCliVersion?: string;
}

/**
 * Invocation for `atlas enable`. Existing consumers may keep an older
 * `platform.baseline.atlasVersion`; enable lives on a newer CLI release.
 */
export function atlasDlxForEnable(
  atlasVersion: string,
  options: EnableCliVersionOptions = {}
): string {
  const running = options.runningCliVersion;
  if (running && cliReleaseIncludesEnable(running)) {
    return atlasDlx(running);
  }
  if (cliReleaseIncludesEnable(atlasVersion)) {
    return atlasDlx(atlasVersion);
  }
  return `pnpm dlx ${CLI_PACKAGE_NAME}@${ENABLE_CLI_RELEASE_PLACEHOLDER}`;
}

export function enableCliInvocation(
  _atlasVersion: string,
  _kind: "platform" | "consumer",
  _options: EnableCliVersionOptions = {}
): string {
  return "pnpm atlas";
}
