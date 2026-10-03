import { getSyncedPathBaselineStatus } from "@atlas/project";

import {
  classifyOwnershipTransitions,
  classifySyncedPathTransitions,
  type OwnershipTransition,
} from "./path-transitions";

import type { AtlasMigrationDefinition } from "./migrations/registry";
import type { PlanUpgradeOptions, UpgradePlan, UpgradePlanItem, UpgradePlanSummary } from "./types";

/**
 * Test-only security relevance heuristic for upgrade rehearsal evidence.
 * Canonical security-critical classification belongs to advisory metadata — not this planner.
 */
function isSecurityRelevantSyncedPath(relativePath: string): boolean {
  return (
    relativePath.includes("src/lib/security/") || relativePath.includes("src/lib/auth/session.ts")
  );
}

function summarizePlan(items: UpgradePlanItem[]): UpgradePlanSummary {
  const summary: UpgradePlanSummary = {
    patchSafe: 0,
    mergeRequired: 0,
    migrationRequired: 0,
    manual: 0,
    securityCritical: 0,
    skipped: 0,
    packageUpdates: 0,
    regenerations: 0,
    replacements: 0,
  };

  for (const item of items) {
    switch (item.category) {
      case "patch-safe":
        summary.patchSafe += 1;
        break;
      case "merge-required":
        summary.mergeRequired += 1;
        break;
      case "migration-required":
        summary.migrationRequired += 1;
        break;
      case "manual":
        summary.manual += 1;
        break;
      case "security-critical":
        summary.securityCritical += 1;
        break;
      default:
        break;
    }

    if (item.action === "skip") {
      summary.skipped += 1;
    }

    if (item.action === "package-upgrade") {
      summary.packageUpdates += 1;
    }

    if (item.action === "regenerate") {
      summary.regenerations += 1;
    }

    if (item.action === "replace" || item.action === "create") {
      summary.replacements += 1;
    }
  }

  return summary;
}

function planOwnershipTransitionItem(transition: OwnershipTransition): UpgradePlanItem {
  return {
    relativePath: transition.relativePath,
    ownershipChannel: "migration-managed",
    category: "migration-required",
    action: "manual-review",
    message: `${transition.message} Manual review is required before Atlas can reconcile ownership.`,
    conflict: true,
  };
}

function planExistingSyncedPath(options: {
  relativePath: string;
  applicationRoot: string;
  baselineAtlasVersion: string;
  targetAtlasVersion: string;
  baselineChecksums: Record<string, string>;
  consumerContent?: string;
  sourceContent?: string;
  targetContent?: string;
}): UpgradePlanItem {
  const baselineStatus = getSyncedPathBaselineStatus({
    relativePath: options.relativePath,
    consumerApplicationRoot: options.applicationRoot,
    baselineChecksums: options.baselineChecksums,
    consumerContent: options.consumerContent,
  });

  if (options.sourceContent === undefined || options.targetContent === undefined) {
    return {
      relativePath: options.relativePath,
      ownershipChannel: "atlas-managed-template",
      category: "manual",
      action: "manual-review",
      message: `Missing source or target snapshot for synced path ${options.relativePath}.`,
      conflict: true,
    };
  }

  if (options.sourceContent === options.targetContent) {
    return {
      relativePath: options.relativePath,
      ownershipChannel: "atlas-managed-template",
      category: "patch-safe",
      action: "skip",
      message: `Synced path ${options.relativePath} is unchanged in Atlas ${options.targetAtlasVersion}.`,
      conflict: false,
    };
  }

  if (options.consumerContent === undefined) {
    return {
      relativePath: options.relativePath,
      ownershipChannel: "atlas-managed-template",
      category: "manual",
      action: "manual-review",
      message: `Consumer file ${options.relativePath} is missing while Atlas ${options.targetAtlasVersion} changed this synced path. Restore or recreate the file before upgrading.`,
      conflict: true,
    };
  }

  if (options.consumerContent === options.targetContent) {
    return {
      relativePath: options.relativePath,
      ownershipChannel: "atlas-managed-template",
      category: "patch-safe",
      action: "skip",
      message: `Consumer path ${options.relativePath} already matches the target Atlas release; preserve it and adopt it when the upgrade completes.`,
      conflict: false,
      baselineStatus,
    };
  }

  if (baselineStatus === "unknown") {
    return {
      relativePath: options.relativePath,
      ownershipChannel: "atlas-managed-template",
      category: "manual",
      action: "manual-review",
      message: `Insufficient baseline evidence for ${options.relativePath}. Atlas ${options.targetAtlasVersion} changed this synced path, but the recorded baseline does not prove the consumer copy is unchanged. Manual review is required before replacement.`,
      conflict: true,
      baselineStatus,
    };
  }

  if (baselineStatus === "modified") {
    const isSecurityPath = isSecurityRelevantSyncedPath(options.relativePath);
    return {
      relativePath: options.relativePath,
      ownershipChannel: "atlas-managed-template",
      category: isSecurityPath ? "security-critical" : "merge-required",
      action: "manual-review",
      message: isSecurityPath
        ? `Consumer modified security-relevant synced path ${options.relativePath} after Atlas ${options.baselineAtlasVersion}. Atlas ${options.targetAtlasVersion} also changed this file; elevated manual remediation is required and automatic overwrite is forbidden.`
        : `Consumer modified ${options.relativePath} after Atlas ${options.baselineAtlasVersion}. Atlas ${options.targetAtlasVersion} also changed this file; manual merge is required.`,
      conflict: true,
      securityCritical: isSecurityPath,
      baselineStatus,
    };
  }

  const isSecurityPath = isSecurityRelevantSyncedPath(options.relativePath);

  return {
    relativePath: options.relativePath,
    ownershipChannel: "atlas-managed-template",
    category: isSecurityPath ? "security-critical" : "patch-safe",
    action: "replace",
    message: isSecurityPath
      ? `Security-relevant synced path ${options.relativePath} can be replaced because the consumer copy still matches the recorded Atlas baseline.`
      : `Synced path ${options.relativePath} can be replaced from Atlas ${options.targetAtlasVersion}.`,
    conflict: false,
    securityCritical: isSecurityPath,
    baselineStatus,
  };
}

