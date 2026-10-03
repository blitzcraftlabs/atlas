import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { computeBaselineChecksum } from "@atlas/project";

import { PRODUCTION_MIGRATION_REGISTRY } from "../upgrade/migrations/registry";
import { planUpgrade } from "../upgrade/plan";
import { generateProductionReleaseSnapshot } from "../upgrade/production-snapshot";
import { loadReleaseSnapshot } from "../upgrade/release-snapshot";
import { runUpgrade } from "../upgrade/run";

import { getRepoRoot } from "./helpers/run-cli";

const ERRORS_SOURCE = "export const normalize = () => 'old';\n";
const ERRORS_TARGET = "export const normalize = () => 'old';\n";
const DOCKERFILE_V1 = "FROM node:22-alpine\n";
const DOCKERFILE_V2 = "FROM node:22-alpine\nRUN echo upgraded\n";
const DOCKERIGNORE = "node_modules\n";
const CUSTOM_DOCKERFILE = "FROM alpine\n# consumer multi-target image\n";

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeRelease(options: {
  releasesDir: string;
  version: string;
  errors: string;
  repositoryFiles?: Record<string, string>;
}): void {
  const releaseRoot = path.join(options.releasesDir, options.version);
  mkdirSync(path.join(releaseRoot, "apps/web/src/lib/api"), { recursive: true });
  writeFileSync(path.join(releaseRoot, "apps/web/src/lib/api/errors.ts"), options.errors, "utf8");
  writeJson(path.join(releaseRoot, "openapi/openapi.json"), { openapi: "3.0.0", paths: {} });

  const repositorySyncedPaths = Object.keys(options.repositoryFiles ?? {}).sort((left, right) =>
    left.localeCompare(right)
  );
  for (const [relativePath, content] of Object.entries(options.repositoryFiles ?? {})) {
    writeFileSync(path.join(releaseRoot, relativePath), content, "utf8");
  }

  writeJson(path.join(releaseRoot, "release.snapshot.json"), {
    schemaVersion: 1,
    atlasVersion: options.version,
    contractSchemaVersion: 1,
    templateManifestSchemaVersion: 1,
    canonicalApplication: "apps/web",
    syncedPaths: ["src/lib/api/errors.ts"],
    generatedPaths: [],
    independentPaths: [],
    ...(repositorySyncedPaths.length > 0 ? { repositorySyncedPaths } : {}),
    packageVersions: {},
    openApiSpecRelativePath: "openapi/openapi.json",
  });
}

function writeConsumer(options: {
  repoRoot: string;
  atlasVersion: string;
  errors: string;
  repositoryFiles?: Record<string, string>;
  repositoryChecksums?: Record<string, string>;
}): void {
  writeJson(path.join(options.repoRoot, "package.json"), {
    name: "consumer",
    version: options.atlasVersion,
    private: true,
  });
  mkdirSync(path.join(options.repoRoot, "apps/web/src/lib/api"), { recursive: true });
  writeFileSync(
    path.join(options.repoRoot, "apps/web/src/lib/api/errors.ts"),
    options.errors,
    "utf8"
  );
  for (const [relativePath, content] of Object.entries(options.repositoryFiles ?? {})) {
    writeFileSync(path.join(options.repoRoot, relativePath), content, "utf8");
  }
  writeJson(path.join(options.repoRoot, "atlas.config.json"), {
    schemaVersion: 1,
    platform: {
      baseline: {
        atlasVersion: options.atlasVersion,
        contractSchemaVersion: 1,
        templateManifestSchemaVersion: 1,
        syncedPathChecksums: {
          "src/lib/api/errors.ts": computeBaselineChecksum(options.errors),
        },
        ...(options.repositoryChecksums && Object.keys(options.repositoryChecksums).length > 0
          ? { repositorySyncedPathChecksums: options.repositoryChecksums }
          : {}),
      },
    },
  });
}

