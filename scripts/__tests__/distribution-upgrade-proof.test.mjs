import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  assertActionableUpgradePlan,
  assertPostUpgradeReleaseIdentity,
  assertPreviousConsumerDoesNotRetainTargetState,
  assertSuccessfulUpgradeApply,
  materializePreviousProductionConsumer,
  proveInstalledCrossVersionUpgrade,
  selectPreviousSupportedVersion,
} from "../lib/distribution-upgrade-proof.mjs";

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, contents) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function snapshotManifest(overrides) {
  return {
    schemaVersion: 1,
    atlasVersion: "0.4.0",
    contractSchemaVersion: 1,
    templateManifestSchemaVersion: 1,
    canonicalApplication: "apps/web",
    syncedPaths: ["src/lib/api/errors.ts"],
    generatedPaths: ["src/lib/api/contracts/schema.ts"],
    independentPaths: ["src/lib/application/authz.ts"],
    packageVersions: {
      "@atlas/ui": "0.4.0",
      "@atlas/config": "0.4.0",
    },
    openApiSpecRelativePath: "openapi/openapi.json",
    ...overrides,
  };
}

function writeSnapshot(root, manifest, files) {
  writeJson(path.join(root, "release.snapshot.json"), manifest);
  for (const [relativePath, contents] of Object.entries(files)) {
    writeText(path.join(root, relativePath), contents);
  }
}

function createTwoVersionFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "atlas-upgrade-proof-"));
  const previousSnapshotRoot = path.join(root, "cli", "assets", "releases", "0.4.0");
  const currentSnapshotRoot = path.join(root, "cli", "assets", "releases", "0.5.0");
  const consumerRoot = path.join(root, "consumer");

  const previousManifest = snapshotManifest();
  const currentManifest = snapshotManifest({
    atlasVersion: "0.5.0",
    syncedPaths: ["src/lib/api/errors.ts", "src/lib/api/platform-marker.ts"],
    packageVersions: {
      "@atlas/ui": "0.5.0",
      "@atlas/config": "0.5.0",
    },
  });

  writeSnapshot(previousSnapshotRoot, previousManifest, {
    "apps/web/src/lib/api/errors.ts": "previous-errors\n",
    "apps/web/src/lib/api/contracts/schema.ts": "previous-schema\n",
    "apps/web/src/lib/application/authz.ts": "previous-authz\n",
    "openapi/openapi.json": '{"openapi":"3.0.0","info":{"title":"previous"}}\n',
  });
  writeSnapshot(currentSnapshotRoot, currentManifest, {
    "apps/web/src/lib/api/errors.ts": "current-errors\n",
    "apps/web/src/lib/api/platform-marker.ts": "current-marker\n",
    "apps/web/src/lib/api/contracts/schema.ts": "current-schema\n",
    "apps/web/src/lib/application/authz.ts": "current-authz\n",
    "openapi/openapi.json": '{"openapi":"3.0.0","info":{"title":"current"}}\n',
  });

  writeJson(path.join(consumerRoot, "package.json"), {
    name: "test-app",
    version: "0.1.0",
  });
  writeJson(path.join(consumerRoot, "packages/ui/package.json"), {
    name: "@atlas/ui",
    version: "0.5.0",
  });
  writeJson(path.join(consumerRoot, "packages/config/package.json"), {
    name: "@atlas/config",
    version: "0.5.0",
  });
  writeJson(path.join(consumerRoot, "atlas.config.json"), {
    schemaVersion: 1,
    platform: {
      baseline: {
        atlasVersion: "0.5.0",
        contractSchemaVersion: 1,
        templateManifestSchemaVersion: 1,
        syncedPathChecksums: {},
      },
    },
  });
  writeText(path.join(consumerRoot, "apps/web/src/lib/api/errors.ts"), "current-errors\n");
  writeText(path.join(consumerRoot, "apps/web/src/lib/api/platform-marker.ts"), "current-marker\n");
  writeText(
    path.join(consumerRoot, "apps/web/src/lib/api/contracts/schema.ts"),
    "current-schema\n"
  );
  writeText(path.join(consumerRoot, "apps/web/src/lib/application/authz.ts"), "current-authz\n");
  writeText(
    path.join(consumerRoot, "openapi/openapi.json"),
    '{"openapi":"3.0.0","info":{"title":"current"}}\n'
  );
  writeText(
    path.join(consumerRoot, "apps/web/src/features/billing/custom-work.ts"),
    "consumer-owned\n"
  );

  return {
    root,
    previousSnapshotRoot,
    currentSnapshotRoot,
    consumerRoot,
    previousManifest,
    currentManifest,
    cliInstalled: path.join(root, "cli"),
  };
}

