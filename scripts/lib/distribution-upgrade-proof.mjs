import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import { listGeneratedWorkspaceManifests } from "./distribution-clean-room.mjs";

const RELEASE_SNAPSHOT_FILENAME = "release.snapshot.json";

function readJson(filePath, label = filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${label} at ${filePath}`);
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new Error(`${label} contains invalid JSON: ${message}`);
  }
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function checksumFile(filePath) {
  return `sha256:${createHash("sha256").update(readFileSync(filePath)).digest("hex")}`;
}

function assertRelativePath(relativePath, label) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes("..")) {
    throw new Error(`${label} is not a safe release-relative path: ${relativePath}`);
  }
}

/**
 * @param {unknown} raw
 * @param {string} snapshotRoot
 */
export function parseReleaseSnapshotManifest(raw, snapshotRoot) {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Release snapshot at ${snapshotRoot} must be a JSON object`);
  }
  const record = raw;
  const atlasVersion = record.atlasVersion;
  const canonicalApplication = record.canonicalApplication;
  if (typeof atlasVersion !== "string" || atlasVersion.length === 0) {
    throw new Error(`Release snapshot at ${snapshotRoot} is missing atlasVersion`);
  }
  if (typeof canonicalApplication !== "string" || canonicalApplication.length === 0) {
    throw new Error(`Release snapshot at ${snapshotRoot} is missing canonicalApplication`);
  }
  assertRelativePath(canonicalApplication, "canonicalApplication");

  return {
    atlasVersion,
    canonicalApplication,
    contractSchemaVersion: record.contractSchemaVersion,
    templateManifestSchemaVersion: record.templateManifestSchemaVersion,
    syncedPaths: readPathArray(record.syncedPaths, "syncedPaths", snapshotRoot),
    generatedPaths: readPathArray(record.generatedPaths, "generatedPaths", snapshotRoot),
    independentPaths: readPathArray(record.independentPaths, "independentPaths", snapshotRoot),
    packageVersions:
      typeof record.packageVersions === "object" && record.packageVersions !== null
        ? record.packageVersions
        : {},
    openApiSpecRelativePath:
      typeof record.openApiSpecRelativePath === "string"
        ? record.openApiSpecRelativePath
        : undefined,
  };
}

function readPathArray(value, field, snapshotRoot) {
  if (!Array.isArray(value)) {
    throw new Error(`Release snapshot at ${snapshotRoot} requires ${field} to be an array`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new Error(`Release snapshot ${field}[${index}] must be a non-empty string`);
    }
    assertRelativePath(entry, `${field}[${index}]`);
    return entry;
  });
}

export function readReleaseSnapshotManifest(snapshotRoot) {
  const manifestPath = path.join(snapshotRoot, RELEASE_SNAPSHOT_FILENAME);
  return parseReleaseSnapshotManifest(
    readJson(manifestPath, RELEASE_SNAPSHOT_FILENAME),
    snapshotRoot
  );
}

export function packagedSnapshotRoot(cliInstalled, version) {
  return path.join(cliInstalled, "assets", "releases", version);
}

/**
 * Upgrade-relevant Atlas-owned paths captured in a production snapshot.
 * @param {{ syncedPaths: string[]; generatedPaths: string[]; independentPaths: string[] }} manifest
 */
export function collectSnapshotOwnedPaths(manifest) {
  return [
    ...new Set([...manifest.syncedPaths, ...manifest.generatedPaths, ...manifest.independentPaths]),
  ].sort((left, right) => left.localeCompare(right));
}

export function selectPreviousSupportedVersion(catalog) {
  const previous = [...(catalog?.supportedVersions ?? [])]
    .filter((version) => version !== catalog.current)
    .at(-1);
  if (!previous || previous === catalog.current) {
    return null;
  }
  return previous;
}

function resolveUnderRoot(root, relativePath, label) {
  assertRelativePath(relativePath, label);
  const absolute = path.resolve(root, relativePath);
  const rootResolved = path.resolve(root);
  if (absolute !== rootResolved && !absolute.startsWith(`${rootResolved}${path.sep}`)) {
    throw new Error(`${label} resolved outside ${root}: ${relativePath}`);
  }
  return absolute;
}