describe("1.2.0 production snapshots remain readable", () => {
  it("loads the published 1.2.0 snapshot without repository Docker paths", () => {
    const loaded = loadReleaseSnapshot({
      atlasVersion: "1.2.0",
      releasesDir: path.join(getRepoRoot(), "packages/cli/release-assets/production"),
    });

    expect(loaded.manifest.schemaVersion).toBe(1);
    expect(loaded.manifest.repositorySyncedPaths ?? []).toEqual([]);
    expect(loaded.snapshot.repositorySyncedPaths).toBeUndefined();
  });
});

describe("repository-level Docker upgrade planning", () => {
  const baselineChecksums = {
    "src/lib/api/errors.ts": computeBaselineChecksum(ERRORS_SOURCE),
  };

  it("creates a missing repository file introduced by the target release", () => {
    const plan = planUpgrade({
      applicationRoot: "apps/web",
      repositoryRoot: "/tmp/consumer",
      baselineAtlasVersion: "1.2.0",
      targetAtlasVersion: "1.2.1",
      baselineChecksums,
      sourceSyncedPaths: ["src/lib/api/errors.ts"],
      sourceGeneratedPaths: [],
      sourceIndependentPaths: [],
      syncedPaths: ["src/lib/api/errors.ts"],
      generatedPaths: [],
      independentPaths: [],
      sourceRepositorySyncedPaths: [],
      repositorySyncedPaths: ["Dockerfile"],
      sourceSnapshot: { syncedPaths: { "src/lib/api/errors.ts": ERRORS_SOURCE } },
      targetSnapshot: {
        syncedPaths: { "src/lib/api/errors.ts": ERRORS_TARGET },
        repositorySyncedPaths: { Dockerfile: DOCKERFILE_V1 },
      },
      consumerFiles: { "src/lib/api/errors.ts": ERRORS_SOURCE },
      consumerRepositoryFiles: {},
    });

    const dockerfile = plan.items.find((item) => item.relativePath === "Dockerfile");
    expect(dockerfile?.action).toBe("create");
    expect(dockerfile?.conflict).toBe(false);
    expect(dockerfile?.pathScope).toBe("repository");
    expect(plan.hasBlockingConflicts).toBe(false);
  });

  it("adopts a consumer file that already equals the target without conflict", () => {
    const plan = planUpgrade({
      applicationRoot: "apps/web",
      baselineAtlasVersion: "1.2.0",
      targetAtlasVersion: "1.2.1",
      baselineChecksums,
      sourceSyncedPaths: ["src/lib/api/errors.ts"],
      sourceGeneratedPaths: [],
      sourceIndependentPaths: [],
      syncedPaths: ["src/lib/api/errors.ts"],
      generatedPaths: [],
      independentPaths: [],
      sourceRepositorySyncedPaths: [],
      repositorySyncedPaths: ["Dockerfile"],
      sourceSnapshot: { syncedPaths: { "src/lib/api/errors.ts": ERRORS_SOURCE } },
      targetSnapshot: {
        syncedPaths: { "src/lib/api/errors.ts": ERRORS_TARGET },
        repositorySyncedPaths: { Dockerfile: DOCKERFILE_V1 },
      },
      consumerFiles: { "src/lib/api/errors.ts": ERRORS_SOURCE },
      consumerRepositoryFiles: { Dockerfile: DOCKERFILE_V1 },
    });

    const dockerfile = plan.items.find((item) => item.relativePath === "Dockerfile");
    expect(dockerfile?.action).toBe("skip");
    expect(dockerfile?.conflict).toBe(false);
    expect(plan.hasBlockingConflicts).toBe(false);
  });

  it("adopts an existing repository path that already equals a changed target", () => {
    const plan = planUpgrade({
      applicationRoot: "apps/web",
      baselineAtlasVersion: "9.1.0",
      targetAtlasVersion: "9.2.0",
      baselineChecksums,
      baselineRepositoryChecksums: {
        Dockerfile: computeBaselineChecksum(DOCKERFILE_V1),
      },
      sourceSyncedPaths: ["src/lib/api/errors.ts"],
      sourceGeneratedPaths: [],
      sourceIndependentPaths: [],
      syncedPaths: ["src/lib/api/errors.ts"],
      generatedPaths: [],
      independentPaths: [],
      sourceRepositorySyncedPaths: ["Dockerfile"],
      repositorySyncedPaths: ["Dockerfile"],
      sourceSnapshot: {
        syncedPaths: { "src/lib/api/errors.ts": ERRORS_SOURCE },
        repositorySyncedPaths: { Dockerfile: DOCKERFILE_V1 },
      },
      targetSnapshot: {
        syncedPaths: { "src/lib/api/errors.ts": ERRORS_TARGET },
        repositorySyncedPaths: { Dockerfile: DOCKERFILE_V2 },
      },
      consumerFiles: { "src/lib/api/errors.ts": ERRORS_SOURCE },
      consumerRepositoryFiles: { Dockerfile: DOCKERFILE_V2 },
    });

    const dockerfile = plan.items.find((item) => item.relativePath === "Dockerfile");
    expect(dockerfile?.action).toBe("skip");
    expect(dockerfile?.category).toBe("patch-safe");
    expect(dockerfile?.conflict).toBe(false);
    expect(dockerfile?.baselineStatus).toBe("modified");
    expect(plan.hasBlockingConflicts).toBe(false);
  });

  it("reports manual review for a customized file with no baseline and does not conflict-block", () => {
    const plan = planUpgrade({
      applicationRoot: "apps/web",
      baselineAtlasVersion: "1.2.0",
      targetAtlasVersion: "1.2.1",
      baselineChecksums,
      sourceSyncedPaths: ["src/lib/api/errors.ts"],
      sourceGeneratedPaths: [],
      sourceIndependentPaths: [],
      syncedPaths: ["src/lib/api/errors.ts"],
      generatedPaths: [],
      independentPaths: [],
      sourceRepositorySyncedPaths: [],
      repositorySyncedPaths: ["Dockerfile"],
      sourceSnapshot: { syncedPaths: { "src/lib/api/errors.ts": ERRORS_SOURCE } },
      targetSnapshot: {
        syncedPaths: { "src/lib/api/errors.ts": ERRORS_TARGET },
        repositorySyncedPaths: { Dockerfile: DOCKERFILE_V1 },
      },
      consumerFiles: { "src/lib/api/errors.ts": ERRORS_SOURCE },
      consumerRepositoryFiles: { Dockerfile: CUSTOM_DOCKERFILE },
    });

    const dockerfile = plan.items.find((item) => item.relativePath === "Dockerfile");
    expect(dockerfile?.action).toBe("manual-review");
    expect(dockerfile?.conflict).toBe(false);
    expect(plan.hasBlockingConflicts).toBe(false);
  });
});

