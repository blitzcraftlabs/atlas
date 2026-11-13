/**
 * Release consistency between GitHub tags/Releases and npm.
 *
 * Atlas creates the canonical tag first (npm packs from it), creates the GitHub Release
 * as a draft, publishes npm, and only then makes the Release public. These helpers
 * decide when a draft may be finalized and detect any public Release or tag that does
 * not match an npm version.
 */

import { parseSemver } from "../semver-utils.mjs";

/** Compares stable major.minor.patch only; prerelease ordering is not needed here. */
function compareCore(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * GitHub-only versions that predate npm distribution or failed npm publication before
 * draft-first releases existed. They stay listed so the check does not fail on history.
 * Do not add new entries: a new GitHub-only release is a release failure.
 */
export const KNOWN_GITHUB_ONLY_VERSIONS = Object.freeze([
  "0.2.0",
  "0.2.1",
  "0.3.0",
  "0.4.0",
  "0.5.0",
  "1.0.0",
  "1.3.0",
]);

export function versionFromTag(tag) {
  return typeof tag === "string" && /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)
    ? tag.slice(1)
    : null;
}

/**
 * Arguments for `gh release create`. New Releases are always drafts; finalization
 * happens only after npm publication is verified.
 *
 * @param {{ tag: string, version: string, prerelease?: boolean }} decision
 * @param {{ ownerRepo: string, targetSha: string, notesPath: string }} options
 */
export function githubReleaseCreateArgs(decision, options) {
  const args = [
    "release",
    "create",
    decision.tag,
    "--repo",
    options.ownerRepo,
    "--target",
    options.targetSha,
    "--title",
    `Atlas ${decision.version}`,
    "--notes-file",
    options.notesPath,
    "--draft",
  ];
  if (decision.prerelease) {
    args.push("--prerelease");
  }
  return args;
}

/**
 * @param {{
 *   version: string,
 *   npmVersions: string[],
 *   release?: { tagName: string, draft?: boolean, prerelease?: boolean } | null,
 * }} input
 * @returns {{ action: "finalize" | "noop", reason: string, latest: boolean }}
 */
export function evaluateFinalizeDecision(input) {
  const { version, npmVersions, release } = input;
  if (!parseSemver(version)) {
    throw new Error(`Invalid Atlas version: ${version}`);
  }
  if (!release) {
    throw new Error(`GitHub Release v${version} does not exist; nothing to finalize`);
  }
  if (!npmVersions.includes(version)) {
    throw new Error(
      `@blitzcraftlabs/atlas@${version} is not on npm; refusing to make GitHub Release v${version} public`
    );
  }
  const latest = !release.prerelease && isHighestStable(version, npmVersions);
  if (release.draft === false) {
    return { action: "noop", reason: `GitHub Release v${version} is already public`, latest };
  }
  return {
    action: "finalize",
    reason: `npm has ${version}; publishing draft GitHub Release v${version}`,
    latest,
  };
}

function isHighestStable(version, versions) {
  const stable = versions.filter((value) => {
    const parsed = parseSemver(value);
    return parsed && !parsed.prerelease;
  });
  return stable.every((value) => compareCore(value, version) <= 0);
}

/**
 * @param {{
 *   tags: string[],
 *   releases: Array<{ tagName: string, draft?: boolean }>,
 *   npmVersions: string[],
 *   knownGithubOnly?: readonly string[],
 * }} input
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function evaluateReleaseConsistency(input) {
  const known = new Set(input.knownGithubOnly ?? KNOWN_GITHUB_ONLY_VERSIONS);
  const npm = new Set(input.npmVersions);
  const tagVersions = new Set(input.tags.map(versionFromTag).filter(Boolean));
  const errors = [];
  const warnings = [];

  for (const release of input.releases) {
    const version = versionFromTag(release.tagName);
    if (!version || known.has(version) || npm.has(version)) continue;
    if (release.draft) {
      warnings.push(
        `Draft GitHub Release ${release.tagName} is waiting for npm publication of ${version}`
      );
    } else {
      errors.push(
        `Public GitHub Release ${release.tagName} has no matching npm version ${version}`
      );
    }
  }

  const releaseTags = new Set(input.releases.map((release) => release.tagName));
  for (const version of tagVersions) {
    if (known.has(version) || npm.has(version) || releaseTags.has(`v${version}`)) continue;
    warnings.push(`Tag v${version} has neither an npm version nor a GitHub Release`);
  }

  for (const version of npm) {
    if (!tagVersions.has(version)) {
      errors.push(`npm version ${version} has no canonical tag v${version}`);
    }
  }

  return { errors: errors.sort(), warnings: warnings.sort() };
}
