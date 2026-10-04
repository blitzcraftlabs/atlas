import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { computeBaselineChecksum } from "@atlas/project";

import { CliError, CliErrorCode } from "../errors/cli-error";
import { SUPPORTED_APP_INFRASTRUCTURE_MANIFEST_SCHEMA_VERSION } from "../template-sync/manifest";
import { CLI_PACKAGE_NAME } from "../version";

import { readReleaseManifestFields, type ReleaseManifestFields } from "./manifest-fields";
import {
  assertNoPathListDuplicates,
  assertNoReleasePathOverlap,
  resolvePathUnderApplicationRoot,
  resolvePathUnderReleaseRoot,
  validateReleaseApplicationPath,
  validateReleaseOpenApiPath,
  validateReleaseRelativePath,
} from "./path-safety";
import { RELEASE_SNAPSHOT_FILENAME } from "./release-constants";

import type { UpgradeSnapshot } from "./types";

export { RELEASE_SNAPSHOT_FILENAME } from "./release-constants";
export const RELEASE_SNAPSHOT_SCHEMA_VERSION = 1;

export interface ReleaseSnapshotManifest {
  schemaVersion: number;
  atlasVersion: string;
  contractSchemaVersion: number;
  templateManifestSchemaVersion: number;
  canonicalApplication: string;
  syncedPaths: string[];
  generatedPaths: string[];
  independentPaths: string[];
  repositorySyncedPaths?: string[];
  packageVersions: Record<string, string>;
  /**
   * Atlas-owned package manifest fields for this release.
   * Absent on snapshots packaged before field-level manifest evidence existed.
   */
  manifestFields?: ReleaseManifestFields;
  openApiSpecRelativePath?: string;
}

export interface LoadedReleaseSnapshot {
  manifest: ReleaseSnapshotManifest;
  snapshot: UpgradeSnapshot;
  releaseRoot: string;
}

function readJsonFile<T>(absolutePath: string, label: string): T {
  if (!existsSync(absolutePath)) {
    throw new CliError(CliErrorCode.UPGRADE_PREREQUISITE, `Missing ${label} at ${absolutePath}.`);
  }

  try {
    return JSON.parse(readFileSync(absolutePath, "utf8")) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `${label} contains invalid JSON: ${message}`
    );
  }
}

function validateReleaseSnapshotManifest(raw: unknown): ReleaseSnapshotManifest {
  if (typeof raw !== "object" || raw === null) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `${RELEASE_SNAPSHOT_FILENAME} must be a JSON object.`
    );
  }

  const record = raw as Record<string, unknown>;

  if (record.schemaVersion !== RELEASE_SNAPSHOT_SCHEMA_VERSION) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Unsupported release snapshot schemaVersion: ${String(record.schemaVersion)}. Expected ${RELEASE_SNAPSHOT_SCHEMA_VERSION}.`
    );
  }

  const atlasVersion = readNonEmptyString(record.atlasVersion, "atlasVersion");
  const contractSchemaVersion = readPositiveInteger(
    record.contractSchemaVersion,
    "contractSchemaVersion"
  );
  const templateManifestSchemaVersion = readPositiveInteger(
    record.templateManifestSchemaVersion,
    "templateManifestSchemaVersion"
  );
  const canonicalApplication = readNonEmptyString(
    record.canonicalApplication,
    "canonicalApplication"
  );
  validateReleaseApplicationPath(canonicalApplication, "canonicalApplication");

  const syncedPaths = readValidatedPathArray(record.syncedPaths, "syncedPaths");
  const generatedPaths = readValidatedPathArray(record.generatedPaths, "generatedPaths");
  const independentPaths = readValidatedPathArray(record.independentPaths, "independentPaths");
  const repositorySyncedPaths =
    record.repositorySyncedPaths === undefined
      ? []
      : readValidatedPathArray(record.repositorySyncedPaths, "repositorySyncedPaths");

  assertNoPathListDuplicates(syncedPaths, "syncedPaths");
  assertNoPathListDuplicates(generatedPaths, "generatedPaths");
  assertNoPathListDuplicates(independentPaths, "independentPaths");
  assertNoPathListDuplicates(repositorySyncedPaths, "repositorySyncedPaths");
  assertNoReleasePathOverlap({ syncedPaths, generatedPaths, independentPaths });

  for (const repositorySyncedPath of repositorySyncedPaths) {
    if (
      syncedPaths.includes(repositorySyncedPath) ||
      generatedPaths.includes(repositorySyncedPath) ||
      independentPaths.includes(repositorySyncedPath)
    ) {
      throw new CliError(
        CliErrorCode.UPGRADE_PREREQUISITE,
        `Release snapshot repositorySyncedPaths entry "${repositorySyncedPath}" must not also appear in application-level path lists.`
      );
    }
  }

  const packageVersions = readPackageVersions(record.packageVersions);
  const manifestFields = readReleaseManifestFields(record.manifestFields);

  const openApiSpecRelativePath =
    record.openApiSpecRelativePath === undefined
      ? undefined
      : readOpenApiPath(record.openApiSpecRelativePath);

  return {
    schemaVersion: RELEASE_SNAPSHOT_SCHEMA_VERSION,
    atlasVersion,
    contractSchemaVersion,
    templateManifestSchemaVersion,
    canonicalApplication,
    syncedPaths,
    generatedPaths,
    independentPaths,
    ...(repositorySyncedPaths.length > 0 ? { repositorySyncedPaths } : {}),
    packageVersions,
    ...(manifestFields ? { manifestFields } : {}),
    openApiSpecRelativePath,
  };
}

function readNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Release snapshot requires a non-empty string for ${field}.`
    );
  }

  return value;
}

function readPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Release snapshot requires a positive integer for ${field}.`
    );
  }

  return value;
}

function readValidatedPathArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Release snapshot requires ${field} to be an array.`
    );
  }

  const entries: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new CliError(
        CliErrorCode.UPGRADE_PREREQUISITE,
        `Release snapshot ${field}[${index}] must be a non-empty string.`
      );
    }
    validateReleaseRelativePath(entry, `${field}[${index}]`);
    entries.push(entry);
  }

  return entries;
}

function readOpenApiPath(value: unknown): string {
  const relativePath = readNonEmptyString(value, "openApiSpecRelativePath");
  validateReleaseOpenApiPath(relativePath, "openApiSpecRelativePath");
  return relativePath;
}

function readPackageVersions(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      "Release snapshot requires packageVersions to be an object."
    );
  }

  const versions: Record<string, string> = {};
  for (const [packageName, version] of Object.entries(value as Record<string, unknown>)) {
    if (typeof version !== "string" || version.trim().length === 0) {
      throw new CliError(
        CliErrorCode.UPGRADE_PREREQUISITE,
        `Release snapshot packageVersions["${packageName}"] must be a non-empty version string.`
      );
    }
    versions[packageName] = version;
  }

  return versions;
}

function readReleaseFile(
  releaseRoot: string,
  canonicalApplication: string,
  relativePath: string
): string {
  const applicationRoot = path.join(releaseRoot, canonicalApplication);
  const absolutePath = resolvePathUnderApplicationRoot(
    applicationRoot,
    relativePath,
    `release snapshot file ${relativePath}`
  );

  if (!existsSync(absolutePath)) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Release snapshot is missing file ${path.posix.join(canonicalApplication, relativePath)} under ${releaseRoot}.`
    );
  }

  return readFileSync(absolutePath, "utf8");
}

function readReleaseRepositoryFile(releaseRoot: string, relativePath: string): string {
  const absolutePath = resolvePathUnderReleaseRoot(
    releaseRoot,
    relativePath,
    `release snapshot repository file ${relativePath}`
  );

  if (!existsSync(absolutePath)) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Release snapshot is missing repository file ${relativePath} under ${releaseRoot}.`
    );
  }

  return readFileSync(absolutePath, "utf8");
}