describe("repository-level Docker upgrade apply", () => {
  it("creates missing Docker files from 1.2.0-style snapshots and records checksums", async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-repo-docker-create-"));
    const releasesDir = path.join(tempRoot, "releases");
    writeRelease({
      releasesDir,
      version: "9.0.0",
      errors: ERRORS_SOURCE,
    });
    writeRelease({
      releasesDir,
      version: "9.1.0",
      errors: ERRORS_TARGET,
      repositoryFiles: { Dockerfile: DOCKERFILE_V1, ".dockerignore": DOCKERIGNORE },
    });
    writeConsumer({
      repoRoot: tempRoot,
      atlasVersion: "9.0.0",
      errors: ERRORS_SOURCE,
    });

    const result = await runUpgrade({
      repoRoot: tempRoot,
      targetVersion: "9.1.0",
      allowDirty: true,
      skipValidation: true,
      releasesDir,
      migrationRegistry: PRODUCTION_MIGRATION_REGISTRY,
    });

    expect(result.status).toBe("success");
    expect(readFileSync(path.join(tempRoot, "Dockerfile"), "utf8")).toBe(DOCKERFILE_V1);
    expect(readFileSync(path.join(tempRoot, ".dockerignore"), "utf8")).toBe(DOCKERIGNORE);
    const contract = JSON.parse(readFileSync(path.join(tempRoot, "atlas.config.json"), "utf8")) as {
      platform: { baseline: { repositorySyncedPathChecksums?: Record<string, string> } };
    };
    expect(contract.platform.baseline.repositorySyncedPathChecksums?.Dockerfile).toBe(
      computeBaselineChecksum(DOCKERFILE_V1)
    );

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("adopts an equal existing Dockerfile and records canonical checksums", async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-repo-docker-adopt-"));
    const releasesDir = path.join(tempRoot, "releases");
    writeRelease({ releasesDir, version: "9.0.0", errors: ERRORS_SOURCE });
    writeRelease({
      releasesDir,
      version: "9.1.0",
      errors: ERRORS_TARGET,
      repositoryFiles: { Dockerfile: DOCKERFILE_V1 },
    });
    writeConsumer({
      repoRoot: tempRoot,
      atlasVersion: "9.0.0",
      errors: ERRORS_SOURCE,
      repositoryFiles: { Dockerfile: DOCKERFILE_V1 },
    });

    const result = await runUpgrade({
      repoRoot: tempRoot,
      targetVersion: "9.1.0",
      allowDirty: true,
      skipValidation: true,
      releasesDir,
      migrationRegistry: PRODUCTION_MIGRATION_REGISTRY,
    });

    expect(result.status).toBe("success");
    expect(result.items.find((item) => item.relativePath === "Dockerfile")?.action).toBe("skip");
    const contract = JSON.parse(readFileSync(path.join(tempRoot, "atlas.config.json"), "utf8")) as {
      platform: { baseline: { repositorySyncedPathChecksums?: Record<string, string> } };
    };
    expect(contract.platform.baseline.repositorySyncedPathChecksums?.Dockerfile).toBe(
      computeBaselineChecksum(DOCKERFILE_V1)
    );

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("leaves a customized Dockerfile untouched and does not record the canonical checksum", async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-repo-docker-custom-"));
    const releasesDir = path.join(tempRoot, "releases");
    writeRelease({ releasesDir, version: "9.0.0", errors: ERRORS_SOURCE });
    writeRelease({
      releasesDir,
      version: "9.1.0",
      errors: ERRORS_TARGET,
      repositoryFiles: { Dockerfile: DOCKERFILE_V1 },
    });
    writeConsumer({
      repoRoot: tempRoot,
      atlasVersion: "9.0.0",
      errors: ERRORS_SOURCE,
      repositoryFiles: { Dockerfile: CUSTOM_DOCKERFILE },
    });

    const result = await runUpgrade({
      repoRoot: tempRoot,
      targetVersion: "9.1.0",
      allowDirty: true,
      skipValidation: true,
      releasesDir,
      migrationRegistry: PRODUCTION_MIGRATION_REGISTRY,
    });

    expect(result.status).toBe("success");
    expect(result.baselineUpdated).toBe(true);
    expect(result.items.find((item) => item.relativePath === "Dockerfile")?.action).toBe(
      "manual-review"
    );
    expect(readFileSync(path.join(tempRoot, "Dockerfile"), "utf8")).toBe(CUSTOM_DOCKERFILE);
    const contract = JSON.parse(readFileSync(path.join(tempRoot, "atlas.config.json"), "utf8")) as {
      platform: { baseline: { repositorySyncedPathChecksums?: Record<string, string> } };
    };
    expect(contract.platform.baseline.repositorySyncedPathChecksums?.Dockerfile).toBeUndefined();

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("replaces a tracked unchanged Dockerfile when Atlas later changes it", async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-repo-docker-replace-"));
    const releasesDir = path.join(tempRoot, "releases");
    writeRelease({
      releasesDir,
      version: "9.1.0",
      errors: ERRORS_SOURCE,
      repositoryFiles: { Dockerfile: DOCKERFILE_V1 },
    });
    writeRelease({
      releasesDir,
      version: "9.2.0",
      errors: ERRORS_TARGET,
      repositoryFiles: { Dockerfile: DOCKERFILE_V2 },
    });
    writeConsumer({
      repoRoot: tempRoot,
      atlasVersion: "9.1.0",
      errors: ERRORS_SOURCE,
      repositoryFiles: { Dockerfile: DOCKERFILE_V1 },
      repositoryChecksums: { Dockerfile: computeBaselineChecksum(DOCKERFILE_V1) },
    });

    const result = await runUpgrade({
      repoRoot: tempRoot,
      targetVersion: "9.2.0",
      allowDirty: true,
      skipValidation: true,
      releasesDir,
      migrationRegistry: PRODUCTION_MIGRATION_REGISTRY,
    });

    expect(result.status).toBe("success");
    expect(result.items.find((item) => item.relativePath === "Dockerfile")?.action).toBe("replace");
    expect(readFileSync(path.join(tempRoot, "Dockerfile"), "utf8")).toBe(DOCKERFILE_V2);
    const contract = JSON.parse(readFileSync(path.join(tempRoot, "atlas.config.json"), "utf8")) as {
      platform: { baseline: { repositorySyncedPathChecksums?: Record<string, string> } };
    };
    expect(contract.platform.baseline.repositorySyncedPathChecksums?.Dockerfile).toBe(
      computeBaselineChecksum(DOCKERFILE_V2)
    );

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("resumes when a repository synced path was already replaced before install failed", async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-repo-docker-retry-"));
    const releasesDir = path.join(tempRoot, "releases");
    writeRelease({
      releasesDir,
      version: "9.1.0",
      errors: ERRORS_SOURCE,
      repositoryFiles: { Dockerfile: DOCKERFILE_V1 },
    });
    writeRelease({
      releasesDir,
      version: "9.2.0",
      errors: ERRORS_TARGET,
      repositoryFiles: { Dockerfile: DOCKERFILE_V2 },
    });
    writeConsumer({
      repoRoot: tempRoot,
      atlasVersion: "9.1.0",
      errors: ERRORS_SOURCE,
      repositoryFiles: { Dockerfile: DOCKERFILE_V1 },
      repositoryChecksums: { Dockerfile: computeBaselineChecksum(DOCKERFILE_V1) },
    });

    const failed = await runUpgrade({
      repoRoot: tempRoot,
      targetVersion: "9.2.0",
      allowDirty: true,
      skipValidation: true,
      installDependencies: true,
      installDependenciesRunner: () => ({
        status: "failed",
        message: "pnpm install failed",
      }),
      releasesDir,
      migrationRegistry: PRODUCTION_MIGRATION_REGISTRY,
    });

    expect(failed.status).toBe("validation-failed");
    expect(failed.baselineUpdated).toBe(false);
    expect(readFileSync(path.join(tempRoot, "Dockerfile"), "utf8")).toBe(DOCKERFILE_V2);
    const baselineAfterFailure = JSON.parse(
      readFileSync(path.join(tempRoot, "atlas.config.json"), "utf8")
    ) as { platform: { baseline: { atlasVersion: string } } };
    expect(baselineAfterFailure.platform.baseline.atlasVersion).toBe("9.1.0");

    const dockerfileMtime = statSync(path.join(tempRoot, "Dockerfile")).mtimeMs;
    const resumed = await runUpgrade({
      repoRoot: tempRoot,
      targetVersion: "9.2.0",
      allowDirty: true,
      skipValidation: true,
      installDependencies: true,
      installDependenciesRunner: () => ({
        status: "passed",
        message: "pnpm install completed",
      }),
      releasesDir,
      migrationRegistry: PRODUCTION_MIGRATION_REGISTRY,
    });

    expect(resumed.status).toBe("success");
    expect(resumed.baselineUpdated).toBe(true);
    const dockerfile = resumed.items.find((item) => item.relativePath === "Dockerfile");
    expect(dockerfile?.action).toBe("skip");
    expect(dockerfile?.category).toBe("patch-safe");
    expect(dockerfile?.conflict).toBe(false);
    expect(statSync(path.join(tempRoot, "Dockerfile")).mtimeMs).toBe(dockerfileMtime);
    expect(readFileSync(path.join(tempRoot, "Dockerfile"), "utf8")).toBe(DOCKERFILE_V2);
    const contract = JSON.parse(readFileSync(path.join(tempRoot, "atlas.config.json"), "utf8")) as {
      platform: { baseline: { atlasVersion: string } };
    };
    expect(contract.platform.baseline.atlasVersion).toBe("9.2.0");

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("never overwrites a tracked Dockerfile the consumer modified", async () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-repo-docker-modified-"));
    const releasesDir = path.join(tempRoot, "releases");
    writeRelease({
      releasesDir,
      version: "9.1.0",
      errors: ERRORS_SOURCE,
      repositoryFiles: { Dockerfile: DOCKERFILE_V1 },
    });
    writeRelease({
      releasesDir,
      version: "9.2.0",
      errors: ERRORS_TARGET,
      repositoryFiles: { Dockerfile: DOCKERFILE_V2 },
    });
    writeConsumer({
      repoRoot: tempRoot,
      atlasVersion: "9.1.0",
      errors: ERRORS_SOURCE,
      repositoryFiles: { Dockerfile: CUSTOM_DOCKERFILE },
      repositoryChecksums: { Dockerfile: computeBaselineChecksum(DOCKERFILE_V1) },
    });

    const result = await runUpgrade({
      repoRoot: tempRoot,
      targetVersion: "9.2.0",
      allowDirty: true,
      skipValidation: true,
      releasesDir,
      migrationRegistry: PRODUCTION_MIGRATION_REGISTRY,
    });

    expect(result.status).toBe("success");
    expect(result.items.find((item) => item.relativePath === "Dockerfile")?.action).toBe(
      "manual-review"
    );
    expect(readFileSync(path.join(tempRoot, "Dockerfile"), "utf8")).toBe(CUSTOM_DOCKERFILE);
    const contract = JSON.parse(readFileSync(path.join(tempRoot, "atlas.config.json"), "utf8")) as {
      platform: { baseline: { repositorySyncedPathChecksums?: Record<string, string> } };
    };
    expect(contract.platform.baseline.repositorySyncedPathChecksums?.Dockerfile).toBeUndefined();
    expect(contract.platform.baseline.repositorySyncedPathChecksums?.Dockerfile).not.toBe(
      computeBaselineChecksum(DOCKERFILE_V2)
    );

    rmSync(tempRoot, { recursive: true, force: true });
  });
});

describe("production snapshot generation includes repository Docker surfaces", () => {
  it("copies repositorySyncedPaths at the snapshot root, not under apps/web", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-snapshot-repo-"));
    writeJson(path.join(repoRoot, "package.json"), {
      name: "@atlas/monorepo",
      version: "9.9.9",
      private: true,
    });
    writeJson(path.join(repoRoot, "atlas.config.json"), { schemaVersion: 1 });
    writeJson(path.join(repoRoot, "templates/app-infrastructure.manifest.json"), {
      schemaVersion: 1,
      canonicalApplication: "apps/web",
      consumerApplications: [],
      syncedPaths: ["src/lib/api/errors.ts"],
      generatedPaths: [],
      independentPaths: {},
      referenceOnlyPaths: [],
      starterOnlyPaths: [],
      repositorySyncedPaths: ["Dockerfile", ".dockerignore"],
    });
    mkdirSync(path.join(repoRoot, "apps/web/src/lib/api"), { recursive: true });
    writeFileSync(path.join(repoRoot, "apps/web/src/lib/api/errors.ts"), ERRORS_SOURCE, "utf8");
    writeFileSync(path.join(repoRoot, "Dockerfile"), DOCKERFILE_V1, "utf8");
    writeFileSync(path.join(repoRoot, ".dockerignore"), DOCKERIGNORE, "utf8");
    writeJson(path.join(repoRoot, "packages/cli/package.json"), {
      name: "@blitzcraftlabs/atlas",
      version: "9.9.9",
    });

    const outputParent = mkdtempSync(path.join(os.tmpdir(), "atlas-snapshot-out-"));
    const generated = generateProductionReleaseSnapshot({
      repoRoot,
      outputDir: path.join(outputParent, "9.9.9"),
      replace: true,
    });

    expect(generated.manifest.repositorySyncedPaths).toEqual([".dockerignore", "Dockerfile"]);
    expect(readFileSync(path.join(outputParent, "9.9.9", "Dockerfile"), "utf8")).toBe(
      DOCKERFILE_V1
    );
    expect(
      loadReleaseSnapshot({ atlasVersion: "9.9.9", releasesDir: outputParent }).snapshot
        .repositorySyncedPaths?.Dockerfile
    ).toBe(DOCKERFILE_V1);

    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(outputParent, { recursive: true, force: true });
  });
});
