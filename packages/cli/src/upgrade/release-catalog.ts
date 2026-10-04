import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { CliError, CliErrorCode } from "../errors/cli-error";
import { CLI_PACKAGE_NAME } from "../version";

import {
  PRODUCTION_RELEASE_SUPPORT_POLICY,
  REHEARSAL_ONLY_ATLAS_VERSIONS,
  RELEASE_CATALOG_FILENAME,
  RELEASE_CATALOG_SCHEMA_VERSION,
  STRANDED_PUBLISHED_RELEASE_BRIDGES,
} from "./release-constants";
import { compareAtlasVersions, isExactAtlasReleaseVersion } from "./version-compare";

export interface ProductionReleaseCatalog {
  schemaVersion: typeof RELEASE_CATALOG_SCHEMA_VERSION;
  policy: typeof PRODUCTION_RELEASE_SUPPORT_POLICY;
  current: string;
  supportedVersions: string[];
  rehearsalOnlyVersions: string[];
  /** Published sources included beyond the normal previous release so a stranded cohort can recover. */
  recoverySources: string[];
}

export interface SupportedReleaseWindow {
  supportedVersions: string[];
  recoverySources: string[];
}

export function isRehearsalOnlyAtlasVersion(version: string): boolean {
  return (REHEARSAL_ONLY_ATLAS_VERSIONS as readonly string[]).includes(version);
}

export function sortAtlasVersions(versions: string[]): string[] {
  return [...versions].sort((left, right) => compareAtlasVersions(left, right));
}

/**
 * Current release plus the previous npm-published release that also has a snapshot.
 * Publication identity is the npm version list. Snapshot directories, GitHub tags, and
 * GitHub Releases are not predecessors. A declared recovery bridge can add stranded
 * published sources on the first later npm-published release after a faulty catalog.
 * An unpublished release between the faulty catalog and the current version does not
 * consume that bridge.
 */
export function selectSupportedReleaseWindow(options: {
  currentVersion: string;
  snapshotVersions: string[];
  publishedVersions: string[];
}): SupportedReleaseWindow {
  if (!isExactAtlasReleaseVersion(options.currentVersion)) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Production release catalog current version must be an exact X.Y.Z release, received ${JSON.stringify(options.currentVersion)}.`
    );
  }

  const snapshots = new Set(
    options.snapshotVersions.filter((version) => isExactAtlasReleaseVersion(version))
  );
  const published = new Set(
    options.publishedVersions.filter(
      (version) => isExactAtlasReleaseVersion(version) && !isRehearsalOnlyAtlasVersion(version)
    )
  );

  if (!snapshots.has(options.currentVersion)) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Production release catalog cannot include Atlas ${options.currentVersion} because no production snapshot exists for that version.`
    );
  }

  const predecessors = sortAtlasVersions(
    [...snapshots].filter(
      (version) =>
        published.has(version) &&
        !isRehearsalOnlyAtlasVersion(version) &&
        compareAtlasVersions(version, options.currentVersion) < 0
    )
  );
  const previous = predecessors.at(-1);
  const supported = new Set<string>(
    previous ? [previous, options.currentVersion] : [options.currentVersion]
  );
  const recoverySources: string[] = [];

  for (const bridge of STRANDED_PUBLISHED_RELEASE_BRIDGES) {
    if (
      !isImmediateNpmPublishedSuccessor(
        options.currentVersion,
        bridge.faultyRelease,
        snapshots,
        published
      )
    ) {
      continue;
    }

    for (const source of bridge.strandedSources) {
      if (isRehearsalOnlyAtlasVersion(source) || !isExactAtlasReleaseVersion(source)) {
        throw new CliError(
          CliErrorCode.UPGRADE_PREREQUISITE,
          `Recovery bridge ${bridge.id} cannot add ${source} as production upgrade support.`
        );
      }
      if (!published.has(source)) {
        throw new CliError(
          CliErrorCode.UPGRADE_PREREQUISITE,
          `Recovery bridge ${bridge.id} source ${source} is not a verified published release.`
        );
      }
      if (!snapshots.has(source)) {
        throw new CliError(
          CliErrorCode.UPGRADE_PREREQUISITE,
          `Recovery bridge ${bridge.id} source ${source} has no production snapshot.`
        );
      }
      if (compareAtlasVersions(source, options.currentVersion) >= 0 || supported.has(source)) {
        continue;
      }
      supported.add(source);
      recoverySources.push(source);
    }
  }

  return {
    supportedVersions: sortAtlasVersions([...supported]),
    recoverySources: sortAtlasVersions(recoverySources),
  };
}

