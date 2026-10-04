import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  ATLAS_CONTRACT_FILENAME,
  joinRepoPath,
  type PlatformBaseline,
  type RawAtlasProjectContract,
  readAtlasProjectContractFile,
} from "@atlas/project";

import { doctorExitCodeIndicatesFailure, runDoctor } from "../doctor";
import { CliError, CliErrorCode } from "../errors/cli-error";
import { SUPPORTED_APP_INFRASTRUCTURE_MANIFEST_SCHEMA_VERSION } from "../template-sync/manifest";

import {
  assertMigrationChainExecutable,
  type AtlasMigrationDefinition,
  PRODUCTION_MIGRATION_REGISTRY,
} from "./migrations/registry";
import { applySafeUpgradeReplacements } from "./apply";
import {
  captureConsumerPlatformBaseline,
  mergePlatformBaselineIntoContract,
  readContractPlatformBaseline,
  selectRepositorySyncedPathChecksumsForUpgrade,
} from "./baseline";
import { validateUpgradeSourceBaseline } from "./baseline-validation";
import { applyConsumerCliPin, planConsumerCliPin } from "./consumer-cli-manifest";
import { installConsumerDependencies } from "./dependency-install";
import { applyPackageUpdates, hasUnresolvedRequiredPackageWork } from "./package-apply";
import { planPackageUpdates } from "./package-plan";
import { planUpgrade } from "./plan";
import {
  assertPackagedReleaseSupported,
  findReleaseAssetRoot,
  readPackagedReleaseCatalog,
} from "./release-assets";
import {
  buildManifestSubsetFromRelease,
  type LoadedReleaseSnapshot,
  loadReleaseSnapshot,
  toReleasePathManifest,
} from "./release-snapshot";
import { compareAtlasVersions } from "./version-compare";
import { writeRootPackageVersion } from "./version-identity";
import { assertCleanWorktreeForMutation } from "./worktree";

import type { AtlasMigrationRegistry } from "./migrations/types";
import type {
  UpgradeMigrationReport,
  UpgradePlanItem,
  UpgradePlanSummary,
  UpgradeRunResult,
  UpgradeRunStatus,
  UpgradeValidationReport,
} from "./types";

export interface RunUpgradeOptions {
  repoRoot: string;
  targetVersion: string;
  dryRun?: boolean;
  allowDirty?: boolean;
  releasesDir?: string;
  skipValidation?: boolean;
  migrationRegistry?: AtlasMigrationRegistry;
  /**
   * Install dependencies after Atlas-managed edits. Fixture `--releases-dir` runs skip this
   * unless it is set explicitly.
   */
  installDependencies?: boolean;
  installDependenciesRunner?: typeof installConsumerDependencies;
}

function readConsumerFile(
  applicationAbsoluteRoot: string,
  relativePath: string
): string | undefined {
  const absolutePath = joinRepoPath(applicationAbsoluteRoot, relativePath);
  if (!existsSync(absolutePath)) {
    return undefined;
  }

  return readFileSync(absolutePath, "utf8");
}

function loadConsumerFiles(
  applicationAbsoluteRoot: string,
  relativePaths: string[]
): Record<string, string> {
  const files: Record<string, string> = {};

  for (const relativePath of relativePaths) {
    const content = readConsumerFile(applicationAbsoluteRoot, relativePath);
    if (content !== undefined) {
      files[relativePath] = content;
    }
  }

  return files;
}

function mergePlanItems(
  baseItems: UpgradePlanItem[],
  extraItems: UpgradePlanItem[]
): UpgradePlanItem[] {
  return [...baseItems, ...extraItems].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}

