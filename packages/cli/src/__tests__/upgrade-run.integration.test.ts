import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseAtlasProjectContract } from "@atlas/project";

import { createDoctorContext } from "../doctor/context";
import { DoctorDiagnosticCode } from "../doctor/diagnostics";
import { runUpgradeBaselineCheck } from "../doctor/upgrade-baseline";
import * as doctorModule from "../doctor";
import { FIXTURE_MIGRATION_REGISTRY } from "./fixtures/upgrade-migrations/registry";
import { listRegisteredMigrations } from "../upgrade/migrations/registry";
import type { AtlasMigrationDefinition } from "../upgrade/migrations/types";
import { runUpgrade } from "../upgrade/run";

const FIXTURE_ROOT = path.resolve(__dirname, "fixtures/upgrade-e2e");

const fixtureUpgradeOptions = {
  migrationRegistry: FIXTURE_MIGRATION_REGISTRY,
} as const;

function fixtureOptions(tempRoot: string) {
  return {
    ...fixtureUpgradeOptions,
    releasesDir: path.join(tempRoot, "releases"),
  };
}

function copyFixtureToTemp(): string {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-upgrade-run-"));
  cpSync(FIXTURE_ROOT, tempRoot, { recursive: true });
  return tempRoot;
}

describe("upgrade run integration", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("runs doctor during apply when validation is enabled", async () => {
    const tempRoot = copyFixtureToTemp();
    const doctorSpy = jest.spyOn(doctorModule, "runDoctor").mockResolvedValue({
      schemaVersion: 1,
      status: "healthy",
      atlasVersion: "0.2.0",
      projectRoot: ".",
      summary: {
        checksPassed: 1,
        checksWarned: 0,
        checksFailed: 0,
        checksSkipped: 0,
        diagnosticWarnings: 0,
        diagnosticErrors: 0,
      },
      checks: [],
      diagnostics: [],
    });

    const result = await runUpgrade({
      repoRoot: tempRoot,
      targetVersion: "0.2.0",
      allowDirty: true,
      skipValidation: false,
      ...fixtureOptions(tempRoot),
    });

    expect(doctorSpy).toHaveBeenCalled();
    expect(result.status).toBe("success");
    expect(result.validation.doctor).toBe("passed");
    expect(result.baselineUpdated).toBe(true);
    expect(JSON.parse(readFileSync(path.join(tempRoot, "package.json"), "utf8")).version).toBe(
      "0.2.0"
    );

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("preserves consumer-owned files byte-for-byte across upgrade", async () => {
    const tempRoot = copyFixtureToTemp();
    const consumerOwnedPath = path.join(tempRoot, "apps/web/src/features/billing/custom-work.ts");
    const before = readFileSync(consumerOwnedPath, "utf8");

    jest.spyOn(doctorModule, "runDoctor").mockResolvedValue({
      schemaVersion: 1,
      status: "healthy",
      atlasVersion: "0.2.0",
      projectRoot: ".",
      summary: {
        checksPassed: 1,
        checksWarned: 0,
        checksFailed: 0,
        checksSkipped: 0,
        diagnosticWarnings: 0,
        diagnosticErrors: 0,
      },
      checks: [],
      diagnostics: [],
    });

    const result = await runUpgrade({
      repoRoot: tempRoot,
      targetVersion: "0.2.0",
      allowDirty: true,
      skipValidation: false,
      ...fixtureOptions(tempRoot),
    });

    expect(result.status).toBe("success");
    expect(readFileSync(consumerOwnedPath, "utf8")).toBe(before);

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("reports exactly one terminal migration result per migration", async () => {
    const tempRoot = copyFixtureToTemp();

    jest.spyOn(doctorModule, "runDoctor").mockResolvedValue({
      schemaVersion: 1,
      status: "healthy",
      atlasVersion: "0.2.0",
      projectRoot: ".",
      summary: {
        checksPassed: 1,
        checksWarned: 0,
        checksFailed: 0,
        checksSkipped: 0,
        diagnosticWarnings: 0,
        diagnosticErrors: 0,
      },
      checks: [],
      diagnostics: [],
    });

    const result = await runUpgrade({
      repoRoot: tempRoot,
      targetVersion: "0.2.0",
      allowDirty: true,
      skipValidation: true,
      ...fixtureOptions(tempRoot),
    });

    const ids = result.migrations.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.migrations).toEqual([
      expect.objectContaining({ id: "fixture-migration-a", status: "applied" }),
    ]);

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("executes multi-step migrations in order and advances baseline only after success", async () => {
    const tempRoot = copyFixtureToTemp();

    jest.spyOn(doctorModule, "runDoctor").mockResolvedValue({
      schemaVersion: 1,
      status: "healthy",
      atlasVersion: "0.3.0",
      projectRoot: ".",
      summary: {
        checksPassed: 1,
        checksWarned: 0,
        checksFailed: 0,
        checksSkipped: 0,
        diagnosticWarnings: 0,
        diagnosticErrors: 0,
      },
      checks: [],
      diagnostics: [],
    });

    const result = await runUpgrade({
      repoRoot: tempRoot,
      targetVersion: "0.3.0",
      allowDirty: true,
      skipValidation: true,
      ...fixtureOptions(tempRoot),
    });

    expect(result.status).toBe("success");
    expect(result.migrations.map((entry) => entry.id)).toEqual([
      "fixture-migration-a",
      "fixture-migration-b",
    ]);
    expect(result.migrations.every((entry) => entry.status === "applied")).toBe(true);

    const contract = JSON.parse(readFileSync(path.join(tempRoot, "atlas.config.json"), "utf8"));
    expect(contract.platform.baseline.atlasVersion).toBe("0.3.0");
    expect(contract.platform.baseline.contractSchemaVersion).toBe(2);

    const fixtureContract = JSON.parse(
      readFileSync(path.join(tempRoot, "fixture.contract.json"), "utf8")
    );
    expect(fixtureContract.newKey).toBe(true);

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("does not advance baseline when a migration fails", async () => {
    const tempRoot = copyFixtureToTemp();
    const packageBefore = readFileSync(path.join(tempRoot, "package.json"), "utf8");

    const failingRegistry = {
      ...FIXTURE_MIGRATION_REGISTRY,
      runChain: jest.fn((migrations: AtlasMigrationDefinition[], context) => {
        if (
          migrations.some((entry: AtlasMigrationDefinition) => entry.id === "fixture-migration-b")
        ) {
          FIXTURE_MIGRATION_REGISTRY.runMigration("fixture-migration-a", context);
          throw new Error("migration B failed");
        }

        return FIXTURE_MIGRATION_REGISTRY.runChain(migrations, context);
      }),
    };

    const result = await runUpgrade({
      repoRoot: tempRoot,
      targetVersion: "0.3.0",
      allowDirty: true,
      skipValidation: true,
      ...fixtureOptions(tempRoot),
      migrationRegistry: failingRegistry,
    });

    expect(result.status).toBe("migration-failed");
    expect(result.baselineUpdated).toBe(false);
    expect(readFileSync(path.join(tempRoot, "fixture.contract.json"), "utf8")).toContain("stepA");
    expect(readFileSync(path.join(tempRoot, "package.json"), "utf8")).toBe(packageBefore);

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("preserves migration changes in atlas.config.json during baseline finalization", async () => {
    const tempRoot = copyFixtureToTemp();

    const result = await runUpgrade({
      repoRoot: tempRoot,
      targetVersion: "0.2.0",
      allowDirty: true,
      skipValidation: true,
      ...fixtureOptions(tempRoot),
    });

    expect(result.status).toBe("success");

    const fixtureContract = JSON.parse(
      readFileSync(path.join(tempRoot, "fixture.contract.json"), "utf8")
    );
    expect(fixtureContract.stepA).toBe(true);
    expect(fixtureContract.legacyKey).toBe(true);

    const contract = JSON.parse(readFileSync(path.join(tempRoot, "atlas.config.json"), "utf8"));
    expect(contract.platform.baseline.atlasVersion).toBe("0.2.0");

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("passes real upgrade-baseline doctor check after finalization", async () => {
    const tempRoot = copyFixtureToTemp();

    const result = await runUpgrade({
      repoRoot: tempRoot,
      targetVersion: "0.2.0",
      allowDirty: true,
      skipValidation: true,
      ...fixtureOptions(tempRoot),
    });

    expect(result.status).toBe("success");
    expect(result.baselineUpdated).toBe(true);

    const doctorContext = createDoctorContext({ cwd: tempRoot });
    const baselineCheck = runUpgradeBaselineCheck(doctorContext);
    // Generated Atlas projects may have zero template-sync consumers. This fixture
    // previously relied on an empty consumerApplications list being invalid so Doctor
    // skipped checksum comparison against the 0.1.0 path list. Empty consumers are now
    // valid; version identity still must match the upgraded checkout.
    expect(
      baselineCheck.diagnostics.some(
        (diagnostic) => diagnostic.code === DoctorDiagnosticCode.TEMPLATE_SYNC_MANIFEST_INVALID
      )
    ).toBe(false);
    expect(
      baselineCheck.diagnostics.some(
        (diagnostic) => diagnostic.code === DoctorDiagnosticCode.UPGRADE_BASELINE_STALE
      )
    ).toBe(false);
    expect(doctorContext.rawContract?.platform?.baseline?.atlasVersion).toBe("0.2.0");
    expect(doctorContext.checkoutAtlasVersion).toBe("0.2.0");

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("rejects migrationRehearsal in production contract parsing", () => {
    expect(() =>
      parseAtlasProjectContract({
        schemaVersion: 1,
        platform: {
          baseline: {
            atlasVersion: "0.1.0",
            contractSchemaVersion: 1,
            templateManifestSchemaVersion: 1,
            syncedPathChecksums: {},
          },
          migrationRehearsal: { stepA: true },
        },
      })
    ).toThrow();
  });

  it("keeps production migration registry free of fixture migration IDs", () => {
    expect(listRegisteredMigrations().map((entry) => entry.id)).toEqual([]);
    expect(listRegisteredMigrations().some((entry) => entry.id.includes("fixture"))).toBe(false);
    expect(listRegisteredMigrations().some((entry) => entry.id.includes("rehearsal"))).toBe(false);
  });
});

describe("upgrade package semantics", () => {
  function writePackage(repoRoot: string, packageName: string, version: string): void {
    const dir = path.join(repoRoot, "packages", packageName.replace("@atlas/", ""));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "package.json"),
      `${JSON.stringify({ name: packageName, version }, null, 2)}\n`
    );
  }

  it("applies safe package version updates when consumer matches source release", async () => {
    const tempRoot = copyFixtureToTemp();
    writePackage(tempRoot, "@atlas/ui", "0.1.0");
    writePackage(tempRoot, "@atlas/project", "0.1.0");

    const result = await runUpgrade({
      repoRoot: tempRoot,
      targetVersion: "0.2.0",
      allowDirty: true,
      skipValidation: true,
      ...fixtureOptions(tempRoot),
    });

    expect(result.status).toBe("success");
    expect(
      JSON.parse(readFileSync(path.join(tempRoot, "packages/ui/package.json"), "utf8")).version
    ).toBe("0.2.0");
    expect(
      JSON.parse(readFileSync(path.join(tempRoot, "packages/project/package.json"), "utf8")).version
    ).toBe("0.2.0");

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("blocks when consumer package version differs from source release", async () => {
    const tempRoot = copyFixtureToTemp();
    writePackage(tempRoot, "@atlas/ui", "0.1.5-custom");

    const result = await runUpgrade({
      repoRoot: tempRoot,
      targetVersion: "0.2.0",
      allowDirty: true,
      skipValidation: true,
      ...fixtureOptions(tempRoot),
    });

    expect(result.status).toBe("blocked");
    expect(result.baselineUpdated).toBe(false);
    expect(
      JSON.parse(readFileSync(path.join(tempRoot, "packages/ui/package.json"), "utf8")).version
    ).toBe("0.1.5-custom");

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("skips package updates when workspace package is absent", async () => {
    const tempRoot = copyFixtureToTemp();
    rmSync(path.join(tempRoot, "packages"), { recursive: true, force: true });

    const result = await runUpgrade({
      repoRoot: tempRoot,
      targetVersion: "0.2.0",
      allowDirty: true,
      skipValidation: true,
      ...fixtureOptions(tempRoot),
    });

    expect(result.status).toBe("success");
    expect(result.items.some((item) => item.relativePath === "@atlas/ui")).toBe(false);

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("does not advance baseline when dependency installation fails", async () => {
    const tempRoot = copyFixtureToTemp();
    const contractPath = path.join(tempRoot, "atlas.config.json");
    const baselineBefore = JSON.parse(readFileSync(contractPath, "utf8")).platform.baseline
      .atlasVersion;

    const result = await runUpgrade({
      repoRoot: tempRoot,
      targetVersion: "0.2.0",
      allowDirty: true,
      skipValidation: true,
      installDependencies: true,
      installDependenciesRunner: () => ({
        status: "failed",
        message: "pnpm install failed",
      }),
      ...fixtureOptions(tempRoot),
    });

    expect(result.status).toBe("validation-failed");
    expect(result.baselineUpdated).toBe(false);
    expect(result.dependencyInstall).toBe("failed");
    expect(JSON.parse(readFileSync(contractPath, "utf8")).platform.baseline.atlasVersion).toBe(
      baselineBefore
    );
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("does not advance baseline when post-upgrade doctor fails", async () => {
    const tempRoot = copyFixtureToTemp();
    jest.spyOn(doctorModule, "runDoctor").mockResolvedValue({
      schemaVersion: 1,
      status: "failed",
      atlasVersion: "0.2.0",
      projectRoot: ".",
      summary: {
        checksPassed: 0,
        checksWarned: 0,
        checksFailed: 1,
        checksSkipped: 0,
        diagnosticWarnings: 0,
        diagnosticErrors: 1,
      },
      checks: [],
      diagnostics: [],
    });

    const result = await runUpgrade({
      repoRoot: tempRoot,
      targetVersion: "0.2.0",
      allowDirty: true,
      ...fixtureOptions(tempRoot),
    });

    expect(result.status).toBe("validation-failed");
    expect(result.baselineUpdated).toBe(false);
    expect(result.validation.doctor).toBe("failed");
    rmSync(tempRoot, { recursive: true, force: true });
  });
});
