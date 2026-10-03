import { computeBaselineChecksum } from "@atlas/project";

import { planUpgrade } from "../upgrade/plan";

const SOURCE = {
  "src/lib/api/errors.ts": "export const normalize = () => 'old';\n",
  "src/lib/auth/session.ts": "export const session = 'baseline';\n",
};

describe("upgrade baseline safety", () => {
  const baselineChecksums = {
    "src/lib/api/errors.ts": computeBaselineChecksum(SOURCE["src/lib/api/errors.ts"]!),
    "src/lib/auth/session.ts": computeBaselineChecksum(SOURCE["src/lib/auth/session.ts"]!),
  };

  const targetSnapshot = {
    syncedPaths: {
      ...SOURCE,
      "src/lib/api/errors.ts": "export const normalize = () => 'fixed';\n",
      "src/lib/auth/session.ts": "export const session = 'secure-baseline';\n",
    },
  };

  it("never replaces when baseline checksum is missing even if consumer matches source", () => {
    const plan = planUpgrade({
      applicationRoot: "apps/web",
      baselineAtlasVersion: "0.1.0",
      targetAtlasVersion: "0.2.0",
      baselineChecksums: {},
      sourceSyncedPaths: ["src/lib/api/errors.ts"],
      sourceGeneratedPaths: [],
      sourceIndependentPaths: [],
      syncedPaths: ["src/lib/api/errors.ts"],
      generatedPaths: [],
      independentPaths: [],
      sourceSnapshot: { syncedPaths: SOURCE },
      targetSnapshot,
      consumerFiles: SOURCE,
    });

    const item = plan.items.find((entry) => entry.relativePath === "src/lib/api/errors.ts");
    expect(item?.action).toBe("manual-review");
    expect(item?.category).toBe("manual");
    expect(item?.conflict).toBe(true);
    expect(plan.items.some((entry) => entry.action === "replace")).toBe(false);
  });

  it("replaces when baseline proves consumer is unchanged", () => {
    const plan = planUpgrade({
      applicationRoot: "apps/web",
      baselineAtlasVersion: "0.1.0",
      targetAtlasVersion: "0.2.0",
      baselineChecksums,
      sourceSyncedPaths: ["src/lib/api/errors.ts"],
      sourceGeneratedPaths: [],
      sourceIndependentPaths: [],
      syncedPaths: ["src/lib/api/errors.ts"],
      generatedPaths: [],
      independentPaths: [],
      sourceSnapshot: { syncedPaths: SOURCE },
      targetSnapshot,
      consumerFiles: SOURCE,
    });

    const item = plan.items.find((entry) => entry.relativePath === "src/lib/api/errors.ts");
    expect(item?.action).toBe("replace");
    expect(item?.category).toBe("patch-safe");
    expect(item?.conflict).toBe(false);
  });

  it("requires merge when baseline proves consumer modified", () => {
    const plan = planUpgrade({
      applicationRoot: "apps/web",
      baselineAtlasVersion: "0.1.0",
      targetAtlasVersion: "0.2.0",
      baselineChecksums,
      sourceSyncedPaths: ["src/lib/auth/session.ts"],
      sourceGeneratedPaths: [],
      sourceIndependentPaths: [],
      syncedPaths: ["src/lib/auth/session.ts"],
      generatedPaths: [],
      independentPaths: [],
      sourceSnapshot: { syncedPaths: SOURCE },
      targetSnapshot,
      consumerFiles: {
        ...SOURCE,
        "src/lib/auth/session.ts": "export const session = 'consumer-custom';\n",
      },
    });

    const item = plan.items.find((entry) => entry.relativePath === "src/lib/auth/session.ts");
    expect(item?.action).toBe("manual-review");
    expect(item?.category).toBe("security-critical");
    expect(item?.conflict).toBe(true);
  });

  it("treats missing baseline checksum with modified consumer as unknown, not replace", () => {
    const plan = planUpgrade({
      applicationRoot: "apps/web",
      baselineAtlasVersion: "0.1.0",
      targetAtlasVersion: "0.2.0",
      baselineChecksums: {},
      sourceSyncedPaths: ["src/lib/auth/session.ts"],
      sourceGeneratedPaths: [],
      sourceIndependentPaths: [],
      syncedPaths: ["src/lib/auth/session.ts"],
      generatedPaths: [],
      independentPaths: [],
      sourceSnapshot: { syncedPaths: SOURCE },
      targetSnapshot,
      consumerFiles: {
        ...SOURCE,
        "src/lib/auth/session.ts": "export const session = 'consumer-custom';\n",
      },
    });

    const item = plan.items.find((entry) => entry.relativePath === "src/lib/auth/session.ts");
    expect(item?.action).toBe("manual-review");
    expect(item?.category).toBe("manual");
    expect(item?.conflict).toBe(true);
  });

  it("skips an existing synced path that already matches the target release", () => {
    const targetErrors = targetSnapshot.syncedPaths["src/lib/api/errors.ts"]!;
    const plan = planUpgrade({
      applicationRoot: "apps/web",
      baselineAtlasVersion: "0.1.0",
      targetAtlasVersion: "0.2.0",
      baselineChecksums,
      sourceSyncedPaths: ["src/lib/api/errors.ts"],
      sourceGeneratedPaths: [],
      sourceIndependentPaths: [],
      syncedPaths: ["src/lib/api/errors.ts"],
      generatedPaths: [],
      independentPaths: [],
      sourceSnapshot: { syncedPaths: SOURCE },
      targetSnapshot,
      consumerFiles: {
        "src/lib/api/errors.ts": targetErrors,
      },
    });

    const item = plan.items.find((entry) => entry.relativePath === "src/lib/api/errors.ts");
    expect(item?.action).toBe("skip");
    expect(item?.category).toBe("patch-safe");
    expect(item?.conflict).toBe(false);
    expect(item?.baselineStatus).toBe("modified");
    expect(plan.hasBlockingConflicts).toBe(false);
  });

  it("skips an existing synced path that matches the target when baseline evidence is missing", () => {
    const targetErrors = targetSnapshot.syncedPaths["src/lib/api/errors.ts"]!;
    const plan = planUpgrade({
      applicationRoot: "apps/web",
      baselineAtlasVersion: "0.1.0",
      targetAtlasVersion: "0.2.0",
      baselineChecksums: {},
      sourceSyncedPaths: ["src/lib/api/errors.ts"],
      sourceGeneratedPaths: [],
      sourceIndependentPaths: [],
      syncedPaths: ["src/lib/api/errors.ts"],
      generatedPaths: [],
      independentPaths: [],
      sourceSnapshot: { syncedPaths: SOURCE },
      targetSnapshot,
      consumerFiles: {
        "src/lib/api/errors.ts": targetErrors,
      },
    });

    const item = plan.items.find((entry) => entry.relativePath === "src/lib/api/errors.ts");
    expect(item?.action).toBe("skip");
    expect(item?.category).toBe("patch-safe");
    expect(item?.conflict).toBe(false);
    expect(item?.baselineStatus).toBe("unknown");
  });

  it("still requires merge when an existing synced path matches neither source nor target", () => {
    const plan = planUpgrade({
      applicationRoot: "apps/web",
      baselineAtlasVersion: "0.1.0",
      targetAtlasVersion: "0.2.0",
      baselineChecksums,
      sourceSyncedPaths: ["src/lib/api/errors.ts"],
      sourceGeneratedPaths: [],
      sourceIndependentPaths: [],
      syncedPaths: ["src/lib/api/errors.ts"],
      generatedPaths: [],
      independentPaths: [],
      sourceSnapshot: { syncedPaths: SOURCE },
      targetSnapshot,
      consumerFiles: {
        "src/lib/api/errors.ts": "export const normalize = () => 'consumer-edit';\n",
      },
    });

    const item = plan.items.find((entry) => entry.relativePath === "src/lib/api/errors.ts");
    expect(item?.action).toBe("manual-review");
    expect(item?.category).toBe("merge-required");
    expect(item?.conflict).toBe(true);
    expect(item?.baselineStatus).toBe("modified");
  });

  it("requires manual review when consumer file is missing", () => {
    const plan = planUpgrade({
      applicationRoot: "apps/web",
      baselineAtlasVersion: "0.1.0",
      targetAtlasVersion: "0.2.0",
      baselineChecksums,
      sourceSyncedPaths: ["src/lib/api/errors.ts"],
      sourceGeneratedPaths: [],
      sourceIndependentPaths: [],
      syncedPaths: ["src/lib/api/errors.ts"],
      generatedPaths: [],
      independentPaths: [],
      sourceSnapshot: { syncedPaths: SOURCE },
      targetSnapshot,
      consumerFiles: {},
    });

    const item = plan.items.find((entry) => entry.relativePath === "src/lib/api/errors.ts");
    expect(item?.action).toBe("manual-review");
    expect(item?.category).toBe("manual");
    expect(item?.conflict).toBe(true);
  });
});
