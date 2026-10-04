import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { CliError, CliErrorCode } from "../errors/cli-error";
import {
  APP_INFRASTRUCTURE_MANIFEST_RELATIVE_PATH,
  type AppInfrastructureManifest,
  loadAppInfrastructureManifest,
} from "../template-sync/manifest";

import { collectManagedManifestFields } from "./manifest-fields";
import { resolvePathUnderRoot } from "./path-safety";
import {
  DEFAULT_OPENAPI_SPEC_RELATIVE_PATH,
  RELEASE_SNAPSHOT_FILENAME,
  SNAPSHOT_PACKAGE_MANIFEST_PATHS,
} from "./release-constants";
import {
  loadReleaseSnapshot,
  RELEASE_SNAPSHOT_SCHEMA_VERSION,
  type ReleaseSnapshotManifest,
} from "./release-snapshot";

export interface GenerateProductionReleaseSnapshotOptions {
  repoRoot: string;
  outputDir: string;
  replace?: boolean;
}

export interface GeneratedProductionReleaseSnapshot {
  version: string;
  outputDir: string;
  manifest: ReleaseSnapshotManifest;
}

function readJsonFile(absolutePath: string, label: string): Record<string, unknown> {
  if (!existsSync(absolutePath)) {
    throw new CliError(CliErrorCode.UPGRADE_PREREQUISITE, `Missing ${label} at ${absolutePath}.`);
  }

  try {
    const parsed = JSON.parse(readFileSync(absolutePath, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("JSON root must be an object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `${label} contains invalid JSON: ${message}`
    );
  }
}

function readNonEmptyStringField(
  record: Record<string, unknown>,
  field: string,
  label: string
): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `${label} requires a non-empty string for ${field}.`
    );
  }
  return value;
}

function readPositiveIntegerField(
  record: Record<string, unknown>,
  field: string,
  label: string
): number {
  const value = record[field];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `${label} requires a positive integer for ${field}.`
    );
  }
  return value;
}

function sortStrings(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sortRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
  );
}

function readAtlasVersion(repoRoot: string): string {
  const packageJson = readJsonFile(path.join(repoRoot, "package.json"), "repository package.json");
  return readNonEmptyStringField(packageJson, "version", "repository package.json");
}

function readContractSchemaVersion(repoRoot: string): number {
  const contract = readJsonFile(path.join(repoRoot, "atlas.config.json"), "atlas.config.json");
  return readPositiveIntegerField(contract, "schemaVersion", "atlas.config.json");
}

function collectCanonicalIndependentPaths(
  repoRoot: string,
  manifest: AppInfrastructureManifest
): string[] {
  const applicationRoot = path.join(repoRoot, manifest.canonicalApplication);
  const paths = new Set<string>();

  for (const byApplication of Object.values(manifest.independentPaths)) {
    for (const relativePath of Object.keys(byApplication)) {
      if (existsSync(path.join(applicationRoot, relativePath))) {
        paths.add(relativePath);
      }
    }
  }

  return sortStrings([...paths]);
}

function collectPackageVersions(repoRoot: string): Record<string, string> {
  const versions: Record<string, string> = {};

  for (const relativePath of SNAPSHOT_PACKAGE_MANIFEST_PATHS) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!existsSync(absolutePath)) {
      continue;
    }
    const manifest = readJsonFile(absolutePath, relativePath);
    const name = readNonEmptyStringField(manifest, "name", relativePath);
    const version = readNonEmptyStringField(manifest, "version", relativePath);
    versions[name] = version;
  }

  return sortRecord(versions);
}

