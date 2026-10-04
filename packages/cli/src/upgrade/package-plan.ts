import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { planManifestFieldUpdates, releaseManifestFieldsHaveEvidence } from "./manifest-fields";

import type { ReleaseSnapshotManifest } from "./release-snapshot";
import type { UpgradePlanItem } from "./types";

const ATLAS_WORKSPACE_PACKAGES = [
  "@blitzcraftlabs/atlas",
  "@atlas/config",
  "@atlas/consent",
  "@atlas/project",
  "@atlas/ui",
  "@atlas/web",
] as const;

const ATLAS_PACKAGE_DIR: Record<(typeof ATLAS_WORKSPACE_PACKAGES)[number], string> = {
  "@blitzcraftlabs/atlas": "packages/cli/package.json",
  "@atlas/config": "packages/config/package.json",
  "@atlas/consent": "packages/consent/package.json",
  "@atlas/project": "packages/project/package.json",
  "@atlas/ui": "packages/ui/package.json",
  "@atlas/web": "apps/web/package.json",
};

export function readWorkspacePackageVersion(repoRoot: string, packageName: string): string | null {
  const relativePath = ATLAS_PACKAGE_DIR[packageName as keyof typeof ATLAS_PACKAGE_DIR];
  if (!relativePath) {
    return null;
  }

  const packageJsonPath = path.join(repoRoot, relativePath);
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

export function packageExistsInConsumer(repoRoot: string, packageName: string): boolean {
  const relativePath = ATLAS_PACKAGE_DIR[packageName as keyof typeof ATLAS_PACKAGE_DIR];
  return relativePath ? existsSync(path.join(repoRoot, relativePath)) : false;
}

export function planPackageUpdates(options: {
  repoRoot: string;
  baselineAtlasVersion: string;
  sourceManifest: ReleaseSnapshotManifest;
  targetManifest: ReleaseSnapshotManifest;
}): UpgradePlanItem[] {
  if (
    releaseManifestFieldsHaveEvidence(options.sourceManifest.manifestFields) &&
    releaseManifestFieldsHaveEvidence(options.targetManifest.manifestFields)
  ) {
    return planManifestFieldUpdates({
      repoRoot: options.repoRoot,
      baselineAtlasVersion: options.baselineAtlasVersion,
      sourceFields: options.sourceManifest.manifestFields,
      targetFields: options.targetManifest.manifestFields,
    });
  }

  return planLegacyPackageVersions(options);
}

function planLegacyPackageVersions(options: {
  repoRoot: string;
  sourceManifest: ReleaseSnapshotManifest;
  targetManifest: ReleaseSnapshotManifest;
}): UpgradePlanItem[] {
  const items: UpgradePlanItem[] = [];

  for (const packageName of ATLAS_WORKSPACE_PACKAGES) {
    const sourceVersion = options.sourceManifest.packageVersions[packageName];
    const targetVersion = options.targetManifest.packageVersions[packageName];
    const packagePresent = packageExistsInConsumer(options.repoRoot, packageName);
    const currentVersion = packagePresent
      ? readWorkspacePackageVersion(options.repoRoot, packageName)
      : null;

    if (!packagePresent) {
      continue;
    }

    if (!targetVersion) {
      continue;
    }

    if (sourceVersion === targetVersion) {
      items.push({
        relativePath: packageName,
        ownershipChannel: "versioned-package",
        category: "patch-safe",
        action: "skip",
        message: `${packageName} remains at ${targetVersion} between source and target Atlas releases.`,
        conflict: false,
        securityCritical: false,
        sourceVersion: sourceVersion ?? currentVersion ?? undefined,
        targetVersion,
      });
      continue;
    }

    if (currentVersion !== null && currentVersion === targetVersion) {
      items.push({
        relativePath: packageName,
        ownershipChannel: "versioned-package",
        category: "patch-safe",
        action: "skip",
        message: `${packageName} is already at the target Atlas release ${targetVersion}; preserve it and adopt it when the upgrade completes.`,
        conflict: false,
        securityCritical: false,
        sourceVersion: sourceVersion ?? currentVersion,
        targetVersion,
      });
      continue;
    }

    if (currentVersion !== null && sourceVersion && currentVersion !== sourceVersion) {
      items.push({
        relativePath: packageName,
        ownershipChannel: "versioned-package",
        category: "manual",
        action: "manual-review",
        message: `${packageName} version ${currentVersion} differs from the source Atlas release (${sourceVersion}). Atlas will not overwrite consumer-modified package identity.`,
        conflict: true,
        securityCritical: false,
        sourceVersion,
        targetVersion,
      });
      continue;
    }

    items.push({
      relativePath: packageName,
      ownershipChannel: "versioned-package",
      category: "patch-safe",
      action: "package-upgrade",
      message: `${packageName} ${sourceVersion ?? currentVersion ?? "unknown"} → ${targetVersion}. Atlas will align the workspace package version field during upgrade.`,
      conflict: false,
      securityCritical: false,
      sourceVersion: sourceVersion ?? currentVersion ?? undefined,
      targetVersion,
    });
  }

  return items.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}
