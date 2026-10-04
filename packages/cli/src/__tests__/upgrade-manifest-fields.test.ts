import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { computeBaselineChecksum } from "@atlas/project";

import { formatUpgradeHumanResult } from "../commands/upgrade";
import { runManifestAlignmentCheck } from "../doctor/manifest-alignment";
import * as doctorModule from "../doctor";
import { applyPackageUpdates } from "../upgrade/package-apply";
import { planPackageUpdates } from "../upgrade/package-plan";
import {
  collectManagedManifestFields,
  type ReleaseManifestFields,
} from "../upgrade/manifest-fields";
import { MANAGED_MANIFEST_RELATIVE_PATHS, parseManifestField } from "../upgrade/manifest-ownership";
import { runUpgrade } from "../upgrade/run";
import { readCheckoutAtlasVersion } from "../version";

import type { DoctorContext } from "../doctor/context";
import type { ReleaseSnapshotManifest } from "../upgrade/release-snapshot";
import type { UpgradePlanItem } from "../upgrade/types";

const SYNCED_PATH = "src/lib/marker.ts";
const SYNCED_CONTENTS = "export const marker = true;\n";

function manifestFields(entries: Record<string, Record<string, string | undefined>>) {
  return Object.fromEntries(
    Object.entries(entries).map(([relativePath, values]) => [
      relativePath,
      {
        owned: Object.keys(values).sort((left, right) => left.localeCompare(right)),
        values: Object.fromEntries(
          Object.entries(values).filter(
            (entry): entry is [string, string] => entry[1] !== undefined
          )
        ),
      },
    ])
  );
}

function releaseManifest(
  version: string,
  fields: ReleaseSnapshotManifest["manifestFields"]
): ReleaseSnapshotManifest {
  return {
    schemaVersion: 1,
    atlasVersion: version,
    contractSchemaVersion: 1,
    templateManifestSchemaVersion: 1,
    canonicalApplication: "apps/web",
    syncedPaths: [SYNCED_PATH],
    generatedPaths: [],
    independentPaths: [],
    packageVersions: {
      "@atlas/web": version,
    },
    manifestFields: fields,
  };
}