function copySnapshotFile(sourceRoot, destinationRoot, relativePath, label) {
  const source = resolveUnderRoot(sourceRoot, relativePath, `${label} source`);
  const destination = resolveUnderRoot(destinationRoot, relativePath, `${label} destination`);
  if (!existsSync(source)) {
    throw new Error(`Packaged snapshot is missing ${relativePath} under ${sourceRoot}`);
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

function alignWorkspacePackageVersions(consumerRoot, packageVersions) {
  for (const manifestPath of listGeneratedWorkspaceManifests(consumerRoot)) {
    const manifest = readJson(manifestPath, manifestPath);
    if (typeof manifest.name !== "string" || typeof packageVersions[manifest.name] !== "string") {
      continue;
    }
    const expectedVersion = packageVersions[manifest.name];
    if (manifest.version === expectedVersion) {
      continue;
    }
    manifest.version = expectedVersion;
    writeJson(manifestPath, manifest);
  }
}

function writePreviousBaseline(consumerRoot, previousManifest, applicationRoot) {
  const checksums = {};
  for (const relativePath of previousManifest.syncedPaths) {
    const absolute = resolveUnderRoot(applicationRoot, relativePath, relativePath);
    if (!existsSync(absolute)) {
      throw new Error(
        `Previous consumer is missing synced path ${relativePath} after materialization`
      );
    }
    checksums[relativePath] = checksumFile(absolute);
  }

  const contractPath = path.join(consumerRoot, "atlas.config.json");
  const contract = readJson(contractPath, "atlas.config.json");
  contract.platform = {
    ...(contract.platform ?? {}),
    baseline: {
      atlasVersion: previousManifest.atlasVersion,
      contractSchemaVersion: previousManifest.contractSchemaVersion,
      templateManifestSchemaVersion: previousManifest.templateManifestSchemaVersion,
      syncedPathChecksums: checksums,
    },
  };
  writeJson(contractPath, contract);
  return checksums;
}

/**
 * Reconstruct previous-release Atlas-owned state from packaged snapshot evidence.
 * Leaves consumer-owned files in place. Replaces snapshot-owned application files,
 * OpenAPI evidence, workspace package identity, and platform.baseline.
 */
export function materializePreviousProductionConsumer(options) {
  const previousManifest = readReleaseSnapshotManifest(options.previousSnapshotRoot);
  const currentManifest = readReleaseSnapshotManifest(options.currentSnapshotRoot);
  if (previousManifest.atlasVersion === currentManifest.atlasVersion) {
    throw new Error("Previous and current production snapshots must be distinct versions");
  }

  const applicationRoot = path.join(options.consumerRoot, previousManifest.canonicalApplication);
  const previousOwned = collectSnapshotOwnedPaths(previousManifest);
  const currentOwned = new Set(collectSnapshotOwnedPaths(currentManifest));

  for (const relativePath of previousOwned) {
    copySnapshotFile(
      path.join(options.previousSnapshotRoot, previousManifest.canonicalApplication),
      applicationRoot,
      relativePath,
      relativePath
    );
  }

  if (previousManifest.openApiSpecRelativePath) {
    copySnapshotFile(
      options.previousSnapshotRoot,
      options.consumerRoot,
      previousManifest.openApiSpecRelativePath,
      "openApiSpecRelativePath"
    );
  }

  for (const relativePath of currentOwned) {
    if (previousOwned.includes(relativePath)) {
      continue;
    }
    const leftover = resolveUnderRoot(applicationRoot, relativePath, relativePath);
    if (existsSync(leftover)) {
      unlinkSync(leftover);
    }
  }

  alignWorkspacePackageVersions(options.consumerRoot, previousManifest.packageVersions);
  writePreviousBaseline(options.consumerRoot, previousManifest, applicationRoot);

  return {
    previousManifest,
    currentManifest,
    previousOwned,
  };
}

export function assertPreviousConsumerDoesNotRetainTargetState(options) {
  const previousManifest = options.previousManifest;
  const currentManifest = options.currentManifest;
  const applicationRoot = path.join(options.consumerRoot, previousManifest.canonicalApplication);
  const previousOwned = new Set(collectSnapshotOwnedPaths(previousManifest));
  const issues = [];

  for (const relativePath of collectSnapshotOwnedPaths(currentManifest)) {
    if (previousOwned.has(relativePath)) {
      continue;
    }
    const leftover = path.join(applicationRoot, relativePath);
    if (existsSync(leftover)) {
      issues.push(`Previous consumer retained target-only Atlas-owned path ${relativePath}`);
    }
  }

  for (const relativePath of previousOwned) {
    const previousFile = path.join(
      options.previousSnapshotRoot,
      previousManifest.canonicalApplication,
      relativePath
    );
    const consumerFile = path.join(applicationRoot, relativePath);
    if (!existsSync(consumerFile)) {
      issues.push(`Previous consumer is missing snapshot-owned path ${relativePath}`);
      continue;
    }
    if (!existsSync(previousFile)) {
      issues.push(`Previous snapshot is missing ${relativePath}`);
      continue;
    }
    if (!readFileSync(consumerFile).equals(readFileSync(previousFile))) {
      issues.push(
        `Previous consumer path ${relativePath} does not match the previous production snapshot`
      );
    }
  }

  for (const manifestPath of listGeneratedWorkspaceManifests(options.consumerRoot)) {
    const manifest = readJson(manifestPath, manifestPath);
    const expected = previousManifest.packageVersions[manifest.name];
    if (typeof expected === "string" && manifest.version !== expected) {
      issues.push(
        `Workspace package ${manifest.name} retained ${String(manifest.version)} instead of previous ${expected}`
      );
    }
  }

  const baseline = readJson(path.join(options.consumerRoot, "atlas.config.json")).platform
    ?.baseline;
  if (baseline?.atlasVersion !== previousManifest.atlasVersion) {
    issues.push(
      `platform.baseline.atlasVersion is ${String(baseline?.atlasVersion)}, expected ${previousManifest.atlasVersion}`
    );
  }

  if (issues.length > 0) {
    throw new Error(`Previous-version consumer is not faithful:\n${issues.join("\n")}`);
  }
}

export function assertActionableUpgradePlan(envelope, expectations) {
  const result = envelope?.result ?? {};
  if (
    result.sourceVersion !== expectations.sourceVersion ||
    result.targetVersion !== expectations.targetVersion
  ) {
    throw new Error(
      `Cross-version upgrade plan did not use ${expectations.sourceVersion} → ${expectations.targetVersion}`
    );
  }
  if (result.status === "blocked") {
    throw new Error(
      `Cross-version upgrade dry-run is blocked; a clean previous-release fixture must return status "planned"`
    );
  }
  if (result.status !== "planned") {
    throw new Error(
      `Cross-version upgrade dry-run status is ${String(result.status)}, expected "planned"`
    );
  }
}

export function assertSuccessfulUpgradeApply(envelope, expectations) {
  const result = envelope?.result ?? {};
  if (
    result.sourceVersion !== expectations.sourceVersion ||
    result.targetVersion !== expectations.targetVersion
  ) {
    throw new Error(
      `Applied upgrade did not use ${expectations.sourceVersion} → ${expectations.targetVersion}`
    );
  }
  if (result.status !== "success") {
    throw new Error(
      `Installed upgrade apply status is ${String(result.status)}, expected "success"`
    );
  }
  if (result.baselineUpdated !== true) {
    throw new Error("Installed upgrade apply did not advance platform.baseline");
  }
}

export function assertPostUpgradeReleaseIdentity(options) {
  const currentManifest = readReleaseSnapshotManifest(options.currentSnapshotRoot);
  const contract = readJson(
    path.join(options.consumerRoot, "atlas.config.json"),
    "atlas.config.json"
  );
  const baseline = contract.platform?.baseline;
  const issues = [];

  if (baseline?.atlasVersion !== currentManifest.atlasVersion) {
    issues.push(
      `Post-upgrade platform.baseline.atlasVersion is ${String(baseline?.atlasVersion)}, expected ${currentManifest.atlasVersion}`
    );
  }
  if (
    typeof currentManifest.contractSchemaVersion === "number" &&
    baseline?.contractSchemaVersion !== currentManifest.contractSchemaVersion
  ) {
    issues.push(
      `Post-upgrade contractSchemaVersion is ${String(baseline?.contractSchemaVersion)}, expected ${currentManifest.contractSchemaVersion}`
    );
  }

  const applicationRoot = path.join(options.consumerRoot, currentManifest.canonicalApplication);
  const recorded = baseline?.syncedPathChecksums ?? {};
  const expectedPaths = [...currentManifest.syncedPaths].sort((left, right) =>
    left.localeCompare(right)
  );
  const recordedPaths = Object.keys(recorded).sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(recordedPaths) !== JSON.stringify(expectedPaths)) {
    issues.push(
      "Post-upgrade syncedPathChecksums do not match the current production snapshot syncedPaths"
    );
  }

  for (const relativePath of currentManifest.syncedPaths) {
    const absolute = path.join(applicationRoot, relativePath);
    if (!existsSync(absolute)) {
      issues.push(`Post-upgrade consumer is missing synced path ${relativePath}`);
      continue;
    }
    const diskChecksum = checksumFile(absolute);
    if (recorded[relativePath] !== diskChecksum) {
      issues.push(
        `Post-upgrade checksum for ${relativePath} is not coherent with the file on disk`
      );
    }
  }

  const rootPackage = readJson(path.join(options.consumerRoot, "package.json"), "package.json");
  if (rootPackage.version !== currentManifest.atlasVersion) {
    issues.push(
      `Post-upgrade root package.json version is ${String(rootPackage.version)}, expected ${currentManifest.atlasVersion}`
    );
  }
  if (rootPackage.scripts?.atlas !== "atlas") {
    issues.push("Post-upgrade root package.json is missing the atlas script");
  }
  if (rootPackage.devDependencies?.["@blitzcraftlabs/atlas"] !== currentManifest.atlasVersion) {
    issues.push(
      `Post-upgrade @blitzcraftlabs/atlas pin is ${String(rootPackage.devDependencies?.["@blitzcraftlabs/atlas"])}, expected ${currentManifest.atlasVersion}`
    );
  }

  for (const manifestPath of listGeneratedWorkspaceManifests(options.consumerRoot)) {
    const manifest = readJson(manifestPath, manifestPath);
    const expected = currentManifest.packageVersions[manifest.name];
    if (typeof expected === "string" && manifest.version !== expected) {
      issues.push(
        `Post-upgrade workspace package ${manifest.name} is ${String(manifest.version)}, expected ${expected}`
      );
    }
  }

  if (issues.length > 0) {
    throw new Error(`Post-upgrade release identity is incomplete:\n${issues.join("\n")}`);
  }
}

/**
 * @returns {{ deferred: true, current: string } | { deferred: false, previous: string, current: string }}
 */
export function proveInstalledCrossVersionUpgrade(options) {
  const previous = selectPreviousSupportedVersion(options.catalog);
  if (!previous) {
    return { deferred: true, current: options.catalog.current };
  }

  const previousSnapshotRoot = packagedSnapshotRoot(options.cliInstalled, previous);
  const currentSnapshotRoot = packagedSnapshotRoot(options.cliInstalled, options.catalog.current);
  if (!existsSync(path.join(previousSnapshotRoot, RELEASE_SNAPSHOT_FILENAME))) {
    throw new Error(`Packaged previous snapshot missing at ${previousSnapshotRoot}`);
  }
  if (!existsSync(path.join(currentSnapshotRoot, RELEASE_SNAPSHOT_FILENAME))) {
    throw new Error(`Packaged current snapshot missing at ${currentSnapshotRoot}`);
  }

  const materialized = materializePreviousProductionConsumer({
    consumerRoot: options.consumerRoot,
    previousSnapshotRoot,
    currentSnapshotRoot,
  });
  assertPreviousConsumerDoesNotRetainTargetState({
    consumerRoot: options.consumerRoot,
    previousSnapshotRoot,
    previousManifest: materialized.previousManifest,
    currentManifest: materialized.currentManifest,
  });

  const planned = options.runAtlas([
    "upgrade",
    "--to",
    options.catalog.current,
    "--dry-run",
    "--json",
  ]);
  assertActionableUpgradePlan(planned, {
    sourceVersion: previous,
    targetVersion: options.catalog.current,
  });

  const applied = options.runAtlas(["upgrade", "--to", options.catalog.current, "--json"]);
  assertSuccessfulUpgradeApply(applied, {
    sourceVersion: previous,
    targetVersion: options.catalog.current,
  });
  assertPostUpgradeReleaseIdentity({
    consumerRoot: options.consumerRoot,
    currentSnapshotRoot,
  });
  options.runValidation();

  return { deferred: false, previous, current: options.catalog.current };
}