function planNewSyncedPath(options: {
  relativePath: string;
  targetAtlasVersion: string;
  consumerContent?: string;
  targetContent?: string;
}): UpgradePlanItem {
  if (options.targetContent === undefined) {
    return {
      relativePath: options.relativePath,
      ownershipChannel: "atlas-managed-template",
      category: "manual",
      action: "manual-review",
      message: `Missing target snapshot for newly introduced synced path ${options.relativePath}.`,
      conflict: true,
    };
  }

  if (options.consumerContent === undefined) {
    return {
      relativePath: options.relativePath,
      ownershipChannel: "atlas-managed-template",
      category: "patch-safe",
      action: "create",
      message: `Atlas ${options.targetAtlasVersion} introduced synced path ${options.relativePath}. The consumer copy is absent and can be created from the target release.`,
      conflict: false,
    };
  }

  if (options.consumerContent === options.targetContent) {
    return {
      relativePath: options.relativePath,
      ownershipChannel: "atlas-managed-template",
      category: "patch-safe",
      action: "skip",
      message: `Consumer path ${options.relativePath} already matches the target Atlas release; preserve it and adopt it when the upgrade completes.`,
      conflict: false,
    };
  }

  return {
    relativePath: options.relativePath,
    ownershipChannel: "atlas-managed-template",
    category: "merge-required",
    action: "manual-review",
    message: `Atlas ${options.targetAtlasVersion} introduced synced path ${options.relativePath}, but the consumer already has a file at that location. Manual review is required before Atlas can reconcile ownership.`,
    conflict: true,
  };
}

function planRemovedSyncedPath(options: {
  relativePath: string;
  baselineAtlasVersion: string;
  targetAtlasVersion: string;
  applicationRoot: string;
  baselineChecksums: Record<string, string>;
  consumerContent?: string;
  sourceContent?: string;
}): UpgradePlanItem {
  const baselineStatus = getSyncedPathBaselineStatus({
    relativePath: options.relativePath,
    consumerApplicationRoot: options.applicationRoot,
    baselineChecksums: options.baselineChecksums,
    consumerContent: options.consumerContent,
  });

  if (options.consumerContent === undefined) {
    return {
      relativePath: options.relativePath,
      ownershipChannel: "atlas-managed-template",
      category: "patch-safe",
      action: "skip",
      message: `Atlas ${options.targetAtlasVersion} removed synced path ${options.relativePath} and the consumer copy is already absent.`,
      conflict: false,
      baselineStatus,
    };
  }

  if (baselineStatus === "modified" || baselineStatus === "unknown") {
    return {
      relativePath: options.relativePath,
      ownershipChannel: "atlas-managed-template",
      category: "manual",
      action: "manual-review",
      message: `Atlas ${options.targetAtlasVersion} removed synced path ${options.relativePath}, but the consumer copy no longer matches the Atlas ${options.baselineAtlasVersion} baseline. Preserve the file and review whether it should be deleted manually.`,
      conflict: true,
      baselineStatus,
    };
  }

  return {
    relativePath: options.relativePath,
    ownershipChannel: "atlas-managed-template",
    category: "patch-safe",
    action: "remove",
    message: `Atlas ${options.targetAtlasVersion} removed synced path ${options.relativePath}. The consumer copy still matches the Atlas ${options.baselineAtlasVersion} baseline and can be removed.`,
    conflict: false,
    baselineStatus,
  };
}