function writeWebManifest(repoRoot: string, manifest: Record<string, unknown>): void {
  const directory = path.join(repoRoot, "apps/web");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function planWeb(options: {
  repoRoot: string;
  baseline: string;
  source: ReleaseSnapshotManifest["manifestFields"];
  target: ReleaseSnapshotManifest["manifestFields"];
  sourceVersion?: string;
  targetVersion?: string;
}): UpgradePlanItem[] {
  return planPackageUpdates({
    repoRoot: options.repoRoot,
    baselineAtlasVersion: options.baseline,
    sourceManifest: releaseManifest(options.sourceVersion ?? options.baseline, options.source),
    targetManifest: releaseManifest(options.targetVersion ?? "9.9.9", options.target),
  }).filter((item) => item.relativePath.startsWith("apps/web/package.json#"));
}

function item(items: UpgradePlanItem[], field: string): UpgradePlanItem {
  const found = items.find((entry) => entry.relativePath === `apps/web/package.json#${field}`);
  if (!found) {
    throw new Error(`Missing plan item apps/web/package.json#${field}`);
  }
  return found;
}

describe("manifest field evolution", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-manifest-fields-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("upgrades an Atlas-owned dependency the consumer left unchanged", () => {
    writeWebManifest(repoRoot, {
      name: "@atlas/web",
      version: "1.2.2",
      dependencies: { next: "16.3.3", "next-themes": "^0.4.6", shiki: "^4.4.3" },
    });

    const planned = planWeb({
      repoRoot,
      baseline: "1.2.2",
      source: manifestFields({
        "apps/web/package.json": { version: "1.2.2", "dependencies.next": "16.3.3" },
      }),
      target: manifestFields({
        "apps/web/package.json": { version: "1.3.2", "dependencies.next": "16.3.8" },
      }),
      targetVersion: "1.3.2",
    });

    expect(item(planned, "dependencies.next")).toMatchObject({
      action: "package-upgrade",
      category: "patch-safe",
      sourceVersion: "16.3.3",
      targetVersion: "16.3.8",
    });
    expect(item(planned, "version")).toMatchObject({
      action: "package-upgrade",
      targetVersion: "1.3.2",
    });

    applyPackageUpdates({
      repoRoot,
      baselineAtlasVersion: "1.2.2",
      items: planned,
    });

    const updated = JSON.parse(readFileSync(path.join(repoRoot, "apps/web/package.json"), "utf8"));
    expect(updated.version).toBe("1.3.2");
    expect(updated.dependencies).toEqual({
      next: "16.3.8",
      "next-themes": "^0.4.6",
      shiki: "^4.4.3",
    });
  });

  it("skips an Atlas-owned dependency that is already the target", () => {
    writeWebManifest(repoRoot, {
      name: "@atlas/web",
      version: "1.3.2",
      dependencies: { next: "16.3.8" },
    });
    const planned = planWeb({
      repoRoot,
      baseline: "1.2.2",
      source: manifestFields({
        "apps/web/package.json": { version: "1.2.2", "dependencies.next": "16.3.3" },
      }),
      target: manifestFields({
        "apps/web/package.json": { version: "1.3.2", "dependencies.next": "16.3.8" },
      }),
      targetVersion: "1.3.2",
    });
    expect(item(planned, "dependencies.next").action).toBe("skip");
    expect(item(planned, "version").action).toBe("skip");
  });

  it("requires manual review when the consumer modified an Atlas-owned dependency", () => {
    writeWebManifest(repoRoot, {
      name: "@atlas/web",
      version: "1.2.2",
      dependencies: { next: "16.4.0" },
    });
    const planned = planWeb({
      repoRoot,
      baseline: "1.2.2",
      source: manifestFields({
        "apps/web/package.json": { version: "1.2.2", "dependencies.next": "16.3.3" },
      }),
      target: manifestFields({
        "apps/web/package.json": { version: "1.3.2", "dependencies.next": "16.3.8" },
      }),
      targetVersion: "1.3.2",
    });
    expect(item(planned, "dependencies.next")).toMatchObject({
      action: "manual-review",
      conflict: true,
      category: "manual",
    });
  });

  it("adds an Atlas-owned dependency introduced by the target release", () => {
    writeWebManifest(repoRoot, { name: "@atlas/web", version: "1.2.2", dependencies: {} });
    const planned = planWeb({
      repoRoot,
      baseline: "1.2.2",
      source: manifestFields({ "apps/web/package.json": { version: "1.2.2" } }),
      target: manifestFields({
        "apps/web/package.json": { version: "1.3.2", "dependencies.next": "16.3.8" },
      }),
      targetVersion: "1.3.2",
    });
    expect(item(planned, "dependencies.next")).toMatchObject({
      action: "package-upgrade",
      category: "patch-safe",
      targetVersion: "16.3.8",
    });
    applyPackageUpdates({ repoRoot, baselineAtlasVersion: "1.2.2", items: planned });
    const updated = JSON.parse(readFileSync(path.join(repoRoot, "apps/web/package.json"), "utf8"));
    expect(updated.dependencies.next).toBe("16.3.8");
  });

  it("skips an introduced dependency the consumer already set to the target", () => {
    writeWebManifest(repoRoot, {
      name: "@atlas/web",
      version: "1.2.2",
      dependencies: { next: "16.3.8" },
    });
    const planned = planWeb({
      repoRoot,
      baseline: "1.2.2",
      source: manifestFields({ "apps/web/package.json": { version: "1.2.2" } }),
      target: manifestFields({
        "apps/web/package.json": { version: "1.3.2", "dependencies.next": "16.3.8" },
      }),
      targetVersion: "1.3.2",
    });
    expect(item(planned, "dependencies.next").action).toBe("skip");
  });

  it("requires manual review when an introduced dependency already has a different consumer value", () => {
    writeWebManifest(repoRoot, {
      name: "@atlas/web",
      version: "1.2.2",
      dependencies: { next: "16.4.0" },
    });
    const planned = planWeb({
      repoRoot,
      baseline: "1.2.2",
      source: manifestFields({ "apps/web/package.json": { version: "1.2.2" } }),
      target: manifestFields({
        "apps/web/package.json": { version: "1.3.2", "dependencies.next": "16.3.8" },
      }),
      targetVersion: "1.3.2",
    });
    expect(item(planned, "dependencies.next").conflict).toBe(true);
  });

  it("removes an Atlas-owned dependency the target release drops when the consumer did not change it", () => {
    writeWebManifest(repoRoot, {
      name: "@atlas/web",
      version: "1.2.2",
      dependencies: { next: "16.3.3", shiki: "^4.4.3" },
    });
    const planned = planWeb({
      repoRoot,
      baseline: "1.2.2",
      source: manifestFields({
        "apps/web/package.json": { version: "1.2.2", "dependencies.next": "16.3.3" },
      }),
      target: manifestFields({
        "apps/web/package.json": { version: "1.3.2", "dependencies.next": undefined },
      }),
      targetVersion: "1.3.2",
    });
    expect(item(planned, "dependencies.next")).toMatchObject({
      action: "package-upgrade",
      manifestChange: { operation: "remove" },
    });
    applyPackageUpdates({ repoRoot, baselineAtlasVersion: "1.2.2", items: planned });
    const updated = JSON.parse(readFileSync(path.join(repoRoot, "apps/web/package.json"), "utf8"));
    expect(updated.dependencies).toEqual({ shiki: "^4.4.3" });
  });

  it("requires manual review before removing a dependency the consumer changed", () => {
    writeWebManifest(repoRoot, {
      name: "@atlas/web",
      version: "1.2.2",
      dependencies: { next: "16.4.0" },
    });
    const planned = planWeb({
      repoRoot,
      baseline: "1.2.2",
      source: manifestFields({
        "apps/web/package.json": { version: "1.2.2", "dependencies.next": "16.3.3" },
      }),
      target: manifestFields({
        "apps/web/package.json": { version: "1.3.2", "dependencies.next": undefined },
      }),
      targetVersion: "1.3.2",
    });
    expect(item(planned, "dependencies.next").conflict).toBe(true);
  });

  it("keeps consumer-only dependencies while advancing @atlas/web", () => {
    writeWebManifest(repoRoot, {
      name: "@atlas/web",
      version: "1.2.2",
      private: true,
      dependencies: { next: "16.3.3", "next-themes": "^0.4.6", shiki: "^4.4.3" },
    });
    const before = readFileSync(path.join(repoRoot, "apps/web/package.json"), "utf8");
    const planned = planWeb({
      repoRoot,
      baseline: "1.2.2",
      source: manifestFields({
        "apps/web/package.json": { version: "1.2.2", "dependencies.next": "16.3.3" },
      }),
      target: manifestFields({
        "apps/web/package.json": { version: "1.3.2", "dependencies.next": "16.3.8" },
      }),
      targetVersion: "1.3.2",
    });
    applyPackageUpdates({ repoRoot, baselineAtlasVersion: "1.2.2", items: planned, dryRun: true });
    expect(readFileSync(path.join(repoRoot, "apps/web/package.json"), "utf8")).toBe(before);

    applyPackageUpdates({ repoRoot, baselineAtlasVersion: "1.2.2", items: planned });
    const updated = JSON.parse(readFileSync(path.join(repoRoot, "apps/web/package.json"), "utf8"));
    expect(updated.version).toBe("1.3.2");
    expect(updated.private).toBe(true);
    expect(updated.dependencies["next-themes"]).toBe("^0.4.6");
    expect(updated.dependencies.shiki).toBe("^4.4.3");
  });

  it("formats field-level dry-run lines", () => {
    const lines = formatUpgradeHumanResult({
      sourceVersion: "1.2.2",
      targetVersion: "1.3.2",
      mode: "dry-run",
      status: "planned",
      summary: {
        patchSafe: 1,
        mergeRequired: 0,
        migrationRequired: 0,
        manual: 0,
        securityCritical: 0,
        skipped: 0,
        packageUpdates: 1,
        regenerations: 0,
        replacements: 0,
      },
      items: [
        {
          relativePath: "apps/web/package.json#dependencies.next",
          ownershipChannel: "versioned-package",
          category: "patch-safe",
          action: "package-upgrade",
          message: "next",
          conflict: false,
          sourceVersion: "16.3.3",
          targetVersion: "16.3.8",
          manifestChange: {
            relativePath: "apps/web/package.json",
            field: "dependencies.next",
            operation: "set",
            sourceOwned: true,
            targetOwned: true,
            sourceValue: "16.3.3",
            targetValue: "16.3.8",
          },
        },
      ],
      conflicts: [],
      migrations: [],
      validation: { doctor: "skipped", apiGen: "skipped" },
      baselineUpdated: false,
      appliedPaths: [],
      messages: [],
    });

    expect(lines.join("\n")).toContain("apps/web/package.json#dependencies.next:");
    expect(lines.join("\n")).toContain("16.3.3 → 16.3.8");
    expect(lines.join("\n")).toContain("patch-safe");
  });
});