/**
 * True when no npm-published snapshotted release sits strictly between `faultyRelease`
 * and `currentVersion`. Unpublished snapshots, including a GitHub-only release, do not
 * count. The bridge stays available until a later version is actually on npm.
 */
function isImmediateNpmPublishedSuccessor(
  currentVersion: string,
  faultyRelease: string,
  snapshots: Set<string>,
  published: Set<string>
): boolean {
  if (
    !isExactAtlasReleaseVersion(currentVersion) ||
    !isExactAtlasReleaseVersion(faultyRelease) ||
    compareAtlasVersions(currentVersion, faultyRelease) <= 0
  ) {
    return false;
  }

  for (const version of snapshots) {
    if (!published.has(version) || isRehearsalOnlyAtlasVersion(version)) {
      continue;
    }
    if (
      compareAtlasVersions(version, faultyRelease) > 0 &&
      compareAtlasVersions(version, currentVersion) < 0
    ) {
      return false;
    }
  }

  return true;
}

export function assertUpgradeCatalogMatchesPublishedIdentity(options: {
  catalog: Pick<ProductionReleaseCatalog, "current" | "supportedVersions">;
  snapshotVersions: string[];
  publishedVersions: string[];
}): void {
  const expected = selectSupportedReleaseWindow({
    currentVersion: options.catalog.current,
    snapshotVersions: options.snapshotVersions,
    publishedVersions: options.publishedVersions,
  });

  if (!sameVersionList(options.catalog.supportedVersions, expected.supportedVersions)) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Refusing to publish an invalid upgrade catalog. Packaged support is ${options.catalog.supportedVersions.join(", ") || "(empty)"}, but published-release adjacency is ${expected.supportedVersions.join(", ")}.`
    );
  }

  for (const version of options.catalog.supportedVersions) {
    if (version === options.catalog.current) {
      continue;
    }
    if (!options.publishedVersions.includes(version)) {
      throw new CliError(
        CliErrorCode.UPGRADE_PREREQUISITE,
        `Supported predecessor ${version} has no verified public release identity. Unpublished snapshots cannot be consumer upgrade sources.`
      );
    }
  }
}

function sameVersionList(left: string[], right: string[]): boolean {
  const sortedLeft = sortAtlasVersions(left);
  const sortedRight = sortAtlasVersions(right);
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((version, index) => version === sortedRight[index])
  );
}

export function buildProductionReleaseCatalog(options: {
  currentVersion: string;
  snapshotVersions: string[];
  publishedVersions: string[];
}): ProductionReleaseCatalog {
  const window = selectSupportedReleaseWindow({
    currentVersion: options.currentVersion,
    snapshotVersions: options.snapshotVersions,
    publishedVersions: options.publishedVersions,
  });
  const supportedVersions = window.supportedVersions;

  for (const version of supportedVersions) {
    if (isRehearsalOnlyAtlasVersion(version)) {
      throw new CliError(
        CliErrorCode.UPGRADE_PREREQUISITE,
        `Rehearsal Atlas ${version} cannot be listed as production upgrade support.`
      );
    }
  }

  return {
    schemaVersion: RELEASE_CATALOG_SCHEMA_VERSION,
    policy: PRODUCTION_RELEASE_SUPPORT_POLICY,
    current: options.currentVersion,
    supportedVersions,
    rehearsalOnlyVersions: [...REHEARSAL_ONLY_ATLAS_VERSIONS],
    recoverySources: window.recoverySources,
  };
}

export function serializeProductionReleaseCatalog(catalog: ProductionReleaseCatalog): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

export function parseProductionReleaseCatalog(
  raw: unknown,
  catalogPath: string
): ProductionReleaseCatalog {
  if (typeof raw !== "object" || raw === null) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Packaged release catalog at ${catalogPath} must be a JSON object.`
    );
  }

  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== RELEASE_CATALOG_SCHEMA_VERSION) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Unsupported packaged release catalog schemaVersion at ${catalogPath}: ${String(record.schemaVersion)}. Expected ${RELEASE_CATALOG_SCHEMA_VERSION}.`
    );
  }

  if (record.policy !== PRODUCTION_RELEASE_SUPPORT_POLICY) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Unsupported packaged release catalog policy at ${catalogPath}: ${String(record.policy)}.`
    );
  }

  const current = readNonEmptyString(record.current, "current", catalogPath);
  const supportedVersions = readVersionArray(
    record.supportedVersions,
    "supportedVersions",
    catalogPath
  );
  const rehearsalOnlyVersions = readVersionArray(
    record.rehearsalOnlyVersions,
    "rehearsalOnlyVersions",
    catalogPath
  );
  const recoverySources =
    record.recoverySources === undefined
      ? []
      : readVersionArray(record.recoverySources, "recoverySources", catalogPath);

  if (!supportedVersions.includes(current)) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Packaged release catalog current version ${current} is missing from supportedVersions.`
    );
  }

  if (supportedVersions.some((version) => isRehearsalOnlyAtlasVersion(version))) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Packaged release catalog must not treat rehearsal 0.1.0/0.2.0 snapshots as production support.`
    );
  }

  if (recoverySources.some((version) => !supportedVersions.includes(version))) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Packaged release catalog recoverySources must be included in supportedVersions.`
    );
  }

  return {
    schemaVersion: RELEASE_CATALOG_SCHEMA_VERSION,
    policy: PRODUCTION_RELEASE_SUPPORT_POLICY,
    current,
    supportedVersions: sortAtlasVersions(supportedVersions),
    rehearsalOnlyVersions,
    recoverySources: sortAtlasVersions(recoverySources),
  };
}

export function readProductionReleaseCatalogFile(catalogPath: string): ProductionReleaseCatalog {
  if (!existsSync(catalogPath)) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Packaged Atlas release catalog is missing at ${catalogPath}. Reinstall ${CLI_PACKAGE_NAME}; atlas upgrade does not load consumer repository releases/.`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(catalogPath, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Packaged release catalog at ${catalogPath} contains invalid JSON: ${message}`
    );
  }

  return parseProductionReleaseCatalog(parsed, catalogPath);
}

export function formatUnsupportedSourceReleaseMessage(
  sourceVersion: string,
  catalog: ProductionReleaseCatalog
): string {
  return `Unsupported source Atlas release ${sourceVersion}. ${CLI_PACKAGE_NAME} supports adjacent published releases among: ${formatSupportedVersions(catalog)}. Rehearsal snapshots ${REHEARSAL_ONLY_ATLAS_VERSIONS.join("/")} are not production support.`;
}

export function formatUnsupportedTargetReleaseMessage(
  targetVersion: string,
  catalog: ProductionReleaseCatalog
): string {
  return `Unsupported target Atlas release ${targetVersion}. ${CLI_PACKAGE_NAME} supports adjacent published releases among: ${formatSupportedVersions(catalog)}. Rehearsal snapshots ${REHEARSAL_ONLY_ATLAS_VERSIONS.join("/")} are not production support.`;
}

export function catalogSupportsVersion(
  catalog: ProductionReleaseCatalog,
  version: string
): boolean {
  return catalog.supportedVersions.includes(version);
}

function formatSupportedVersions(catalog: ProductionReleaseCatalog): string {
  return catalog.supportedVersions.join(", ");
}

function readNonEmptyString(value: unknown, field: string, catalogPath: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Packaged release catalog at ${catalogPath} requires a non-empty string for ${field}.`
    );
  }

  return value;
}

function readVersionArray(value: unknown, field: string, catalogPath: string): string[] {
  if (!Array.isArray(value)) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Packaged release catalog at ${catalogPath} requires ${field} to be an array.`
    );
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new CliError(
        CliErrorCode.UPGRADE_PREREQUISITE,
        `Packaged release catalog at ${catalogPath} ${field}[${index}] must be a non-empty version string.`
      );
    }
    return entry;
  });
}

export function catalogFilePath(releasesRoot: string): string {
  return path.join(releasesRoot, RELEASE_CATALOG_FILENAME);
}
