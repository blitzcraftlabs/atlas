/** Exact stable release. Rejects prerelease, build metadata, ranges, and shell metacharacters. */
const EXACT_ATLAS_RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isExactAtlasReleaseVersion(version: string): boolean {
  return EXACT_ATLAS_RELEASE_VERSION.test(version);
}

export function assertExactAtlasReleaseVersion(version: string, label = "Atlas version"): string {
  if (!isExactAtlasReleaseVersion(version)) {
    throw new Error(
      `${label} must be an exact X.Y.Z release, received ${JSON.stringify(version)}.`
    );
  }

  return version;
}

/** Compare Atlas SemVer strings without external dependencies. */
export function compareAtlasVersions(left: string, right: string): -1 | 0 | 1 {
  const leftParts = parseAtlasVersion(left);
  const rightParts = parseAtlasVersion(right);

  for (let index = 0; index < 3; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;

    if (leftValue < rightValue) {
      return -1;
    }

    if (leftValue > rightValue) {
      return 1;
    }
  }

  return 0;
}

function parseAtlasVersion(version: string): [number, number, number] {
  const core = version.trim().split("-")[0]?.split("+")[0] ?? "";
  const parts = core.split(".");

  if (parts.length < 3) {
    throw new Error(`Invalid Atlas version: ${version}. Expected SemVer such as 0.1.0.`);
  }

  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  const patch = Number(parts[2]);

  if (
    !Number.isInteger(major) ||
    !Number.isInteger(minor) ||
    !Number.isInteger(patch) ||
    major < 0 ||
    minor < 0 ||
    patch < 0
  ) {
    throw new Error(`Invalid Atlas version: ${version}. Expected SemVer such as 0.1.0.`);
  }

  return [major, minor, patch];
}

export function isAtlasVersionLessThan(left: string, right: string): boolean {
  return compareAtlasVersions(left, right) < 0;
}

export function isAtlasVersionGreaterThan(left: string, right: string): boolean {
  return compareAtlasVersions(left, right) > 0;
}
