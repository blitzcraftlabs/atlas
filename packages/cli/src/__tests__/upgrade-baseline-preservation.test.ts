import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { LATEST_SCHEMA_VERSION } from "@atlas/project";

import { captureConsumerPlatformBaseline } from "../upgrade/baseline";
import { planUpgrade } from "../upgrade/plan";

const APP = "apps/web";
const SYNCED = ["src/lib/api/client.ts"];
const V1 = { "src/lib/api/client.ts": "export const client = 'atlas-v1';\n" };
const V2 = V1; // Atlas did not change client.ts in V2
const V3 = { "src/lib/api/client.ts": "export const client = 'atlas-v3';\n" };
const CUSTOM = "export const client = 'consumer-custom';\n";

function manifest() {
  return {
    schemaVersion: 1 as const,
    canonicalApplication: APP,
    consumerApplications: [],
    syncedPaths: SYNCED,
    generatedPaths: [],
    independentPaths: {},
    referenceOnlyPaths: [],
    starterOnlyPaths: [],
    repositorySyncedPaths: [],
  };
}

describe("baseline preservation across consecutive upgrades", () => {
  it("does not let a customization Atlas did not touch become the new 'unchanged' baseline", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "atlas-baseline-preserve-"));
    try {
      const file = path.join(root, APP, "src/lib/api/client.ts");
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(path.join(root, "package.json"), '{"name":"c","version":"0.0.0"}\n');
      writeFileSync(file, CUSTOM);

      // Upgrade V1 → V2 succeeded (client.ts unchanged by Atlas, so the customization was kept).
      const afterV2 = captureConsumerPlatformBaseline({
        repoRoot: root,
        applicationRoot: APP,
        atlasVersion: "0.2.0",
        contractSchemaVersion: LATEST_SCHEMA_VERSION,
        manifest: manifest(),
        targetSyncedContents: V2,
      });

      // Upgrade V2 → V3 changes client.ts. The consumer's customization must be protected.
      const plan = planUpgrade({
        applicationRoot: path.join(root, APP),
        baselineAtlasVersion: "0.2.0",
        targetAtlasVersion: "0.3.0",
        baselineChecksums: afterV2.syncedPathChecksums,
        sourceSyncedPaths: SYNCED,
        sourceGeneratedPaths: [],
        sourceIndependentPaths: [],
        syncedPaths: SYNCED,
        generatedPaths: [],
        independentPaths: [],
        sourceSnapshot: { syncedPaths: V2 },
        targetSnapshot: { syncedPaths: V3 },
        consumerFiles: { "src/lib/api/client.ts": CUSTOM },
      } as Parameters<typeof planUpgrade>[0]);

      const item = plan.items.find((entry) => entry.relativePath === "src/lib/api/client.ts");
      expect(item?.action).not.toBe("replace");
      expect(item?.category).toBe("merge-required");
      expect(item?.conflict).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("baseline capture without target contents", () => {
  it("still records on-disk checksums at init time", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "atlas-baseline-init-"));
    try {
      const file = path.join(root, APP, "src/lib/api/client.ts");
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(path.join(root, "package.json"), '{"name":"c","version":"0.0.0"}\n');
      writeFileSync(file, V1["src/lib/api/client.ts"]);
      const baseline = captureConsumerPlatformBaseline({
        repoRoot: root,
        applicationRoot: APP,
        atlasVersion: "0.1.0",
        contractSchemaVersion: LATEST_SCHEMA_VERSION,
        manifest: manifest(),
      });
      expect(baseline.syncedPathChecksums["src/lib/api/client.ts"]).toMatch(/^sha256:/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
