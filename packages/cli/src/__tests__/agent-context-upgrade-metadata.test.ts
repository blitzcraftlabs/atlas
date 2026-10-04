import { computeBaselineChecksum } from "@atlas/project";

import { buildAgentContextReport } from "../context/agent-context";
import { createAtlasContext } from "../context/atlas-context";
import { planUpgrade } from "../upgrade/plan";

import { getRepoRoot } from "./helpers/run-cli";

const SOURCE = {
  "src/lib/api/errors.ts": "export const normalize = () => 'old';\n",
  "src/lib/auth/session.ts": "export const session = 'baseline';\n",
};

describe("agent context upgrade metadata", () => {
  it("points agents to atlas upgrade dry-run JSON as the decision source", () => {
    const context = createAtlasContext({ cwd: getRepoRoot(), requireProject: true });
    const report = buildAgentContextReport(context);

    expect(report.commands.upgrade).toEqual({
      command: "atlas upgrade",
      dryRunJsonSupported: true,
      applyJsonSupported: true,
      requiresTargetVersion: false,
      decisionSource: "pnpm atlas upgrade --dry-run --json",
      resultStatusField: "status",
      planItemConflictField: "conflict",
      planItemActionField: "action",
      planItemCategoryField: "category",
    });
    expect(report.commands.upgrade).not.toHaveProperty("blockingCategories");
    expect(report.commands.upgrade).not.toHaveProperty("deterministicActions");
  });
});

describe("upgrade planner blocking semantics (authoritative atlas upgrade behavior)", () => {
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

  it("does not treat manual + conflict=false as intrinsically blocking", () => {
    const plan = planUpgrade({
      applicationRoot: "apps/web",
      baselineAtlasVersion: "0.1.0",
      targetAtlasVersion: "0.2.0",
      baselineChecksums,
      sourceSyncedPaths: [],
      sourceGeneratedPaths: [],
      sourceIndependentPaths: [],
      syncedPaths: [],
      generatedPaths: [],
      independentPaths: [],
      sourceSnapshot: { syncedPaths: {}, openApiSpec: '{"openapi":"3.0.0","paths":{"/users":{}}}' },
      targetSnapshot: {
        syncedPaths: {},
        openApiSpec: '{"openapi":"3.0.0","paths":{"/users":{},"/teams":{}}}',
      },
      consumerFiles: {},
    });

    const item = plan.items.find((entry) => entry.relativePath === "openapi/openapi.json");
    expect(item?.category).toBe("manual");
    expect(item?.action).toBe("manual-review");
    expect(item?.conflict).toBe(false);
    expect(plan.hasBlockingConflicts).toBe(false);
  });

  it("does not treat security-critical + replace + conflict=false as intrinsically blocking", () => {
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
      consumerFiles: SOURCE,
    });

    const item = plan.items.find((entry) => entry.relativePath === "src/lib/auth/session.ts");
    expect(item?.category).toBe("security-critical");
    expect(item?.action).toBe("replace");
    expect(item?.conflict).toBe(false);
    expect(plan.hasBlockingConflicts).toBe(false);
  });

  it("treats merge-required + conflict=true as a blocking plan conflict", () => {
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
        ...SOURCE,
        "src/lib/api/errors.ts": "export const normalize = () => 'consumer-custom';\n",
      },
    });

    const item = plan.items.find((entry) => entry.relativePath === "src/lib/api/errors.ts");
    expect(item?.category).toBe("merge-required");
    expect(item?.action).toBe("manual-review");
    expect(item?.conflict).toBe(true);
    expect(plan.hasBlockingConflicts).toBe(true);
  });
});