function copyReleaseFile(options: {
  repoRoot: string;
  outputDir: string;
  relativeFromRepo: string;
}): void {
  const sourcePath = resolvePathUnderRoot(
    options.repoRoot,
    options.relativeFromRepo,
    `production snapshot source ${options.relativeFromRepo}`
  );
  if (!existsSync(sourcePath)) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Production snapshot is missing required file ${options.relativeFromRepo}.`
    );
  }

  const destinationPath = resolvePathUnderRoot(
    options.outputDir,
    options.relativeFromRepo,
    `production snapshot destination ${options.relativeFromRepo}`
  );
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  writeFileSync(destinationPath, readFileSync(sourcePath));
}

function serializeReleaseSnapshotManifest(manifest: ReleaseSnapshotManifest): string {
  return `${JSON.stringify(
    {
      schemaVersion: manifest.schemaVersion,
      atlasVersion: manifest.atlasVersion,
      contractSchemaVersion: manifest.contractSchemaVersion,
      templateManifestSchemaVersion: manifest.templateManifestSchemaVersion,
      canonicalApplication: manifest.canonicalApplication,
      syncedPaths: manifest.syncedPaths,
      generatedPaths: manifest.generatedPaths,
      independentPaths: manifest.independentPaths,
      ...(manifest.repositorySyncedPaths && manifest.repositorySyncedPaths.length > 0
        ? { repositorySyncedPaths: manifest.repositorySyncedPaths }
        : {}),
      packageVersions: manifest.packageVersions,
      ...(manifest.manifestFields ? { manifestFields: manifest.manifestFields } : {}),
      ...(manifest.openApiSpecRelativePath
        ? { openApiSpecRelativePath: manifest.openApiSpecRelativePath }
        : {}),
    },
    null,
    2
  )}\n`;
}

export function generateProductionReleaseSnapshot(
  options: GenerateProductionReleaseSnapshotOptions
): GeneratedProductionReleaseSnapshot {
  const repoRoot = path.resolve(options.repoRoot);
  const outputDir = path.resolve(options.outputDir);
  const atlasVersion = readAtlasVersion(repoRoot);
  const manifestPath = path.join(repoRoot, APP_INFRASTRUCTURE_MANIFEST_RELATIVE_PATH);

  if (!existsSync(manifestPath)) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Cannot generate a production release snapshot without ${APP_INFRASTRUCTURE_MANIFEST_RELATIVE_PATH}.`
    );
  }

  const ownership = loadAppInfrastructureManifest(repoRoot);
  const syncedPaths = sortStrings(ownership.syncedPaths);
  const generatedPaths = sortStrings(ownership.generatedPaths);
  const independentPaths = collectCanonicalIndependentPaths(repoRoot, ownership);
  const repositorySyncedPaths = sortStrings(ownership.repositorySyncedPaths ?? []);
  const openApiExists = existsSync(path.join(repoRoot, DEFAULT_OPENAPI_SPEC_RELATIVE_PATH));

  const snapshotManifest: ReleaseSnapshotManifest = {
    schemaVersion: RELEASE_SNAPSHOT_SCHEMA_VERSION,
    atlasVersion,
    contractSchemaVersion: readContractSchemaVersion(repoRoot),
    templateManifestSchemaVersion: ownership.schemaVersion,
    canonicalApplication: ownership.canonicalApplication,
    syncedPaths,
    generatedPaths,
    independentPaths,
    ...(repositorySyncedPaths.length > 0 ? { repositorySyncedPaths } : {}),
    packageVersions: collectPackageVersions(repoRoot),
    manifestFields: collectManagedManifestFields(repoRoot, readJsonFile),
    openApiSpecRelativePath: openApiExists ? DEFAULT_OPENAPI_SPEC_RELATIVE_PATH : undefined,
  };

  const snapshotPath = path.join(outputDir, RELEASE_SNAPSHOT_FILENAME);
  if (existsSync(snapshotPath) && options.replace !== true) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Refusing to overwrite existing production snapshot at ${snapshotPath}. Pass replace to regenerate.`
    );
  }

  if (existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true, force: true });
  }
  mkdirSync(outputDir, { recursive: true });

  for (const relativePath of [...syncedPaths, ...generatedPaths, ...independentPaths]) {
    copyReleaseFile({
      repoRoot,
      outputDir,
      relativeFromRepo: path.posix.join(ownership.canonicalApplication, relativePath),
    });
  }

  for (const relativePath of repositorySyncedPaths) {
    copyReleaseFile({
      repoRoot,
      outputDir,
      relativeFromRepo: relativePath,
    });
  }

  if (snapshotManifest.openApiSpecRelativePath) {
    copyReleaseFile({
      repoRoot,
      outputDir,
      relativeFromRepo: snapshotManifest.openApiSpecRelativePath,
    });
  }

  writeFileSync(snapshotPath, serializeReleaseSnapshotManifest(snapshotManifest), "utf8");

  loadReleaseSnapshot({
    atlasVersion,
    releasesDir: path.dirname(outputDir),
  });

  return {
    version: atlasVersion,
    outputDir,
    manifest: snapshotManifest,
  };
}