function buildUpgradeSnapshotFromRelease(
  releaseRoot: string,
  manifest: ReleaseSnapshotManifest
): UpgradeSnapshot {
  const syncedPaths: Record<string, string> = {};
  const allSyncedLikePaths = [...manifest.syncedPaths, ...manifest.independentPaths].sort(
    (left, right) => left.localeCompare(right)
  );

  for (const relativePath of allSyncedLikePaths) {
    syncedPaths[relativePath] = readReleaseFile(
      releaseRoot,
      manifest.canonicalApplication,
      relativePath
    );
  }

  const generatedPaths: Record<string, string> = {};
  for (const relativePath of manifest.generatedPaths) {
    generatedPaths[relativePath] = readReleaseFile(
      releaseRoot,
      manifest.canonicalApplication,
      relativePath
    );
  }

  const repositorySyncedPaths: Record<string, string> = {};
  for (const relativePath of [...(manifest.repositorySyncedPaths ?? [])].sort((left, right) =>
    left.localeCompare(right)
  )) {
    repositorySyncedPaths[relativePath] = readReleaseRepositoryFile(releaseRoot, relativePath);
  }

  let openApiSpec: string | undefined;
  if (manifest.openApiSpecRelativePath) {
    const openApiPath = resolvePathUnderReleaseRoot(
      releaseRoot,
      manifest.openApiSpecRelativePath,
      "openApiSpecRelativePath"
    );
    if (!existsSync(openApiPath)) {
      throw new CliError(
        CliErrorCode.UPGRADE_PREREQUISITE,
        `Release snapshot is missing OpenAPI spec at ${manifest.openApiSpecRelativePath}.`
      );
    }
    openApiSpec = readFileSync(openApiPath, "utf8");
  }

  return {
    syncedPaths,
    generatedPaths,
    ...(Object.keys(repositorySyncedPaths).length > 0 ? { repositorySyncedPaths } : {}),
    openApiSpec,
  };
}

export function resolveReleaseDirectory(releasesDir: string, atlasVersion: string): string {
  const releaseRoot = path.join(releasesDir, atlasVersion);
  const snapshotPath = path.join(releaseRoot, RELEASE_SNAPSHOT_FILENAME);

  if (!existsSync(snapshotPath)) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `No release snapshot found for Atlas version ${atlasVersion}. Expected ${snapshotPath}. Normal atlas upgrade loads production snapshots from the installed ${CLI_PACKAGE_NAME} package, not from a consumer repository releases/ directory.`
    );
  }

  return releaseRoot;
}

export function loadReleaseSnapshot(options: {
  atlasVersion: string;
  releasesDir: string;
}): LoadedReleaseSnapshot {
  const releaseRoot = resolveReleaseDirectory(options.releasesDir, options.atlasVersion);
  const manifestPath = path.join(releaseRoot, RELEASE_SNAPSHOT_FILENAME);
  const manifest = validateReleaseSnapshotManifest(
    readJsonFile(manifestPath, RELEASE_SNAPSHOT_FILENAME)
  );

  if (manifest.atlasVersion !== options.atlasVersion) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Release snapshot atlasVersion (${manifest.atlasVersion}) does not match requested version (${options.atlasVersion}).`
    );
  }

  const snapshot = buildUpgradeSnapshotFromRelease(releaseRoot, manifest);

  return {
    manifest,
    snapshot,
    releaseRoot,
  };
}

export function computeGeneratorInputChecksum(
  snapshot: UpgradeSnapshot,
  relativePath: string
): string {
  const generatedContent = snapshot.generatedPaths?.[relativePath];
  if (generatedContent === undefined) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Release snapshot does not include generated path ${relativePath}.`
    );
  }

  return computeBaselineChecksum(generatedContent);
}

export function buildManifestSubsetFromRelease(manifest: ReleaseSnapshotManifest) {
  return {
    schemaVersion: SUPPORTED_APP_INFRASTRUCTURE_MANIFEST_SCHEMA_VERSION,
    canonicalApplication: manifest.canonicalApplication,
    consumerApplications: [],
    syncedPaths: manifest.syncedPaths,
    generatedPaths: manifest.generatedPaths,
    independentPaths: {},
    referenceOnlyPaths: [],
    starterOnlyPaths: [],
    repositorySyncedPaths: manifest.repositorySyncedPaths ?? [],
  };
}

export function toReleasePathManifest(manifest: ReleaseSnapshotManifest) {
  return {
    syncedPaths: manifest.syncedPaths,
    generatedPaths: manifest.generatedPaths,
    independentPaths: manifest.independentPaths,
  };
}
