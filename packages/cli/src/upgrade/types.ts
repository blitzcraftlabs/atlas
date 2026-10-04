export type UpgradeOwnershipChannel =
  | "versioned-package"
  | "generated-artifact"
  | "atlas-managed-template"
  | "consumer-owned-source"
  | "structural-contract"
  | "migration-managed"
  | "documentation-procedure"
  | "reference-only";

export type UpgradeChangeCategory =
  | "patch-safe"
  | "merge-required"
  | "migration-required"
  | "manual"
  | "security-critical";

export type UpgradeActionKind =
  | "replace"
  | "create"
  | "remove"
  | "regenerate"
  | "package-upgrade"
  | "skip"
  | "manual-review"
  | "migration";

export type UpgradeBaselineStatus = "unchanged" | "modified" | "unknown";

export type UpgradeRunMode = "dry-run" | "apply";

export type UpgradeRunStatus =
  | "already-current"
  | "planned"
  | "blocked"
  | "success"
  | "failed"
  | "migration-failed"
  | "validation-failed";

export type UpgradePathScope = "application" | "repository";

export interface ManifestFieldChange {
  relativePath: string;
  field: string;
  operation: "set" | "remove";
  sourceOwned: boolean;
  targetOwned: boolean;
  sourceValue?: string;
  targetValue?: string;
  recovery?: boolean;
}

export interface UpgradePlanItem {
  relativePath: string;
  ownershipChannel: UpgradeOwnershipChannel;
  category: UpgradeChangeCategory;
  action: UpgradeActionKind;
  message: string;
  conflict: boolean;
  securityCritical?: boolean;
  migrationId?: string;
  sourceVersion?: string;
  targetVersion?: string;
  baselineStatus?: UpgradeBaselineStatus;
  pathScope?: UpgradePathScope;
  manifestChange?: ManifestFieldChange;
}

export interface UpgradePlanSummary {
  patchSafe: number;
  mergeRequired: number;
  migrationRequired: number;
  manual: number;
  securityCritical: number;
  skipped: number;
  packageUpdates: number;
  regenerations: number;
  replacements: number;
}

export interface UpgradePlan {
  sourceAtlasVersion: string;
  targetAtlasVersion: string;
  applicationRoot: string;
  items: UpgradePlanItem[];
  summary: UpgradePlanSummary;
  hasBlockingConflicts: boolean;
  hasIncompleteMigrations: boolean;
}

export interface UpgradeSnapshot {
  syncedPaths: Record<string, string>;
  generatedPaths?: Record<string, string>;
  repositorySyncedPaths?: Record<string, string>;
  openApiSpec?: string;
}

export interface PlanUpgradeOptions {
  applicationRoot: string;
  baselineAtlasVersion: string;
  targetAtlasVersion: string;
  baselineChecksums: Record<string, string>;
  sourceSyncedPaths: string[];
  sourceGeneratedPaths: string[];
  sourceIndependentPaths: string[];
  syncedPaths: string[];
  generatedPaths: string[];
  independentPaths: string[];
  repositoryRoot?: string;
  sourceRepositorySyncedPaths?: string[];
  repositorySyncedPaths?: string[];
  baselineRepositoryChecksums?: Record<string, string>;
  consumerRepositoryFiles?: Record<string, string>;
  sourceSnapshot: UpgradeSnapshot;
  targetSnapshot: UpgradeSnapshot;
  consumerFiles: Record<string, string>;
  contractSchemaChanged?: boolean;
}

export interface UpgradeMigrationReport {
  id: string;
  sourceVersion: string;
  targetVersion: string;
  description: string;
  automatic: boolean;
  status: "planned" | "applied" | "skipped" | "manual" | "failed" | "conflicted";
  changedPaths: string[];
  message: string;
}

export interface UpgradeValidationReport {
  doctor: "skipped" | "passed" | "failed" | "not-run";
  apiGen: "skipped" | "passed" | "failed" | "not-run";
  message?: string;
}

export interface UpgradeRunResult {
  sourceVersion: string;
  targetVersion: string;
  mode: UpgradeRunMode;
  status: UpgradeRunStatus;
  summary: UpgradePlanSummary;
  items: UpgradePlanItem[];
  conflicts: UpgradePlanItem[];
  migrations: UpgradeMigrationReport[];
  validation: UpgradeValidationReport;
  baselineUpdated: boolean;
  appliedPaths: string[];
  messages: string[];
  latestStable?: string;
  targetResolution?: "latest" | "explicit";
  dependencyInstall?: "passed" | "failed" | "skipped" | "not-run";
}