function summarizeMergedItems(items: UpgradePlanItem[]): UpgradePlanSummary {
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

function buildMigrationReports(
  migrations: AtlasMigrationDefinition[],
  mode: "dry-run" | "apply",
  applied: UpgradeMigrationReport[]
): UpgradeMigrationReport[] {
  const appliedById = new Map(applied.map((entry) => [entry.id, entry]));

  return migrations.map((migration) => {
    const existing = appliedById.get(migration.id);
    if (existing) {
      return existing;
    }

    if (mode === "dry-run") {
      return {
        id: migration.id,
        sourceVersion: migration.sourceVersion,
        targetVersion: migration.targetVersion,
        description: migration.description,
        automatic: migration.automatic,
        status: migration.automatic ? "planned" : "manual",
        changedPaths: [],
        message: migration.automatic
          ? `Migration ${migration.id} is planned between Atlas ${migration.sourceVersion} and ${migration.targetVersion}.`
          : `Migration ${migration.id} requires manual review.`,
      };
    }

    return {
      id: migration.id,
      sourceVersion: migration.sourceVersion,
      targetVersion: migration.targetVersion,
      description: migration.description,
      automatic: migration.automatic,
      status: migration.automatic ? "skipped" : "manual",
      changedPaths: [],
      message: migration.automatic
        ? `Migration ${migration.id} was not executed.`
        : `Migration ${migration.id} requires manual review.`,
    };
  });
}

function runApiGen(repoRoot: string): { ok: boolean; message: string } {
  const result = spawnSync("pnpm", ["api:gen"], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (result.status === 0) {
    return { ok: true, message: "pnpm api:gen completed successfully." };
  }

  const stderr = result.stderr?.trim() || result.stdout?.trim() || "pnpm api:gen failed.";
  return { ok: false, message: stderr };
}

function writePlatformBaseline(
  repoRoot: string,
  contract: RawAtlasProjectContract,
  baseline: PlatformBaseline
): void {
  const updatedContract = mergePlatformBaselineIntoContract(contract, baseline);
  const contractPath = joinRepoPath(repoRoot, ATLAS_CONTRACT_FILENAME);
  writeFileSync(contractPath, `${JSON.stringify(updatedContract, null, 2)}\n`, "utf8");
}

function resolveUpgradeReleaseEvidence(releasesDir?: string): {
  releasesDir: string;
  catalog?: ReturnType<typeof readPackagedReleaseCatalog>;
} {
  if (releasesDir) {
    return { releasesDir: path.resolve(releasesDir) };
  }

  const assetRoot = findReleaseAssetRoot();
  return {
    releasesDir: assetRoot,
    catalog: readPackagedReleaseCatalog(assetRoot),
  };
}

function loadUpgradeSnapshots(options: {
  sourceVersion: string;
  targetVersion: string;
  releasesDir?: string;
}): {
  sourceRelease: LoadedReleaseSnapshot;
  targetRelease: LoadedReleaseSnapshot;
} {
  const evidence = resolveUpgradeReleaseEvidence(options.releasesDir);
  if (evidence.catalog) {
    assertPackagedReleaseSupported({
      sourceVersion: options.sourceVersion,
      targetVersion: options.targetVersion,
      catalog: evidence.catalog,
    });
  }

  return {
    sourceRelease: loadReleaseSnapshot({
      atlasVersion: options.sourceVersion,
      releasesDir: evidence.releasesDir,
    }),
    targetRelease: loadReleaseSnapshot({
      atlasVersion: options.targetVersion,
      releasesDir: evidence.releasesDir,
    }),
  };
}

function collectConsumerRelativePaths(
  sourceRelease: LoadedReleaseSnapshot,
  targetRelease: LoadedReleaseSnapshot
): string[] {
  const sourcePaths = toReleasePathManifest(sourceRelease.manifest);
  const targetPaths = toReleasePathManifest(targetRelease.manifest);

  return [
    ...new Set([
      ...sourcePaths.syncedPaths,
      ...targetPaths.syncedPaths,
      ...sourcePaths.generatedPaths,
      ...targetPaths.generatedPaths,
      ...sourcePaths.independentPaths,
      ...targetPaths.independentPaths,
    ]),
  ].sort((left, right) => left.localeCompare(right));
}

function assertUpgradePrerequisites(options: {
  baseline: PlatformBaseline;
  sourceRelease: LoadedReleaseSnapshot;
  targetRelease: LoadedReleaseSnapshot;
  migrationChain: AtlasMigrationDefinition[];
  migrationRegistry: AtlasMigrationRegistry;
}): void {
  const sourceManifest = toReleasePathManifest(options.sourceRelease.manifest);
  const targetManifest = toReleasePathManifest(options.targetRelease.manifest);

  const baselineIntegrityIssues = validateUpgradeSourceBaseline({
    baseline: options.baseline,
    sourceSyncedPaths: sourceManifest.syncedPaths,
    targetSyncedPaths: targetManifest.syncedPaths,
    currentManifestSchemaVersion: SUPPORTED_APP_INFRASTRUCTURE_MANIFEST_SCHEMA_VERSION,
  });

  if (baselineIntegrityIssues.length > 0) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      "platform.baseline is incomplete or inconsistent with the source Atlas release manifest.",
      {
        details: baselineIntegrityIssues.map((issue) => issue.message),
      }
    );
  }

  try {
    assertMigrationChainExecutable(options.migrationChain, options.migrationRegistry);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Migration chain is not executable.";
    throw new CliError(CliErrorCode.UPGRADE_PREREQUISITE, message);
  }
}

