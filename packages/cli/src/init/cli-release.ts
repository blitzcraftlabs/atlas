import { CLI_PACKAGE_NAME } from "../version";

/**
 * First npm-published CLI release that contains `atlas enable`. Used as the
 * minimum pin when neither the running CLI nor the consumer baseline includes
 * the command (consumers still recorded at 1.0.x / 1.1.0).
 */
export const FIRST_CLI_RELEASE_WITH_ENABLE = "1.2.0";

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
  return atlasDlx(FIRST_CLI_RELEASE_WITH_ENABLE);
}

export function enableCliInvocation(
  _atlasVersion: string,
  _kind: "platform" | "consumer",
  _options: EnableCliVersionOptions = {}
): string {
  return "pnpm atlas";
}
