import {
  buildPlatformBaseline,
  captureRepositorySyncedPathChecksumsStrict,
  captureSyncedPathChecksumsStrict,
  computeBaselineChecksum,
  joinRepoPath,
  type PlatformBaseline,
  type RawAtlasProjectContract,
  readFileBaselineChecksum,
  readPlatformBaseline,
} from "@atlas/project";

import { SUPPORTED_APP_INFRASTRUCTURE_MANIFEST_SCHEMA_VERSION } from "../template-sync/manifest";

import type { AppInfrastructureManifest } from "../template-sync/manifest";
import type { UpgradePlanItem } from "./types";

export function captureConsumerPlatformBaseline(options: {
  repoRoot: string;
  applicationRoot: string;
  atlasVersion: string;
  contractSchemaVersion: number;
  manifest: AppInfrastructureManifest;
  repositorySyncedPathChecksums?: Record<string, string>;
  /**
   * Atlas-shipped content for application synced paths in `atlasVersion`. After an upgrade the
   * baseline must record what Atlas shipped, not the consumer's file: otherwise a customization
   * Atlas did not touch in this release becomes the new "unchanged" baseline and the next release
   * that changes the file would overwrite it (#125). Omit at `atlas init`, where the files on disk
   * are exactly what Atlas shipped.
   */
  targetSyncedContents?: Record<string, string>;
}): PlatformBaseline {
  const capturedFromDisk = captureSyncedPathChecksumsStrict({
    repoRoot: options.repoRoot,
    applicationRoot: options.applicationRoot,
    syncedPaths: options.manifest.syncedPaths,
  });
  const syncedPathChecksums = options.targetSyncedContents
    ? Object.fromEntries(
        Object.entries(capturedFromDisk).map(([relativePath, checksum]) => {
          const shipped = options.targetSyncedContents?.[relativePath];
          return [
            relativePath,
            shipped === undefined ? checksum : computeBaselineChecksum(shipped),
          ];
        })
      )
    : capturedFromDisk;

  const repositorySyncedPathChecksums =
    options.repositorySyncedPathChecksums ??
    (options.manifest.repositorySyncedPaths?.length
      ? captureRepositorySyncedPathChecksumsStrict({
          repoRoot: options.repoRoot,
          repositorySyncedPaths: options.manifest.repositorySyncedPaths,
        })
      : undefined);

  return buildPlatformBaseline({
    atlasVersion: options.atlasVersion,
    contractSchemaVersion: options.contractSchemaVersion,
    templateManifestSchemaVersion: SUPPORTED_APP_INFRASTRUCTURE_MANIFEST_SCHEMA_VERSION,
    syncedPathChecksums,
    repositorySyncedPathChecksums,
  });
}

export function selectRepositorySyncedPathChecksumsForUpgrade(options: {
  repoRoot: string;
  targetRepositorySyncedPaths: string[];
  previousChecksums: Record<string, string>;
  items: UpgradePlanItem[];
  consumerFiles: Record<string, string>;
  targetContents: Record<string, string>;
}): Record<string, string> {
  const next: Record<string, string> = {};
  const itemByPath = new Map(
    options.items
      .filter((item) => item.pathScope === "repository")
      .map((item) => [item.relativePath, item])
  );

  for (const relativePath of options.targetRepositorySyncedPaths) {
    const item = itemByPath.get(relativePath);
    if (item?.action === "manual-review") {
      continue;
    }

    if (item?.action === "create" || item?.action === "replace") {
      const diskChecksum = readFileBaselineChecksum(joinRepoPath(options.repoRoot, relativePath));
      if (diskChecksum) {
        next[relativePath] = diskChecksum;
      }
      continue;
    }

    const consumerContent = options.consumerFiles[relativePath];
    const targetContent = options.targetContents[relativePath];
    if (consumerContent !== undefined && consumerContent === targetContent) {
      next[relativePath] = computeBaselineChecksum(targetContent);
      continue;
    }

    const previous = options.previousChecksums[relativePath];
    if (previous) {
      next[relativePath] = previous;
    }
  }

  return next;
}

export function mergePlatformBaselineIntoContract(
  contract: RawAtlasProjectContract,
  baseline: PlatformBaseline
): RawAtlasProjectContract {
  return {
    ...contract,
    platform: {
      ...contract.platform,
      baseline,
    },
  };
}

export function readContractPlatformBaseline(
  contract: RawAtlasProjectContract
): PlatformBaseline | undefined {
  return readPlatformBaseline(contract);
}