function planNewRepositorySyncedPath(options: {
  relativePath: string;
  targetAtlasVersion: string;
  consumerContent?: string;
  targetContent?: string;
}): UpgradePlanItem {
  if (options.targetContent === undefined) {
    return {
      relativePath: options.relativePath,
      pathScope: "repository",
      ownershipChannel: "atlas-managed-template",
      category: "manual",
      action: "manual-review",
      message: `Missing target snapshot for repository-level Atlas path ${options.relativePath}.`,
      conflict: false,
    };
  }

  if (options.consumerContent === undefined) {
    return {
      relativePath: options.relativePath,
      pathScope: "repository",
      ownershipChannel: "atlas-managed-template",
      category: "patch-safe",
      action: "create",
      message: `Atlas ${options.targetAtlasVersion} introduced repository-level path ${options.relativePath}. The consumer copy is absent and can be created from the target release.`,
      conflict: false,
    };
  }

  if (options.consumerContent === options.targetContent) {
    return {
      relativePath: options.relativePath,
      pathScope: "repository",
      ownershipChannel: "atlas-managed-template",
      category: "patch-safe",
      action: "skip",
      message: `Consumer repository path ${options.relativePath} already matches Atlas ${options.targetAtlasVersion} and can be adopted without rewriting the file.`,
      conflict: false,
    };
  }

  return {
    relativePath: options.relativePath,
    pathScope: "repository",
    ownershipChannel: "atlas-managed-template",
    category: "manual",
    action: "manual-review",
    message: `Consumer customized repository-level path ${options.relativePath}. Atlas ${options.targetAtlasVersion} will not overwrite it. Manual review is required; the rest of the upgrade may proceed.`,
    conflict: false,
  };
}

