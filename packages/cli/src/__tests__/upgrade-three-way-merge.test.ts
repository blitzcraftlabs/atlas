import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { computeBaselineChecksum } from "@atlas/project";

import { resolveThreeWayMerges, threeWayMerge } from "../upgrade/three-way-merge";
import type { UpgradePlanItem } from "../upgrade/types";
import { runAtlasCli } from "./helpers/run-cli";

const CONFLICT_FIXTURE_ROOT = path.resolve(__dirname, "fixtures/upgrade-e2e-conflict");
const ERRORS = "src/lib/api/errors.ts";
const SESSION = "src/lib/auth/session.ts";

const BASE = [
  "// errors",
  "export const a = 1;",
  "export const b = 2;",
  "export const c = 3;",
  "export const d = 4;",
  "",
].join("\n");
const ATLAS_TARGET = BASE.replace("export const a = 1;", "export const a = 100; // atlas fix");
const CONSUMER_CLEAN = BASE.replace("export const d = 4;", "export const d = 4; // consumer tweak");
const CONSUMER_CONFLICT = BASE.replace("export const a = 1;", "export const a = 7; // consumer");

describe("threeWayMerge", () => {
  it("merges non-overlapping changes", () => {
    const result = threeWayMerge({ base: BASE, ours: CONSUMER_CLEAN, theirs: ATLAS_TARGET });
    expect(result.status).toBe("clean");
    if (result.status === "clean") {
      expect(result.content).toContain("atlas fix");
      expect(result.content).toContain("consumer tweak");
    }
  });

  it("reports overlapping changes as conflicts with labelled markers", () => {
    const result = threeWayMerge({
      base: BASE,
      ours: CONSUMER_CONFLICT,
      theirs: ATLAS_TARGET,
      labels: { ours: "consumer", base: "atlas 0.1.0", theirs: "atlas 0.2.0" },
    });
    expect(result.status).toBe("conflict");
    if (result.status === "conflict") {
      expect(result.conflicts).toBe(1);
      expect(result.content).toContain("<<<<<<< consumer");
      expect(result.content).toContain(">>>>>>> atlas 0.2.0");
    }
  });
});

describe("resolveThreeWayMerges", () => {
  function item(overrides: Partial<UpgradePlanItem> = {}): UpgradePlanItem {
    return {
      relativePath: ERRORS,
      ownershipChannel: "atlas-managed-template",
      category: "merge-required",
      action: "manual-review",
      message: "manual merge is required.",
      conflict: true,
      baselineStatus: "modified",
      ...overrides,
    };
  }
  const contents = {
    sourceContent: () => BASE,
    targetContent: () => ATLAS_TARGET,
    consumerContent: () => CONSUMER_CLEAN,
  };

  it("only hints when --merge is off", () => {
    const items = [item()];
    const resolution = resolveThreeWayMerges({
      items,
      apply: false,
      sourceVersion: "0.1.0",
      targetVersion: "0.2.0",
      ...contents,
    });
    expect(items[0]).toMatchObject({ action: "manual-review", conflict: true, autoMerge: "clean" });
    expect(items[0]?.message).toContain("rerun with --merge");
    expect(resolution.contentOverrides).toEqual({});
  });

  it("turns a clean merge into a non-blocking merge action with --merge", () => {
    const items = [item()];
    const resolution = resolveThreeWayMerges({
      items,
      apply: true,
      sourceVersion: "0.1.0",
      targetVersion: "0.2.0",
      ...contents,
    });
    expect(items[0]).toMatchObject({ action: "merge", conflict: false, autoMerge: "clean" });
    expect(resolution.contentOverrides[ERRORS]).toContain("consumer tweak");
  });

  it("never merges security-critical paths", () => {
    const items = [item({ category: "security-critical", securityCritical: true })];
    resolveThreeWayMerges({
      items,
      apply: true,
      sourceVersion: "0.1.0",
      targetVersion: "0.2.0",
      ...contents,
    });
    expect(items[0]).toMatchObject({ action: "manual-review", conflict: true });
    expect(items[0]?.autoMerge).toBeUndefined();
  });

  it("leaves non-modified or non-merge items alone", () => {
    const items = [item({ baselineStatus: "unknown" }), item({ category: "manual" })];
    resolveThreeWayMerges({
      items,
      apply: true,
      sourceVersion: "0.1.0",
      targetVersion: "0.2.0",
      ...contents,
    });
    expect(items.every((entry) => entry.autoMerge === undefined)).toBe(true);
  });
});