export async function runUpgrade(options: RunUpgradeOptions): Promise<UpgradeRunResult> {
  const mode = options.dryRun ? "dry-run" : "apply";
  const migrationRegistry = options.migrationRegistry ?? PRODUCTION_MIGRATION_REGISTRY;
  const contract = readAtlasProjectContractFile(options.repoRoot);
  const baseline = readContractPlatformBaseline(contract);

  if (!baseline) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      "platform.baseline is missing from atlas.config.json. Record a baseline via atlas init before upgrading."
    );
  }

  const sourceVersion = baseline.atlasVersion;
  const targetVersion = options.targetVersion;

  if (compareAtlasVersions(sourceVersion, targetVersion) === 0) {
    return {
      sourceVersion,
      targetVersion,
      mode,
      status: "already-current",
      summary: summarizeMergedItems([]),
      items: [],
      conflicts: [],
      migrations: [],
      validation: { doctor: "skipped", apiGen: "skipped" },
      baselineUpdated: false,
      appliedPaths: [],
      messages: [`Atlas is already current (${sourceVersion}).`],
    };
  }

  if (compareAtlasVersions(sourceVersion, targetVersion) > 0) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Downgrade from Atlas ${sourceVersion} to ${targetVersion} is not supported.`
    );
  }

  const { sourceRelease, targetRelease } = loadUpgradeSnapshots({
    sourceVersion,
    targetVersion,
    releasesDir: options.releasesDir,
  });

  const migrationChain = migrationRegistry.resolveChain(sourceVersion, targetVersion);
  if (migrationChain.missingTarget) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Missing migration chain from Atlas ${sourceVersion} to ${targetVersion}. No registered migration starts from the current chain position.`,
      {
        details: migrationChain.migrations.map(
          (migration) => `${migration.sourceVersion} → ${migration.targetVersion} (${migration.id})`
        ),
      }
    );
  }

  assertUpgradePrerequisites({
    baseline,
    sourceRelease,
    targetRelease,
    migrationChain: migrationChain.migrations,
    migrationRegistry,
  });

  const targetManifestSubset = buildManifestSubsetFromRelease(targetRelease.manifest);
  const sourceManifest = toReleasePathManifest(sourceRelease.manifest);
  const targetManifest = toReleasePathManifest(targetRelease.manifest);

  const applicationRoot = targetRelease.manifest.canonicalApplication;
  const applicationAbsoluteRoot = joinRepoPath(options.repoRoot, applicationRoot);
  const sourceRepositorySyncedPaths = sourceRelease.manifest.repositorySyncedPaths ?? [];
  const targetRepositorySyncedPaths = targetRelease.manifest.repositorySyncedPaths ?? [];
  const consumerFiles = loadConsumerFiles(
    applicationAbsoluteRoot,
    collectConsumerRelativePaths(sourceRelease, targetRelease)
  );
  const consumerRepositoryFiles = loadConsumerFiles(options.repoRoot, [
    ...new Set([...sourceRepositorySyncedPaths, ...targetRepositorySyncedPaths]),
  ]);

  const contractSchemaChanged =
    sourceRelease.manifest.contractSchemaVersion !== targetRelease.manifest.contractSchemaVersion;

  const templatePlan = planUpgrade({
    applicationRoot,
    baselineAtlasVersion: sourceVersion,
    targetAtlasVersion: targetVersion,
    baselineChecksums: baseline.syncedPathChecksums,
    sourceSyncedPaths: sourceManifest.syncedPaths,
    sourceGeneratedPaths: sourceManifest.generatedPaths,
    sourceIndependentPaths: sourceManifest.independentPaths,
    syncedPaths: targetManifest.syncedPaths,
    generatedPaths: targetManifest.generatedPaths,
    independentPaths: targetManifest.independentPaths,
    repositoryRoot: options.repoRoot,
    sourceRepositorySyncedPaths,
    repositorySyncedPaths: targetRepositorySyncedPaths,
    baselineRepositoryChecksums: baseline.repositorySyncedPathChecksums ?? {},
    consumerRepositoryFiles,
    sourceSnapshot: sourceRelease.snapshot,
    targetSnapshot: targetRelease.snapshot,
    consumerFiles,
    contractSchemaChanged,
    migrationChain: migrationChain.migrations,
  });

  const packageItems = planPackageUpdates({
    repoRoot: options.repoRoot,
    baselineAtlasVersion: sourceVersion,
    sourceManifest: sourceRelease.manifest,
    targetManifest: targetRelease.manifest,
  });
  const cliPinPlan = planConsumerCliPin({
    repoRoot: options.repoRoot,
    sourceVersion,
    targetVersion,
  });

  const items = mergePlanItems(templatePlan.items, [...packageItems, ...cliPinPlan.items]);
  const summary = summarizeMergedItems(items);
  const conflicts = items.filter((item) => item.conflict);
  const hasBlockingConflicts = conflicts.length > 0;
  const hasUnresolvedManualMigrations = templatePlan.hasIncompleteMigrations;
  const hasUnresolvedPackageWork = hasUnresolvedRequiredPackageWork(items);

  const migrationReports = buildMigrationReports(migrationChain.migrations, mode, []);

  let status: UpgradeRunStatus = "planned";
  const appliedPaths: string[] = [];
  const messages: string[] = [];
  let baselineUpdated = false;
  let validation: UpgradeValidationReport = { doctor: "skipped", apiGen: "skipped" };

  if (hasBlockingConflicts || hasUnresolvedManualMigrations || hasUnresolvedPackageWork) {
    status = "blocked";
    if (hasBlockingConflicts) {
      messages.push(
        "Upgrade plan contains blocking conflicts. No filesystem mutations were applied."
      );
    } else if (hasUnresolvedPackageWork) {
      messages.push(
        "Upgrade plan contains unresolved required package updates. No filesystem mutations were applied."
      );
    } else {
      messages.push(
        "Upgrade plan requires manual migrations or ownership reconciliation before template updates can proceed."
      );
    }

    return {
      sourceVersion,
      targetVersion,
      mode,
      status,
      summary,
      items,
      conflicts,
      migrations: migrationReports,
      validation,
      baselineUpdated,
      appliedPaths,
      messages,
    };
  }

  if (mode === "dry-run") {
    messages.push("Dry-run completed. No filesystem mutations were applied.");

    return {
      sourceVersion,
      targetVersion,
      mode,
      status: "planned",
      summary,
      items,
      conflicts,
      migrations: migrationReports,
      validation,
      baselineUpdated,
      appliedPaths,
      messages,
    };
  }

  assertCleanWorktreeForMutation({
    repoRoot: options.repoRoot,
    allowDirty: options.allowDirty ?? false,
  });

  let migrationResults: UpgradeMigrationReport[] = [];
  try {
    const appliedMigrations = migrationRegistry.runChain(migrationChain.migrations, {
      repoRoot: options.repoRoot,
      dryRun: false,
    });

    migrationResults = appliedMigrations.map((migrationResult) => {
      const definition = migrationChain.migrations.find(
        (entry) => entry.id === migrationResult.migrationId
      );

      return {
        id: migrationResult.migrationId,
        sourceVersion: definition?.sourceVersion ?? sourceVersion,
        targetVersion: definition?.targetVersion ?? targetVersion,
        description: definition?.description ?? "",
        automatic: definition?.automatic ?? true,
        status: "applied" as const,
        changedPaths: migrationResult.changedPaths,
        message: migrationResult.message,
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Migration execution failed.";
    status = "migration-failed";
    messages.push(message);
    messages.push("Upgrade aborted. platform.baseline was not advanced.");

    return {
      sourceVersion,
      targetVersion,
      mode,
      status,
      summary,
      items,
      conflicts,
      migrations: buildMigrationReports(migrationChain.migrations, mode, migrationResults),
      validation,
      baselineUpdated: false,
      appliedPaths,
      messages,
    };
  }

  const applyResult = applySafeUpgradeReplacements({
    applicationRoot: applicationAbsoluteRoot,
    repoRoot: options.repoRoot,
    plan: {
      ...templatePlan,
      items,
    },
    targetSnapshot: {
      ...targetRelease.snapshot.syncedPaths,
      ...(targetRelease.snapshot.repositorySyncedPaths ?? {}),
    },
    dryRun: false,
  });

  for (const appliedItem of applyResult.applied) {
    appliedPaths.push(appliedItem.relativePath);
  }

  const packageApplyResult = applyPackageUpdates({
    repoRoot: options.repoRoot,
    items,
    baselineAtlasVersion: sourceVersion,
    dryRun: false,
  });

  if (packageApplyResult.blocked.length > 0) {
    status = "blocked";
    messages.push(
      "Required workspace package version updates could not be applied automatically. Baseline was not advanced."
    );
    return {
      sourceVersion,
      targetVersion,
      mode,
      status,
      summary,
      items: [
        ...items.filter(
          (item) =>
            !packageApplyResult.blocked.some(
              (blocked) => blocked.relativePath === item.relativePath
            )
        ),
        ...packageApplyResult.blocked,
      ],
      conflicts: [...conflicts, ...packageApplyResult.blocked],
      migrations: buildMigrationReports(migrationChain.migrations, mode, migrationResults),
      validation,
      baselineUpdated: false,
      appliedPaths,
      messages,
    };
  }

  for (const appliedPackagePath of packageApplyResult.applied) {
    appliedPaths.push(appliedPackagePath);
  }

  const cliPinApply = applyConsumerCliPin({
    repoRoot: options.repoRoot,
    sourceVersion,
    targetVersion,
    dryRun: false,
  });
  if (cliPinApply.action === "conflict") {
    status = "blocked";
    messages.push(
      "Root package.json CLI pin could not be updated automatically. Baseline was not advanced."
    );
    return {
      sourceVersion,
      targetVersion,
      mode,
      status,
      summary,
      items: [...items, ...cliPinApply.items],
      conflicts: [...conflicts, ...cliPinApply.items],
      migrations: buildMigrationReports(migrationChain.migrations, mode, migrationResults),
      validation,
      baselineUpdated: false,
      appliedPaths,
      messages,
    };
  }
  if (cliPinApply.action === "update") {
    appliedPaths.push("package.json");
    messages.push(`Pinned @blitzcraftlabs/atlas to ${targetVersion}.`);
  }

  const shouldInstall = options.installDependencies ?? !options.releasesDir;
  let dependencyInstall: UpgradeRunResult["dependencyInstall"] = shouldInstall
    ? "not-run"
    : "skipped";
  if (shouldInstall) {
    const install = (options.installDependenciesRunner ?? installConsumerDependencies)({
      repoRoot: options.repoRoot,
    });
    dependencyInstall = install.status;
    messages.push(install.message);
    if (install.status !== "passed") {
      status = "validation-failed";
      return {
        sourceVersion,
        targetVersion,
        mode,
        status,
        summary,
        items,
        conflicts,
        migrations: buildMigrationReports(migrationChain.migrations, mode, migrationResults),
        validation,
        baselineUpdated: false,
        appliedPaths,
        messages,
        dependencyInstall,
      };
    }
  }

  const regenerateItems = items.filter((item) => item.action === "regenerate");
  if (regenerateItems.length > 0) {
    const apiGenResult = runApiGen(options.repoRoot);
    validation = {
      doctor: "skipped",
      apiGen: apiGenResult.ok ? "passed" : "failed",
      message: apiGenResult.message,
    };

    if (!apiGenResult.ok) {
      status = "validation-failed";
      messages.push(apiGenResult.message);
      return {
        sourceVersion,
        targetVersion,
        mode,
        status,
        summary,
        items,
        conflicts,
        migrations: buildMigrationReports(migrationChain.migrations, mode, migrationResults),
        validation,
        baselineUpdated,
        appliedPaths,
        messages,
        dependencyInstall,
      };
    }

    for (const item of regenerateItems) {
      appliedPaths.push(item.relativePath);
    }
  }

  if (!options.skipValidation) {
    const doctorReport = await runDoctor({ cwd: options.repoRoot });
    const doctorFailed = doctorExitCodeIndicatesFailure(doctorReport);
    validation = {
      doctor: doctorFailed ? "failed" : "passed",
      apiGen: validation.apiGen,
      message: doctorFailed ? "atlas doctor reported architectural errors." : undefined,
    };

    if (doctorFailed) {
      status = "validation-failed";
      messages.push("Post-upgrade atlas doctor validation failed. Baseline was not advanced.");
      return {
        sourceVersion,
        targetVersion,
        mode,
        status,
        summary,
        items,
        conflicts,
        migrations: buildMigrationReports(migrationChain.migrations, mode, migrationResults),
        validation,
        baselineUpdated,
        appliedPaths,
        messages,
        dependencyInstall,
      };
    }
  }

  const refreshedBaseline = captureConsumerPlatformBaseline({
    repoRoot: options.repoRoot,
    applicationRoot,
    atlasVersion: targetVersion,
    contractSchemaVersion: targetRelease.manifest.contractSchemaVersion,
    manifest: targetManifestSubset,
    repositorySyncedPathChecksums: selectRepositorySyncedPathChecksumsForUpgrade({
      repoRoot: options.repoRoot,
      targetRepositorySyncedPaths,
      previousChecksums: baseline.repositorySyncedPathChecksums ?? {},
      items,
      consumerFiles: {
        ...consumerRepositoryFiles,
        ...Object.fromEntries(
          applyResult.applied
            .filter((item) => item.pathScope === "repository")
            .flatMap((item) => {
              const content = targetRelease.snapshot.repositorySyncedPaths?.[item.relativePath];
              return content === undefined ? [] : [[item.relativePath, content] as const];
            })
        ),
      },
      targetContents: targetRelease.snapshot.repositorySyncedPaths ?? {},
    }),
  });

  const refreshedContract = readAtlasProjectContractFile(options.repoRoot);
  writePlatformBaseline(options.repoRoot, refreshedContract, refreshedBaseline);
  writeRootPackageVersion(options.repoRoot, targetVersion);
  baselineUpdated = true;
  status = "success";
  messages.push(`Upgrade completed. platform.baseline advanced to Atlas ${targetVersion}.`);
  if (packageApplyResult.applied.length > 0) {
    messages.push(
      `Aligned ${packageApplyResult.applied.length} workspace @atlas/* package version field(s).`
    );
  }

  return {
    sourceVersion,
    targetVersion,
    mode,
    status,
    summary,
    items,
    conflicts,
    migrations: buildMigrationReports(migrationChain.migrations, mode, migrationResults),
    validation,
    baselineUpdated,
    appliedPaths,
    messages,
    dependencyInstall,
  };
}

export function loadUpgradeReleasePair(options: {
  sourceVersion: string;
  targetVersion: string;
  releasesDir?: string;
}): {
  sourceRelease: LoadedReleaseSnapshot;
  targetRelease: LoadedReleaseSnapshot;
} {
  return loadUpgradeSnapshots(options);
}