function planExistingRepositorySyncedPath(options: {
  relativePath: string;
  repoRoot: string;
  baselineAtlasVersion: string;
  targetAtlasVersion: string;
  baselineChecksums: Record<string, string>;
  consumerContent?: string;
  sourceContent?: string;
  targetContent?: string;
}): UpgradePlanItem {
  const baselineStatus = getSyncedPathBaselineStatus({
    relativePath: options.relativePath,
    consumerApplicationRoot: options.repoRoot,
    baselineChecksums: options.baselineChecksums,
    consumerContent: options.consumerContent,
  });

  if (options.sourceContent === undefined || options.targetContent === undefined) {
    return {
      relativePath: options.relativePath,
      pathScope: "repository",
      ownershipChannel: "atlas-managed-template",
      category: "manual",
      action: "manual-review",
      message: `Missing source or target snapshot for repository-level path ${options.relativePath}.`,
      conflict: false,
      baselineStatus,
    };
  }

  if (options.sourceContent === options.targetContent) {
    return {
      relativePath: options.relativePath,
      pathScope: "repository",
      ownershipChannel: "atlas-managed-template",
      category: "patch-safe",
      action: "skip",
      message: `Repository-level path ${options.relativePath} is unchanged in Atlas ${options.targetAtlasVersion}.`,
      conflict: false,
      baselineStatus,
    };
  }

  if (options.consumerContent === undefined) {
    return {
      relativePath: options.relativePath,
      pathScope: "repository",
      ownershipChannel: "atlas-managed-template",
      category: "patch-safe",
      action: "create",
      message: `Consumer repository path ${options.relativePath} is absent. Atlas ${options.targetAtlasVersion} can create it from the target release.`,
      conflict: false,
      baselineStatus,
    };
  }

  if (options.consumerContent === options.targetContent) {
    return {
      relativePath: options.relativePath,
      pathScope: "repository",
      ownershipChannel: "atlas-managed-template",
      category: "patch-safe",
      action: "skip",
      message: `Consumer repository path ${options.relativePath} already matches Atlas ${options.targetAtlasVersion} and can be adopted without rewriting the file.`,
      conflict: false,
      baselineStatus,
    };
  }

  if (baselineStatus === "unknown") {
    return {
      relativePath: options.relativePath,
      pathScope: "repository",
      ownershipChannel: "atlas-managed-template",
      category: "manual",
      action: "manual-review",
      message: `Consumer repository path ${options.relativePath} differs from Atlas ${options.targetAtlasVersion} and has no recorded Atlas checksum. The file will not be overwritten. Manual review is required; the rest of the upgrade may proceed.`,
      conflict: false,
      baselineStatus,
    };
  }

  if (baselineStatus === "modified") {
    return {
      relativePath: options.relativePath,
      pathScope: "repository",
      ownershipChannel: "atlas-managed-template",
      category: "manual",
      action: "manual-review",
      message: `Consumer modified repository-level path ${options.relativePath} after Atlas ${options.baselineAtlasVersion}. Atlas ${options.targetAtlasVersion} will not overwrite it. Manual review is required; the rest of the upgrade may proceed.`,
      conflict: false,
      baselineStatus,
    };
  }

  return {
    relativePath: options.relativePath,
    pathScope: "repository",
    ownershipChannel: "atlas-managed-template",
    category: "patch-safe",
    action: "replace",
    message: `Repository-level path ${options.relativePath} still matches the recorded Atlas baseline and can be replaced from Atlas ${options.targetAtlasVersion}.`,
    conflict: false,
    baselineStatus,
  };
}

function planRemovedRepositorySyncedPath(options: {
  relativePath: string;
  baselineAtlasVersion: string;
  targetAtlasVersion: string;
  repoRoot: string;
  baselineChecksums: Record<string, string>;
  consumerContent?: string;
}): UpgradePlanItem {
  const baselineStatus = getSyncedPathBaselineStatus({
    relativePath: options.relativePath,
    consumerApplicationRoot: options.repoRoot,
    baselineChecksums: options.baselineChecksums,
    consumerContent: options.consumerContent,
  });

  if (options.consumerContent === undefined) {
    return {
      relativePath: options.relativePath,
      pathScope: "repository",
      ownershipChannel: "atlas-managed-template",
      category: "patch-safe",
      action: "skip",
      message: `Atlas ${options.targetAtlasVersion} removed repository-level path ${options.relativePath} and the consumer copy is already absent.`,
      conflict: false,
      baselineStatus,
    };
  }

  if (baselineStatus === "unchanged") {
    return {
      relativePath: options.relativePath,
      pathScope: "repository",
      ownershipChannel: "atlas-managed-template",
      category: "patch-safe",
      action: "remove",
      message: `Atlas ${options.targetAtlasVersion} removed repository-level path ${options.relativePath}. The consumer copy still matches the Atlas ${options.baselineAtlasVersion} baseline and can be removed.`,
      conflict: false,
      baselineStatus,
    };
  }

  return {
    relativePath: options.relativePath,
    pathScope: "repository",
    ownershipChannel: "atlas-managed-template",
    category: "manual",
    action: "manual-review",
    message: `Atlas ${options.targetAtlasVersion} removed repository-level path ${options.relativePath}, but the consumer copy does not match the recorded Atlas baseline. The file will not be deleted. Manual review is required; the rest of the upgrade may proceed.`,
    conflict: false,
    baselineStatus,
  };
}

function planMigrationChainItems(migrationChain: AtlasMigrationDefinition[]): UpgradePlanItem[] {
  return migrationChain.map((migration) => ({
    relativePath: "atlas.config.json",
    ownershipChannel: "structural-contract" as const,
    category: migration.automatic ? "migration-required" : "manual",
    action: migration.automatic ? "migration" : "manual-review",
    migrationId: migration.id,
    sourceVersion: migration.sourceVersion,
    targetVersion: migration.targetVersion,
    message: migration.automatic
      ? `Registered migration ${migration.id} will run between Atlas ${migration.sourceVersion} and ${migration.targetVersion}.`
      : `Migration ${migration.id} between ${migration.sourceVersion} and ${migration.targetVersion} requires manual review.`,
    conflict: !migration.automatic,
  }));
}