function scenario(consumerErrors: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "atlas-merge-e2e-"));
  cpSync(CONFLICT_FIXTURE_ROOT, root, { recursive: true });
  writeFileSync(path.join(root, "releases/0.1.0/apps/web", ERRORS), BASE);
  writeFileSync(path.join(root, "releases/0.2.0/apps/web", ERRORS), ATLAS_TARGET);
  writeFileSync(path.join(root, "apps/web", ERRORS), consumerErrors);
  // Keep the security-critical session file unmodified so it does not block.
  writeFileSync(
    path.join(root, "apps/web", SESSION),
    readFileSync(path.join(root, "releases/0.1.0/apps/web", SESSION))
  );
  const configPath = path.join(root, "atlas.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    platform: { baseline: { syncedPathChecksums: Record<string, string> } };
  };
  config.platform.baseline.syncedPathChecksums[ERRORS] = computeBaselineChecksum(BASE);
  config.platform.baseline.syncedPathChecksums[SESSION] = computeBaselineChecksum(
    readFileSync(path.join(root, "releases/0.1.0/apps/web", SESSION), "utf8")
  );
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return root;
}

function upgrade(root: string, extra: string[]) {
  const result = runAtlasCli(
    [
      "upgrade",
      "--to",
      "0.2.0",
      "--json",
      "--skip-validation",
      "--allow-dirty",
      "--releases-dir",
      path.join(root, "releases"),
      ...extra,
    ],
    root
  );
  return {
    exitCode: result.exitCode,
    payload: JSON.parse(result.stdout) as {
      result: {
        status: string;
        baselineUpdated: boolean;
        messages: string[];
        items: UpgradePlanItem[];
      };
    },
  };
}

describe("atlas upgrade --merge (end to end)", () => {
  it("applies a clean three-way merge and keeps the file detectable as modified", () => {
    const root = scenario(CONSUMER_CLEAN);
    try {
      const { exitCode, payload } = upgrade(root, ["--merge"]);
      expect(exitCode).toBe(0);
      expect(payload.result.status).toBe("success");
      const merged = readFileSync(path.join(root, "apps/web", ERRORS), "utf8");
      expect(merged).toContain("atlas fix");
      expect(merged).toContain("consumer tweak");
      const config = JSON.parse(readFileSync(path.join(root, "atlas.config.json"), "utf8")) as {
        platform: { baseline: { syncedPathChecksums: Record<string, string> } };
      };
      // The baseline records Atlas's shipped content, so the consumer tweak stays "modified".
      expect(config.platform.baseline.syncedPathChecksums[ERRORS]).toBe(
        computeBaselineChecksum(ATLAS_TARGET)
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("without --merge stays blocked and hints that a clean merge exists", () => {
    const root = scenario(CONSUMER_CLEAN);
    try {
      const { exitCode, payload } = upgrade(root, []);
      expect(exitCode).toBe(9);
      const errors = payload.result.items.find((entry) => entry.relativePath === ERRORS);
      expect(errors?.autoMerge).toBe("clean");
      expect(readFileSync(path.join(root, "apps/web", ERRORS), "utf8")).toBe(CONSUMER_CLEAN);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes a conflict sidecar and leaves the consumer file untouched", () => {
    const root = scenario(CONSUMER_CONFLICT);
    try {
      const { exitCode, payload } = upgrade(root, ["--merge"]);
      expect(exitCode).toBe(9);
      expect(payload.result.baselineUpdated).toBe(false);
      const sidecar = path.join(root, ".atlas/merge/apps/web", `${ERRORS}.merge`);
      expect(existsSync(sidecar)).toBe(true);
      expect(readFileSync(sidecar, "utf8")).toContain("<<<<<<< consumer");
      expect(readFileSync(path.join(root, "apps/web", ERRORS), "utf8")).toBe(CONSUMER_CONFLICT);
      expect(payload.result.messages.join("\n")).toContain(
        ".atlas/merge/apps/web/src/lib/api/errors.ts.merge"
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