describe("distribution upgrade proof", () => {
  it("defers cross-version proof when the catalog has a single production version", () => {
    assert.equal(
      selectPreviousSupportedVersion({ current: "0.4.0", supportedVersions: ["0.4.0"] }),
      null
    );
  });

  it("rejects a blocked dry-run for a two-version clean fixture", () => {
    assert.throws(
      () =>
        assertActionableUpgradePlan(
          {
            ok: true,
            result: { status: "blocked", sourceVersion: "0.4.0", targetVersion: "0.5.0" },
          },
          { sourceVersion: "0.4.0", targetVersion: "0.5.0" }
        ),
      /must return status "planned"/
    );
  });

  it("does not silently retain target-version Atlas-owned state", () => {
    const fixture = createTwoVersionFixture();
    try {
      const materialized = materializePreviousProductionConsumer({
        consumerRoot: fixture.consumerRoot,
        previousSnapshotRoot: fixture.previousSnapshotRoot,
        currentSnapshotRoot: fixture.currentSnapshotRoot,
      });

      assert.equal(
        readFileSync(path.join(fixture.consumerRoot, "apps/web/src/lib/api/errors.ts"), "utf8"),
        "previous-errors\n"
      );
      assert.equal(
        readFileSync(
          path.join(fixture.consumerRoot, "apps/web/src/lib/api/contracts/schema.ts"),
          "utf8"
        ),
        "previous-schema\n"
      );
      assert.equal(
        readFileSync(
          path.join(fixture.consumerRoot, "apps/web/src/lib/application/authz.ts"),
          "utf8"
        ),
        "previous-authz\n"
      );
      assert.equal(
        existsSync(path.join(fixture.consumerRoot, "apps/web/src/lib/api/platform-marker.ts")),
        false
      );
      assert.equal(
        JSON.parse(
          readFileSync(path.join(fixture.consumerRoot, "packages/ui/package.json"), "utf8")
        ).version,
        "0.4.0"
      );
      assert.equal(
        JSON.parse(readFileSync(path.join(fixture.consumerRoot, "atlas.config.json"), "utf8"))
          .platform.baseline.atlasVersion,
        "0.4.0"
      );
      assert.equal(
        readFileSync(
          path.join(fixture.consumerRoot, "apps/web/src/features/billing/custom-work.ts"),
          "utf8"
        ),
        "consumer-owned\n"
      );

      assertPreviousConsumerDoesNotRetainTargetState({
        consumerRoot: fixture.consumerRoot,
        previousSnapshotRoot: fixture.previousSnapshotRoot,
        previousManifest: materialized.previousManifest,
        currentManifest: materialized.currentManifest,
      });
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("fails the retain-target assertion when only syncedPaths were rolled back", () => {
    const fixture = createTwoVersionFixture();
    try {
      writeText(
        path.join(fixture.consumerRoot, "apps/web/src/lib/api/errors.ts"),
        "previous-errors\n"
      );
      assert.throws(
        () =>
          assertPreviousConsumerDoesNotRetainTargetState({
            consumerRoot: fixture.consumerRoot,
            previousSnapshotRoot: fixture.previousSnapshotRoot,
            previousManifest: fixture.previousManifest,
            currentManifest: fixture.currentManifest,
          }),
        /retained target-only Atlas-owned path src\/lib\/api\/platform-marker.ts/
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("plans, applies, and validates a clean previous-version fixture", () => {
    const fixture = createTwoVersionFixture();
    const calls = [];
    try {
      const result = proveInstalledCrossVersionUpgrade({
        catalog: { current: "0.5.0", supportedVersions: ["0.4.0", "0.5.0"] },
        consumerRoot: fixture.consumerRoot,
        cliInstalled: fixture.cliInstalled,
        runAtlas(args) {
          calls.push(args);
          if (args.includes("--dry-run")) {
            return {
              ok: true,
              result: { status: "planned", sourceVersion: "0.4.0", targetVersion: "0.5.0" },
            };
          }
          writeText(
            path.join(fixture.consumerRoot, "apps/web/src/lib/api/errors.ts"),
            "current-errors\n"
          );
          writeText(
            path.join(fixture.consumerRoot, "apps/web/src/lib/api/platform-marker.ts"),
            "current-marker\n"
          );
          writeJson(path.join(fixture.consumerRoot, "packages/ui/package.json"), {
            name: "@atlas/ui",
            version: "0.5.0",
          });
          writeJson(path.join(fixture.consumerRoot, "packages/config/package.json"), {
            name: "@atlas/config",
            version: "0.5.0",
          });
          writeJson(path.join(fixture.consumerRoot, "package.json"), {
            name: "test-app",
            version: "0.5.0",
            scripts: { atlas: "atlas" },
            devDependencies: { "@blitzcraftlabs/atlas": "0.5.0" },
          });
          writeJson(path.join(fixture.consumerRoot, "atlas.config.json"), {
            schemaVersion: 1,
            platform: {
              baseline: {
                atlasVersion: "0.5.0",
                contractSchemaVersion: 1,
                templateManifestSchemaVersion: 1,
                syncedPathChecksums: {
                  "src/lib/api/errors.ts": checksum(
                    path.join(fixture.consumerRoot, "apps/web/src/lib/api/errors.ts")
                  ),
                  "src/lib/api/platform-marker.ts": checksum(
                    path.join(fixture.consumerRoot, "apps/web/src/lib/api/platform-marker.ts")
                  ),
                },
              },
            },
          });
          return {
            ok: true,
            result: {
              status: "success",
              sourceVersion: "0.4.0",
              targetVersion: "0.5.0",
              baselineUpdated: true,
            },
          };
        },
        runValidation() {
          calls.push(["validation"]);
        },
      });

      assert.deepEqual(result, { deferred: false, previous: "0.4.0", current: "0.5.0" });
      assert.equal(calls[0].includes("--dry-run"), true);
      assert.equal(calls[1].includes("--dry-run"), false);
      assert.deepEqual(calls[2], ["validation"]);
      assert.equal(
        JSON.parse(readFileSync(path.join(fixture.consumerRoot, "atlas.config.json"), "utf8"))
          .platform.baseline.atlasVersion,
        "0.5.0"
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("identifies the target release from post-upgrade baseline and checksum evidence", () => {
    const fixture = createTwoVersionFixture();
    try {
      writeText(
        path.join(fixture.consumerRoot, "apps/web/src/lib/api/errors.ts"),
        "current-errors\n"
      );
      writeText(
        path.join(fixture.consumerRoot, "apps/web/src/lib/api/platform-marker.ts"),
        "current-marker\n"
      );
      writeJson(path.join(fixture.consumerRoot, "package.json"), {
        name: "test-app",
        version: "0.5.0",
        scripts: { atlas: "atlas" },
        devDependencies: { "@blitzcraftlabs/atlas": "0.5.0" },
      });
      writeJson(path.join(fixture.consumerRoot, "packages/ui/package.json"), {
        name: "@atlas/ui",
        version: "0.5.0",
      });
      writeJson(path.join(fixture.consumerRoot, "packages/config/package.json"), {
        name: "@atlas/config",
        version: "0.5.0",
      });
      writeJson(path.join(fixture.consumerRoot, "atlas.config.json"), {
        schemaVersion: 1,
        platform: {
          baseline: {
            atlasVersion: "0.5.0",
            contractSchemaVersion: 1,
            templateManifestSchemaVersion: 1,
            syncedPathChecksums: {
              "src/lib/api/errors.ts": checksum(
                path.join(fixture.consumerRoot, "apps/web/src/lib/api/errors.ts")
              ),
              "src/lib/api/platform-marker.ts": checksum(
                path.join(fixture.consumerRoot, "apps/web/src/lib/api/platform-marker.ts")
              ),
            },
          },
        },
      });

      assertPostUpgradeReleaseIdentity({
        consumerRoot: fixture.consumerRoot,
        currentSnapshotRoot: fixture.currentSnapshotRoot,
      });
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("fails closed when packaged previous snapshot evidence is missing", () => {
    const fixture = createTwoVersionFixture();
    try {
      rmSync(fixture.previousSnapshotRoot, { recursive: true, force: true });
      assert.throws(
        () =>
          proveInstalledCrossVersionUpgrade({
            catalog: { current: "0.5.0", supportedVersions: ["0.4.0", "0.5.0"] },
            consumerRoot: fixture.consumerRoot,
            cliInstalled: fixture.cliInstalled,
            runAtlas() {
              throw new Error("upgrade must not run without packaged snapshots");
            },
            runValidation() {
              throw new Error("validation must not run without packaged snapshots");
            },
          }),
        /Packaged previous snapshot missing/
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("fails closed when apply does not complete successfully", () => {
    assert.throws(
      () =>
        assertSuccessfulUpgradeApply(
          {
            ok: true,
            result: {
              status: "validation-failed",
              sourceVersion: "0.4.0",
              targetVersion: "0.5.0",
              baselineUpdated: false,
            },
          },
          { sourceVersion: "0.4.0", targetVersion: "0.5.0" }
        ),
      /expected "success"/
    );
  });
});

function checksum(filePath) {
  return `sha256:${createHash("sha256").update(readFileSync(filePath)).digest("hex")}`;
}