export function planUpgrade(
  options: PlanUpgradeOptions & { migrationChain?: AtlasMigrationDefinition[] }
): UpgradePlan {
  const items: UpgradePlanItem[] = [];

  const sourceManifest = {
    syncedPaths: options.sourceSyncedPaths,
    generatedPaths: options.sourceGeneratedPaths,
    independentPaths: options.sourceIndependentPaths,
  };
  const targetManifest = {
    syncedPaths: options.syncedPaths,
    generatedPaths: options.generatedPaths,
    independentPaths: options.independentPaths,
  };

  const syncedTransitions = classifySyncedPathTransitions({
    sourceManifest,
    targetManifest,
  });
  const ownershipTransitions = classifyOwnershipTransitions({
    sourceManifest,
    targetManifest,
  });

  for (const transition of ownershipTransitions) {
    items.push(planOwnershipTransitionItem(transition));
  }

  if (options.migrationChain && options.migrationChain.length > 0) {
    items.push(...planMigrationChainItems(options.migrationChain));
  } else if (options.contractSchemaChanged) {
    items.push({
      relativePath: "atlas.config.json",
      ownershipChannel: "structural-contract",
      category: "migration-required",
      action: "manual-review",
      message:
        "Atlas contract schema changed between baseline and target, but no registered migration covers the required chain. Complete the documented migration manually before upgrading.",
      conflict: true,
    });
  }

  for (const transition of syncedTransitions) {
    const consumerContent = options.consumerFiles[transition.relativePath];
    const sourceContent = options.sourceSnapshot.syncedPaths[transition.relativePath];
    const targetContent = options.targetSnapshot.syncedPaths[transition.relativePath];

    if (transition.kind === "existing") {
      items.push(
        planExistingSyncedPath({
          relativePath: transition.relativePath,
          applicationRoot: options.applicationRoot,
          baselineAtlasVersion: options.baselineAtlasVersion,
          targetAtlasVersion: options.targetAtlasVersion,
          baselineChecksums: options.baselineChecksums,
          consumerContent,
          sourceContent,
          targetContent,
        })
      );
      continue;
    }

    if (transition.kind === "new") {
      items.push(
        planNewSyncedPath({
          relativePath: transition.relativePath,
          targetAtlasVersion: options.targetAtlasVersion,
          consumerContent,
          targetContent,
        })
      );
      continue;
    }

    items.push(
      planRemovedSyncedPath({
        relativePath: transition.relativePath,
        baselineAtlasVersion: options.baselineAtlasVersion,
        targetAtlasVersion: options.targetAtlasVersion,
        applicationRoot: options.applicationRoot,
        baselineChecksums: options.baselineChecksums,
        consumerContent,
        sourceContent,
      })
    );
  }

  const sourceRepositorySyncedPaths = options.sourceRepositorySyncedPaths ?? [];
  const targetRepositorySyncedPaths = options.repositorySyncedPaths ?? [];
  const repositoryTransitions = classifySyncedPathTransitions({
    sourceManifest: {
      syncedPaths: sourceRepositorySyncedPaths,
      generatedPaths: [],
      independentPaths: [],
    },
    targetManifest: {
      syncedPaths: targetRepositorySyncedPaths,
      generatedPaths: [],
      independentPaths: [],
    },
  });
  const repositoryRoot = options.repositoryRoot ?? options.applicationRoot;
  const baselineRepositoryChecksums = options.baselineRepositoryChecksums ?? {};
  const consumerRepositoryFiles = options.consumerRepositoryFiles ?? {};

  for (const transition of repositoryTransitions) {
    const consumerContent = consumerRepositoryFiles[transition.relativePath];
    const sourceContent = options.sourceSnapshot.repositorySyncedPaths?.[transition.relativePath];
    const targetContent = options.targetSnapshot.repositorySyncedPaths?.[transition.relativePath];

    if (transition.kind === "existing") {
      items.push(
        planExistingRepositorySyncedPath({
          relativePath: transition.relativePath,
          repoRoot: repositoryRoot,
          baselineAtlasVersion: options.baselineAtlasVersion,
          targetAtlasVersion: options.targetAtlasVersion,
          baselineChecksums: baselineRepositoryChecksums,
          consumerContent,
          sourceContent,
          targetContent,
        })
      );
      continue;
    }

    if (transition.kind === "new") {
      items.push(
        planNewRepositorySyncedPath({
          relativePath: transition.relativePath,
          targetAtlasVersion: options.targetAtlasVersion,
          consumerContent,
          targetContent,
        })
      );
      continue;
    }

    items.push(
      planRemovedRepositorySyncedPath({
        relativePath: transition.relativePath,
        baselineAtlasVersion: options.baselineAtlasVersion,
        targetAtlasVersion: options.targetAtlasVersion,
        repoRoot: repositoryRoot,
        baselineChecksums: baselineRepositoryChecksums,
        consumerContent,
      })
    );
  }

  for (const relativePath of [...options.independentPaths].sort((left, right) =>
    left.localeCompare(right)
  )) {
    const targetIndependentContent = options.targetSnapshot.syncedPaths[relativePath];
    const sourceIndependentContent = options.sourceSnapshot.syncedPaths[relativePath];

    if (targetIndependentContent !== undefined && sourceIndependentContent === undefined) {
      items.push({
        relativePath,
        ownershipChannel: "consumer-owned-source",
        category: "manual",
        action: "manual-review",
        message: `Application-owned path ${relativePath} was introduced in Atlas ${options.targetAtlasVersion}. Review whether the consumer should adopt the new wiring pattern.`,
        conflict: false,
      });
      continue;
    }

    if (
      sourceIndependentContent !== undefined &&
      targetIndependentContent !== undefined &&
      sourceIndependentContent !== targetIndependentContent
    ) {
      items.push({
        relativePath,
        ownershipChannel: "consumer-owned-source",
        category: "manual",
        action: "manual-review",
        message: `Application-owned path ${relativePath} changed in Atlas ${options.targetAtlasVersion}. Review whether the consumer should adopt the new wiring pattern.`,
        conflict: false,
      });
    } else {
      items.push({
        relativePath,
        ownershipChannel: "consumer-owned-source",
        category: "patch-safe",
        action: "skip",
        message: `Application-owned path ${relativePath} is never overwritten automatically.`,
        conflict: false,
      });
    }
  }

  for (const relativePath of [...options.generatedPaths].sort((left, right) =>
    left.localeCompare(right)
  )) {
    const sourceGenerated = options.sourceSnapshot.generatedPaths?.[relativePath];
    const targetGenerated = options.targetSnapshot.generatedPaths?.[relativePath];

    if (sourceGenerated === targetGenerated) {
      items.push({
        relativePath,
        ownershipChannel: "generated-artifact",
        category: "patch-safe",
        action: "skip",
        message: `Generated path ${relativePath} is unchanged between Atlas versions.`,
        conflict: false,
      });
      continue;
    }

    items.push({
      relativePath,
      ownershipChannel: "generated-artifact",
      category: "patch-safe",
      action: "regenerate",
      message: `Regenerate ${relativePath} from the updated OpenAPI spec instead of copying template source.`,
      conflict: false,
    });
  }

  if (
    options.sourceSnapshot.openApiSpec !== undefined &&
    options.targetSnapshot.openApiSpec !== undefined &&
    options.sourceSnapshot.openApiSpec !== options.targetSnapshot.openApiSpec
  ) {
    items.push({
      relativePath: "openapi/openapi.json",
      ownershipChannel: "consumer-owned-source",
      category: "manual",
      action: "manual-review",
      message:
        "OpenAPI spec changed in the target Atlas release. The consumer-owned spec is never overwritten automatically. Review Atlas changes, merge the spec manually, then run api:gen to regenerate client artifacts.",
      conflict: false,
    });
  }

  const sortedItems = items.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
  const summary = summarizePlan(sortedItems);

  const hasUnresolvedManualMigrations = sortedItems.some(
    (item) =>
      item.category === "migration-required" &&
      (item.action === "manual-review" || (item.action === "migration" && item.conflict))
  );

  return {
    sourceAtlasVersion: options.baselineAtlasVersion,
    targetAtlasVersion: options.targetAtlasVersion,
    applicationRoot: options.applicationRoot,
    items: sortedItems,
    summary,
    hasBlockingConflicts: sortedItems.some((item) => item.conflict),
    hasIncompleteMigrations: hasUnresolvedManualMigrations,
  };
}

export function serializeUpgradePlan(plan: UpgradePlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}