function writeRelease(
  releasesDir: string,
  version: string,
  fields: ReleaseSnapshotManifest["manifestFields"]
): void {
  const releaseRoot = path.join(releasesDir, version, "apps/web/src/lib");
  mkdirSync(releaseRoot, { recursive: true });
  writeFileSync(path.join(releaseRoot, "marker.ts"), SYNCED_CONTENTS);
  const snapshot: ReleaseSnapshotManifest = {
    ...releaseManifest(version, fields),
    atlasVersion: version,
  };
  writeFileSync(
    path.join(releasesDir, version, "release.snapshot.json"),
    `${JSON.stringify(snapshot, null, 2)}\n`
  );
}

function writeConsumerRepo(options: {
  baseline: string;
  web: Record<string, unknown>;
  rootVersion?: string;
}): { repoRoot: string; releasesDir: string } {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-manifest-upgrade-"));
  const releasesDir = path.join(repoRoot, "releases");
  mkdirSync(path.join(repoRoot, "apps/web/src/lib"), { recursive: true });
  writeFileSync(path.join(repoRoot, "apps/web/src/lib/marker.ts"), SYNCED_CONTENTS);
  writeFileSync(
    path.join(repoRoot, "package.json"),
    `${JSON.stringify({ name: "consumer", version: options.rootVersion ?? "0.1.0", private: true }, null, 2)}\n`
  );
  writeWebManifest(repoRoot, options.web);
  writeFileSync(
    path.join(repoRoot, "atlas.config.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        platform: {
          baseline: {
            atlasVersion: options.baseline,
            contractSchemaVersion: 1,
            templateManifestSchemaVersion: 1,
            syncedPathChecksums: {
              [SYNCED_PATH]: computeBaselineChecksum(SYNCED_CONTENTS),
            },
          },
        },
      },
      null,
      2
    )}\n`
  );
  return { repoRoot, releasesDir };
}

const sourceFields = manifestFields({
  "package.json": { version: "1.2.2" },
  "apps/web/package.json": { version: "1.2.2", "dependencies.next": "16.3.3" },
});

const fixedFields = manifestFields({
  "package.json": { version: "1.3.2" },
  "apps/web/package.json": { version: "1.3.2", "dependencies.next": "16.3.8" },
});

const brokenBaselineFields = manifestFields({
  "package.json": { version: "1.3.1" },
  "apps/web/package.json": { version: "1.3.1", "dependencies.next": "16.3.8" },
});

function healthyDoctor() {
  return {
    schemaVersion: 1 as const,
    status: "healthy" as const,
    atlasVersion: "1.3.2",
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
  };
}

describe("manifest upgrade run", () => {
  const roots: string[] = [];

  afterEach(() => {
    jest.restoreAllMocks();
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not advance baseline when an owned manifest field conflicts", async () => {
    const fixture = writeConsumerRepo({
      baseline: "1.2.2",
      web: {
        name: "@atlas/web",
        version: "1.2.2",
        dependencies: { next: "16.4.0", "next-themes": "^0.4.6" },
      },
    });
    roots.push(fixture.repoRoot);
    writeRelease(fixture.releasesDir, "1.2.2", sourceFields);
    writeRelease(fixture.releasesDir, "1.3.2", fixedFields);

    const result = await runUpgrade({
      repoRoot: fixture.repoRoot,
      targetVersion: "1.3.2",
      allowDirty: true,
      dryRun: true,
      releasesDir: fixture.releasesDir,
      skipValidation: true,
    });

    expect(result.status).toBe("blocked");
    expect(result.baselineUpdated).toBe(false);
    const contract = JSON.parse(
      readFileSync(path.join(fixture.repoRoot, "atlas.config.json"), "utf8")
    );
    expect(contract.platform.baseline.atlasVersion).toBe("1.2.2");
    const web = JSON.parse(
      readFileSync(path.join(fixture.repoRoot, "apps/web/package.json"), "utf8")
    );
    expect(web.dependencies.next).toBe("16.4.0");
    expect(web.dependencies["next-themes"]).toBe("^0.4.6");
  });

  it("upgrades the 1.2.2 consumer manifest and preserves custom dependencies", async () => {
    const fixture = writeConsumerRepo({
      baseline: "1.2.2",
      web: {
        name: "@atlas/web",
        version: "1.2.2",
        dependencies: { next: "16.3.3", "next-themes": "^0.4.6", shiki: "^4.4.3" },
      },
    });
    roots.push(fixture.repoRoot);
    writeRelease(fixture.releasesDir, "1.2.2", sourceFields);
    writeRelease(fixture.releasesDir, "1.3.2", fixedFields);
    const before = readFileSync(path.join(fixture.repoRoot, "apps/web/package.json"), "utf8");

    const dryRun = await runUpgrade({
      repoRoot: fixture.repoRoot,
      targetVersion: "1.3.2",
      allowDirty: true,
      dryRun: true,
      releasesDir: fixture.releasesDir,
      skipValidation: true,
    });
    expect(dryRun.status).toBe("planned");
    expect(dryRun.baselineUpdated).toBe(false);
    expect(readFileSync(path.join(fixture.repoRoot, "apps/web/package.json"), "utf8")).toBe(before);
    expect(dryRun.items.map((entry) => entry.relativePath)).toEqual(
      expect.arrayContaining([
        "apps/web/package.json#dependencies.next",
        "apps/web/package.json#version",
        "package.json#version",
      ])
    );

    jest.spyOn(doctorModule, "runDoctor").mockResolvedValue(healthyDoctor());
    const applied = await runUpgrade({
      repoRoot: fixture.repoRoot,
      targetVersion: "1.3.2",
      allowDirty: true,
      releasesDir: fixture.releasesDir,
      skipValidation: false,
      installDependencies: true,
      installDependenciesRunner: () => ({ status: "passed", message: "installed" }),
    });

    expect(applied.status).toBe("success");
    expect(applied.baselineUpdated).toBe(true);
    const web = JSON.parse(
      readFileSync(path.join(fixture.repoRoot, "apps/web/package.json"), "utf8")
    );
    expect(web.version).toBe("1.3.2");
    expect(web.dependencies.next).toBe("16.3.8");
    expect(web.dependencies["next-themes"]).toBe("^0.4.6");
    expect(web.dependencies.shiki).toBe("^4.4.3");
    const contract = JSON.parse(
      readFileSync(path.join(fixture.repoRoot, "atlas.config.json"), "utf8")
    );
    expect(contract.platform.baseline.atlasVersion).toBe("1.3.2");
  });

  it("repairs the already-upgraded Atlas 1.3.1 manifest drift", async () => {
    const fixture = writeConsumerRepo({
      baseline: "1.3.1",
      rootVersion: "1.3.1",
      web: {
        name: "@atlas/web",
        version: "1.2.2",
        dependencies: { next: "16.3.3", "next-themes": "^0.4.6", shiki: "^4.4.3" },
      },
    });
    roots.push(fixture.repoRoot);
    writeRelease(fixture.releasesDir, "1.3.1", brokenBaselineFields);
    writeRelease(fixture.releasesDir, "1.3.2", fixedFields);
    jest.spyOn(doctorModule, "runDoctor").mockResolvedValue(healthyDoctor());

    const applied = await runUpgrade({
      repoRoot: fixture.repoRoot,
      targetVersion: "1.3.2",
      allowDirty: true,
      releasesDir: fixture.releasesDir,
      skipValidation: true,
      installDependencies: false,
    });

    expect(applied.status).toBe("success");
    expect(applied.baselineUpdated).toBe(true);
    const next = applied.items.find(
      (entry) => entry.relativePath === "apps/web/package.json#dependencies.next"
    );
    expect(next).toMatchObject({ action: "package-upgrade", manifestChange: { recovery: true } });
    const web = JSON.parse(
      readFileSync(path.join(fixture.repoRoot, "apps/web/package.json"), "utf8")
    );
    expect(web.version).toBe("1.3.2");
    expect(web.dependencies.next).toBe("16.3.8");
    expect(web.dependencies.shiki).toBe("^4.4.3");
  });

  it("stays idempotent when install fails and when doctor fails", async () => {
    const fixture = writeConsumerRepo({
      baseline: "1.2.2",
      web: {
        name: "@atlas/web",
        version: "1.2.2",
        dependencies: { next: "16.3.3", shiki: "^4.4.3" },
      },
    });
    roots.push(fixture.repoRoot);
    writeRelease(fixture.releasesDir, "1.2.2", sourceFields);
    writeRelease(fixture.releasesDir, "1.3.2", fixedFields);

    const installFailed = await runUpgrade({
      repoRoot: fixture.repoRoot,
      targetVersion: "1.3.2",
      allowDirty: true,
      releasesDir: fixture.releasesDir,
      skipValidation: true,
      installDependencies: true,
      installDependenciesRunner: () => ({ status: "failed", message: "install failed" }),
    });
    expect(installFailed.status).toBe("validation-failed");
    expect(installFailed.baselineUpdated).toBe(false);
    expect(
      JSON.parse(readFileSync(path.join(fixture.repoRoot, "apps/web/package.json"), "utf8"))
        .dependencies.next
    ).toBe("16.3.8");

    jest.spyOn(doctorModule, "runDoctor").mockResolvedValue({
      ...healthyDoctor(),
      status: "failed",
      summary: { ...healthyDoctor().summary, checksFailed: 1, diagnosticErrors: 1 },
    });
    const doctorFailed = await runUpgrade({
      repoRoot: fixture.repoRoot,
      targetVersion: "1.3.2",
      allowDirty: true,
      releasesDir: fixture.releasesDir,
      installDependencies: true,
      installDependenciesRunner: () => ({ status: "passed", message: "installed" }),
    });
    expect(doctorFailed.status).toBe("validation-failed");
    expect(doctorFailed.baselineUpdated).toBe(false);
    const retryPlan = doctorFailed.items.find(
      (entry) => entry.relativePath === "apps/web/package.json#dependencies.next"
    );
    expect(retryPlan?.action).toBe("skip");

    jest.spyOn(doctorModule, "runDoctor").mockResolvedValue(healthyDoctor());
    const retried = await runUpgrade({
      repoRoot: fixture.repoRoot,
      targetVersion: "1.3.2",
      allowDirty: true,
      releasesDir: fixture.releasesDir,
      installDependencies: true,
      installDependenciesRunner: () => ({ status: "passed", message: "installed" }),
    });
    expect(retried.status).toBe("success");
    expect(retried.baselineUpdated).toBe(true);
    expect(
      JSON.parse(readFileSync(path.join(fixture.repoRoot, "apps/web/package.json"), "utf8"))
        .dependencies.shiki
    ).toBe("^4.4.3");
  });

  it("updates the manifest before invoking pnpm install and records the target in the lockfile", () => {
    const project = mkdtempSync(path.join(os.tmpdir(), "atlas-next-lockfile-"));
    roots.push(project);
    writeFileSync(
      path.join(project, "package.json"),
      `${JSON.stringify(
        {
          name: "next-lockfile-fixture",
          private: true,
          version: "1.2.2",
          dependencies: { next: "16.3.3" },
        },
        null,
        2
      )}\n`
    );
    const planned = planPackageUpdates({
      repoRoot: project,
      baselineAtlasVersion: "1.2.2",
      sourceManifest: releaseManifest(
        "1.2.2",
        manifestFields({ "package.json": { version: "1.2.2", "dependencies.next": "16.3.3" } })
      ),
      targetManifest: releaseManifest(
        "1.3.2",
        manifestFields({ "package.json": { version: "1.3.2", "dependencies.next": "16.3.8" } })
      ),
    });
    applyPackageUpdates({ repoRoot: project, baselineAtlasVersion: "1.2.2", items: planned });
    expect(
      JSON.parse(readFileSync(path.join(project, "package.json"), "utf8")).dependencies.next
    ).toBe("16.3.8");

    const relock = spawnSync("pnpm", ["install", "--lockfile-only"], {
      cwd: project,
      encoding: "utf8",
    });
    expect(relock.status).toBe(0);
    const lockfile = readFileSync(path.join(project, "pnpm-lock.yaml"), "utf8");
    expect(lockfile.includes("16.3.8")).toBe(true);
    expect(existsSync(path.join(project, "pnpm-lock.yaml"))).toBe(true);
  }, 180_000);
});

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PRODUCTION_ASSETS = path.resolve(__dirname, "../../release-assets/production");

function readJsonManifest(absolutePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(absolutePath, "utf8")) as Record<string, unknown>;
}

function collectManifestFieldsFromRepo(repoRoot: string): ReleaseManifestFields {
  const collected = collectManagedManifestFields(repoRoot, readJsonManifest);
  if (!collected) {
    throw new Error("collectManagedManifestFields returned no managed manifest evidence.");
  }
  return collected;
}

function requireSnapshotManifestFields(
  snapshot: ReleaseSnapshotManifest,
  version: string
): ReleaseManifestFields {
  if (!snapshot.manifestFields) {
    throw new Error(`Release snapshot for Atlas ${version} is missing manifestFields evidence.`);
  }
  return snapshot.manifestFields;
}

function readProductionSnapshot(productionDir: string, version: string): ReleaseSnapshotManifest {
  const snapshotPath = path.join(productionDir, version, "release.snapshot.json");
  if (!existsSync(snapshotPath)) {
    throw new Error(
      `Missing production release snapshot for Atlas ${version}. Expected ${snapshotPath}. Generate release assets for that version before asserting current-checkout evidence.`
    );
  }
  return JSON.parse(readFileSync(snapshotPath, "utf8")) as ReleaseSnapshotManifest;
}

function expectCurrentCheckoutMatchesProductionSnapshot(
  productionDir: string,
  repoRoot: string
): void {
  const currentVersion = readCheckoutAtlasVersion(repoRoot);
  const snapshot = readProductionSnapshot(productionDir, currentVersion);
  expect(collectManifestFieldsFromRepo(repoRoot)).toEqual(
    requireSnapshotManifestFields(snapshot, currentVersion)
  );
}

function bumpOwnedPackageVersions(
  fields: ReleaseManifestFields,
  fromVersion: string,
  toVersion: string
): ReleaseManifestFields {
  return Object.fromEntries(
    Object.entries(fields).map(([relativePath, fieldSet]) => [
      relativePath,
      {
        owned: [...fieldSet.owned],
        values: Object.fromEntries(
          Object.entries(fieldSet.values).map(([field, value]) => [
            field,
            field === "version" && value === fromVersion ? toVersion : value,
          ])
        ),
      },
    ])
  ) as ReleaseManifestFields;
}

function writeManagedManifestsFromFields(repoRoot: string, fields: ReleaseManifestFields): void {
  for (const relativePath of MANAGED_MANIFEST_RELATIVE_PATHS) {
    const fieldSet = fields[relativePath];
    if (!fieldSet) {
      continue;
    }

    const manifest: Record<string, unknown> = {};
    if (relativePath === "packages/cli/package.json") {
      manifest.name = "@blitzcraftlabs/atlas";
    }
    if (relativePath === "apps/web/package.json") {
      manifest.name = "@atlas/web";
    }

    for (const [field, value] of Object.entries(fieldSet.values)) {
      const parsed = parseManifestField(field);
      if (!parsed) {
        continue;
      }
      if (parsed.kind === "version") {
        manifest.version = value;
        continue;
      }
      const section = (manifest[parsed.section] ?? {}) as Record<string, string>;
      section[parsed.name] = value;
      manifest[parsed.section] = section;
    }

    const absolutePath = path.join(repoRoot, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

function writeProductionSnapshot(
  productionDir: string,
  version: string,
  manifestFields: ReleaseManifestFields
): void {
  const snapshot: ReleaseSnapshotManifest = {
    ...releaseManifest(version, manifestFields),
    atlasVersion: version,
  };
  const snapshotDir = path.join(productionDir, version);
  mkdirSync(snapshotDir, { recursive: true });
  writeFileSync(
    path.join(snapshotDir, "release.snapshot.json"),
    `${JSON.stringify(snapshot, null, 2)}\n`
  );
}

describe("packaged manifest evidence", () => {
  it("records the 1.2.2 to 1.3.1 Next and eslint-config-next pin evolution", () => {
    const sourceFields = requireSnapshotManifestFields(
      readProductionSnapshot(PRODUCTION_ASSETS, "1.2.2"),
      "1.2.2"
    );
    const targetFields = requireSnapshotManifestFields(
      readProductionSnapshot(PRODUCTION_ASSETS, "1.3.1"),
      "1.3.1"
    );
    const source = readProductionSnapshot(PRODUCTION_ASSETS, "1.2.2");
    const target = readProductionSnapshot(PRODUCTION_ASSETS, "1.3.1");
    expect(source.packageVersions["@atlas/web"]).toBe("1.2.2");
    expect(sourceFields["apps/web/package.json"]!.values["dependencies.next"]).toBe("16.3.3");
    expect(target.packageVersions["@atlas/web"]).toBe("1.3.1");
    expect(targetFields["apps/web/package.json"]!.values["dependencies.next"]).toBe("16.3.8");
    expect(
      targetFields["packages/config/package.json"]!.values["devDependencies.eslint-config-next"]
    ).toBe("16.3.8");
  });

  it("matches current manifest collection to the current production snapshot", () => {
    expectCurrentCheckoutMatchesProductionSnapshot(PRODUCTION_ASSETS, REPO_ROOT);
  });
});

describe("version PR current checkout regression", () => {
  let repoRoot: string;
  let productionDir: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-version-pr-checkout-"));
    productionDir = mkdtempSync(path.join(os.tmpdir(), "atlas-version-pr-production-"));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(productionDir, { recursive: true, force: true });
  });

  it("aligns evidence and Doctor after a changeset version bump beyond 1.3.1", () => {
    const priorVersion = "1.3.1";
    const nextVersion = "1.3.2";
    const priorSnapshot = readProductionSnapshot(PRODUCTION_ASSETS, priorVersion);
    const nextManifestFields = bumpOwnedPackageVersions(
      requireSnapshotManifestFields(priorSnapshot, priorVersion),
      priorVersion,
      nextVersion
    );

    writeManagedManifestsFromFields(repoRoot, nextManifestFields);
    writeProductionSnapshot(productionDir, nextVersion, nextManifestFields);

    expect(readCheckoutAtlasVersion(repoRoot)).toBe(nextVersion);
    expectCurrentCheckoutMatchesProductionSnapshot(productionDir, repoRoot);

    const context = {
      repoRoot,
      atlasVersion: readCheckoutAtlasVersion(repoRoot),
      checkoutAtlasVersion: readCheckoutAtlasVersion(repoRoot),
    } as DoctorContext;

    const result = runManifestAlignmentCheck(context, () => ({
      atlasVersion: nextVersion,
      manifestFields: nextManifestFields,
    }));
    expect(result.status).toBe("pass");
    expect(result.diagnostics).toEqual([]);
  });
});

describe("doctor manifest alignment", () => {
  it("reports a stale app version and a stale Atlas-owned dependency from local evidence", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-doctor-manifest-"));
    writeWebManifest(repoRoot, {
      name: "@atlas/web",
      version: "1.2.2",
      dependencies: { next: "16.3.3", shiki: "^4.4.3" },
    });
    const context = {
      repoRoot,
      atlasVersion: "1.3.1",
      checkoutAtlasVersion: "1.3.1",
    } as DoctorContext;

    const result = runManifestAlignmentCheck(context, () => ({
      atlasVersion: "1.3.1",
      manifestFields: manifestFields({
        "apps/web/package.json": { version: "1.3.1", "dependencies.next": "16.3.8" },
      }),
    }));

    expect(result.status).toBe("fail");
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "next = 16.3.3; Atlas 1.3.1 expects 16.3.8.",
      "version = 1.2.2; Atlas 1.3.1 expects 1.3.1.",
    ]);
    expect(
      result.diagnostics.every((diagnostic) =>
        diagnostic.suggestedFix.includes("pnpm atlas upgrade")
      )
    ).toBe(true);
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("does not query a registry while reading installed release evidence", () => {
    const source = readFileSync(path.resolve(__dirname, "../doctor/manifest-alignment.ts"), "utf8");
    expect(source).not.toMatch(/release-discovery|pnpm view|node:https|node:http/);
    const repoRoot = REPO_ROOT;
    const currentVersion = readCheckoutAtlasVersion(repoRoot);
    const context = {
      repoRoot,
      atlasVersion: currentVersion,
      checkoutAtlasVersion: currentVersion,
    } as DoctorContext;
    const result = runManifestAlignmentCheck(context);
    expect(result.status).toBe("pass");
    expect(result.diagnostics).toEqual([]);
  });
});
