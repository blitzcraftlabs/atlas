import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { CliError, CliErrorCode } from "../errors/cli-error";
import { findCliPackageRoot } from "../version";

import { readPublishedReleaseRecord } from "./published-releases";
import {
  listProductionSnapshotVersions,
  packagedReleaseAssetRoot,
  sourceProductionReleasesRoot,
} from "./release-assets";
import {
  assertUpgradeCatalogMatchesPublishedIdentity,
  buildProductionReleaseCatalog,
  serializeProductionReleaseCatalog,
} from "./release-catalog";
import {
  PUBLISHED_RELEASES_FILENAME,
  RELEASE_CATALOG_FILENAME,
  RELEASE_SNAPSHOT_FILENAME,
} from "./release-constants";

function readPackageVersion(packageRoot: string): string {
  const packageJsonPath = path.join(packageRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Missing package.json at ${packageJsonPath}.`
    );
  }

  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new CliError(CliErrorCode.UPGRADE_PREREQUISITE, `Missing version in ${packageJsonPath}.`);
  }

  return parsed.version;
}

export function publishedReleaseRecordPath(packageRoot: string): string {
  return path.join(
    path.dirname(sourceProductionReleasesRoot(packageRoot)),
    PUBLISHED_RELEASES_FILENAME
  );
}

export function buildPackagedReleaseAssets(options?: {
  packageRoot?: string;
  outputDir?: string;
  publishedVersions?: string[];
}): string {
  const packageRoot = path.resolve(options?.packageRoot ?? findCliPackageRoot(__dirname));
  const productionRoot = sourceProductionReleasesRoot(packageRoot);
  const outputDir = options?.outputDir ?? packagedReleaseAssetRoot(packageRoot);
  const currentVersion = readPackageVersion(packageRoot);
  const snapshotVersions = listProductionSnapshotVersions(productionRoot);
  const publishedVersions =
    options?.publishedVersions ??
    readPublishedReleaseRecord(publishedReleaseRecordPath(packageRoot)).versions;
  const catalog = buildProductionReleaseCatalog({
    currentVersion,
    snapshotVersions,
    publishedVersions,
  });
  assertUpgradeCatalogMatchesPublishedIdentity({
    catalog,
    snapshotVersions,
    publishedVersions,
  });

  if (existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true, force: true });
  }
  mkdirSync(outputDir, { recursive: true });

  for (const version of catalog.supportedVersions) {
    const sourceDir = path.join(productionRoot, version);
    const destinationDir = path.join(outputDir, version);
    if (!existsSync(path.join(sourceDir, RELEASE_SNAPSHOT_FILENAME))) {
      throw new CliError(
        CliErrorCode.UPGRADE_PREREQUISITE,
        `Production snapshot for Atlas ${version} is missing at ${path.join(sourceDir, RELEASE_SNAPSHOT_FILENAME)}.`
      );
    }
    cpSync(sourceDir, destinationDir, { recursive: true });
  }

  writeFileSync(
    path.join(outputDir, RELEASE_CATALOG_FILENAME),
    serializeProductionReleaseCatalog(catalog),
    "utf8"
  );

  return outputDir;
}

export function buildPackagedReleaseAssetsFromCliPackage(): string {
  return buildPackagedReleaseAssets();
}
