import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { SpawnSyncReturns } from "node:child_process";

import {
  formatUpgradeHumanResult,
  runUpgradeCommand,
  upgradeExitCodeFromResult,
  writeUpgradeHelp,
} from "../commands/upgrade";
import { CliError, CliErrorCode } from "../errors/cli-error";
import { LATEST_RELEASE_DISCOVERY_ERROR } from "../upgrade/release-discovery";
import { CLI_PACKAGE_NAME } from "../version";

import type { OutputWriter } from "../output/write";
import type { UpgradePlanItem, UpgradeRunResult, UpgradeRunStatus } from "../upgrade/types";

function writeConsumer(root: string, atlasVersion: string | undefined): void {
  writeFileSync(path.join(root, "package.json"), '{"name":"consumer","version":"0.1.0"}\n');
  // A contract without `platform` is valid; `platform` without `baseline` is not.
  const contract = atlasVersion
    ? {
        schemaVersion: 1,
        platform: {
          baseline: {
            atlasVersion,
            contractSchemaVersion: 1,
            templateManifestSchemaVersion: 1,
            syncedPathChecksums: {},
          },
        },
      }
    : { schemaVersion: 1 };
  writeFileSync(path.join(root, "atlas.config.json"), JSON.stringify(contract));
}

function capture(): { writer: OutputWriter; stdout: () => string; stderr: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    writer: { writeStdout: (line) => out.push(line), writeStderr: (line) => err.push(line) },
    stdout: () => out.join("\n"),
    stderr: () => err.join("\n"),
  };
}

function spawnResult(status: number | null, stdout = ""): SpawnSyncReturns<string> {
  return { pid: 1, output: [], stdout, stderr: "", status, signal: null };
}

async function captureCliError(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CliError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected runUpgradeCommand to throw a CliError");
}

const PUBLISHED = ["1.2.1", "1.2.2", "1.2.4", "1.3.1", "1.3.2"];

describe("runUpgradeCommand guards", () => {
  let root: string;
  let calls: string[][];
  const recordSpawn =
    (status = 0) =>
    (_command: string, args: readonly string[]) => {
      calls.push([...args]);
      return spawnResult(status);
    };

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "atlas-upgrade-guards-"));
    calls = [];
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("refuses to upgrade a project with no recorded platform.baseline", async () => {
    writeConsumer(root, undefined);

    const error = await captureCliError(
      runUpgradeCommand({
        cwd: root,
        targetVersion: "1.3.2",
        writer: capture().writer,
        runningVersion: "1.3.2",
        spawn: recordSpawn(),
      })
    );

    expect(error.code).toBe(CliErrorCode.UPGRADE_PREREQUISITE);
    expect(error.message).toMatch(/platform\.baseline is missing/);
    expect(calls).toHaveLength(0);
  });

  it.each(["latest", "^1.3.0", "1.3", "1.3.2-rc.1", "1.3.2; rm -rf ."])(
    "rejects --to %s as a usage error before any registry or CLI call",
    async (target) => {
      writeConsumer(root, "1.2.1");

      const error = await captureCliError(
        runUpgradeCommand({
          cwd: root,
          targetVersion: target,
          writer: capture().writer,
          runningVersion: "1.3.2",
          resolveLatest: () => {
            throw new Error("must not resolve latest when --to is given");
          },
          spawn: recordSpawn(),
        })
      );

      expect(error.code).toBe(CliErrorCode.USAGE_ERROR);
      expect(calls).toHaveLength(0);
    }
  );

  it("refuses a downgrade instead of rewriting files to an older release", async () => {
    writeConsumer(root, "1.3.2");

    const error = await captureCliError(
      runUpgradeCommand({
        cwd: root,
        targetVersion: "1.2.4",
        writer: capture().writer,
        runningVersion: "1.3.2",
        spawn: recordSpawn(),
      })
    );

    expect(error.code).toBe(CliErrorCode.UPGRADE_PREREQUISITE);
    expect(error.message).toBe("Downgrade from Atlas 1.3.2 to 1.2.4 is not supported.");
    expect(calls).toHaveLength(0);
  });

  it("compares versions numerically when refusing downgrades (1.10.0 is newer than 1.9.0)", async () => {
    writeConsumer(root, "1.10.0");

    const error = await captureCliError(
      runUpgradeCommand({
        cwd: root,
        targetVersion: "1.9.0",
        writer: capture().writer,
        runningVersion: "1.9.0",
        spawn: recordSpawn(),
      })
    );

    expect(error.message).toMatch(/Downgrade from Atlas 1\.10\.0 to 1\.9\.0/);
  });

  it("refuses to hand off again from a handoff child running the wrong version", async () => {
    writeConsumer(root, "1.2.1");

    const error = await captureCliError(
      runUpgradeCommand({
        cwd: root,
        targetVersion: "1.3.2",
        writer: capture().writer,
        runningVersion: "1.3.1",
        env: { ATLAS_UPGRADE_HANDOFF: "1" },
        spawn: recordSpawn(),
      })
    );

    expect(error.code).toBe(CliErrorCode.UPGRADE_PREREQUISITE);
    expect(error.message).toMatch(/Refusing to launch another Atlas CLI/);
    expect(error.message).toContain("1.3.1");
    expect(calls).toHaveLength(0);
  });

  it("wraps a non-CLI latest-discovery failure in the registry prerequisite error", async () => {
    writeConsumer(root, "1.2.1");

    const error = await captureCliError(
      runUpgradeCommand({
        cwd: root,
        writer: capture().writer,
        runningVersion: "1.3.2",
        resolveLatest: () => {
          throw new Error("socket hang up");
        },
        spawn: recordSpawn(),
      })
    );

    expect(error.code).toBe(CliErrorCode.UPGRADE_PREREQUISITE);
    expect(error.message).toBe(LATEST_RELEASE_DISCOVERY_ERROR);
    expect(error.details).toEqual(["socket hang up"]);
    expect(calls).toHaveLength(0);
  });

  it("falls back to one direct handoff when the published release list is unavailable", async () => {
    writeConsumer(root, "1.2.1");

    const code = await runUpgradeCommand({
      cwd: root,
      targetVersion: "1.3.2",
      writer: capture().writer,
      runningVersion: "1.2.1",
      resolvePublished: () => {
        throw new Error("registry offline");
      },
      spawn: recordSpawn(0),
    });

    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`${CLI_PACKAGE_NAME}@1.3.2`);
  });

  it("returns 1 when the handoff CLI is killed by a signal", async () => {
    writeConsumer(root, "1.3.1");

    const code = await runUpgradeCommand({
      cwd: root,
      targetVersion: "1.3.2",
      writer: capture().writer,
      runningVersion: "1.3.1",
      resolvePublished: () => PUBLISHED,
      spawn: () => ({ ...spawnResult(null), signal: "SIGINT" }),
    });

    expect(code).toBe(1);
  });
});

describe("multi-release upgrade failures", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "atlas-upgrade-hop-fail-"));
    writeConsumer(root, "1.2.1");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("reports a failed (not blocked) hop, its exit code, and the baseline reached so far", async () => {
    const out = capture();
    const calls: string[][] = [];

    const code = await runUpgradeCommand({
      cwd: root,
      json: true,
      writer: out.writer,
      runningVersion: "1.3.2",
      resolveLatest: () => "1.3.2",
      resolvePublished: () => PUBLISHED,
      assertCleanWorktree: () => undefined,
      spawn: (_command, args) => {
        calls.push([...args]);
        // First hop (1.2.2) succeeds; second hop (1.3.1) fails post-upgrade validation.
        return spawnResult(calls.length === 2 ? 8 : 0);
      },
    });

    expect(code).toBe(8);
    expect(calls).toHaveLength(2);
    const payload = JSON.parse(out.stdout()) as {
      result: {
        status: string;
        sourceVersion: string;
        baselineUpdated: boolean;
        hopResults: { targetVersion: string; exitCode: number }[];
        messages: string[];
      };
    };
    expect(payload.result.status).toBe("failed");
    expect(payload.result.sourceVersion).toBe("1.2.1");
    expect(payload.result.baselineUpdated).toBe(true);
    expect(payload.result.hopResults).toEqual([
      expect.objectContaining({ targetVersion: "1.2.2", exitCode: 0 }),
      expect.objectContaining({ targetVersion: "1.3.1", exitCode: 8 }),
    ]);
    expect(payload.result.messages.join("\n")).toContain(
      "Stopped at hop 2/3 (Atlas 1.2.2 → 1.3.1)"
    );
    expect(payload.result.messages.join("\n")).toContain("platform.baseline is 1.2.2");
  });

  it("does not claim the baseline moved when the first hop fails", async () => {
    const out = capture();

    const code = await runUpgradeCommand({
      cwd: root,
      json: true,
      writer: out.writer,
      runningVersion: "1.3.2",
      resolveLatest: () => "1.3.2",
      resolvePublished: () => PUBLISHED,
      assertCleanWorktree: () => undefined,
      spawn: () => spawnResult(1),
    });

    expect(code).toBe(1);
    const payload = JSON.parse(out.stdout()) as {
      result: { baselineUpdated: boolean; messages: string[] };
    };
    expect(payload.result.baselineUpdated).toBe(false);
    expect(payload.result.messages.join("\n")).toContain("platform.baseline is 1.2.1");
  });

  it("forwards --allow-dirty to the first hop only when the user asked for it", async () => {
    const calls: string[][] = [];

    await runUpgradeCommand({
      cwd: root,
      json: true,
      allowDirty: true,
      writer: capture().writer,
      runningVersion: "1.3.2",
      resolveLatest: () => "1.3.2",
      resolvePublished: () => PUBLISHED,
      assertCleanWorktree: ({ allowDirty }) => {
        expect(allowDirty).toBe(true);
      },
      spawn: (_command, args) => {
        calls.push([...args]);
        return spawnResult(0);
      },
    });

    expect(calls[0]).toContain("--allow-dirty");
  });

  it("writes hop progress to stderr and a human summary to stdout without --json", async () => {
    const out = capture();

    const code = await runUpgradeCommand({
      cwd: root,
      writer: out.writer,
      runningVersion: "1.3.2",
      resolveLatest: () => "1.3.2",
      resolvePublished: () => PUBLISHED,
      assertCleanWorktree: () => undefined,
      spawn: () => spawnResult(0),
    });

    expect(code).toBe(0);
    expect(out.stderr()).toContain("Upgrade path: 1.2.1 → 1.2.2 → 1.3.1 → 1.3.2");
    expect(out.stderr()).toContain("[1/3] Atlas 1.2.1 → 1.2.2");
    expect(out.stderr()).toContain("[3/3] Atlas 1.3.1 → 1.3.2");
    expect(out.stdout()).toContain("Status: success");
    expect(out.stdout()).toContain("Upgraded Atlas 1.2.1 → 1.2.2 → 1.3.1 → 1.3.2.");
    expect(() => JSON.parse(out.stdout())).toThrow();
  });
});

function baseResult(overrides: Partial<UpgradeRunResult> = {}): UpgradeRunResult {
  return {
    sourceVersion: "1.3.1",
    targetVersion: "1.3.2",
    mode: "apply",
    status: "success",
    summary: {
      patchSafe: 0,
      mergeRequired: 0,
      migrationRequired: 0,
      manual: 0,
      securityCritical: 0,
      skipped: 0,
      packageUpdates: 0,
      regenerations: 0,
      replacements: 0,
    },
    items: [],
    conflicts: [],
    migrations: [],
    validation: { doctor: "skipped", apiGen: "skipped" },
    baselineUpdated: false,
    appliedPaths: [],
    messages: [],
    dependencyInstall: "not-run",
    ...overrides,
  };
}

function item(overrides: Partial<UpgradePlanItem>): UpgradePlanItem {
  return {
    relativePath: "file.ts",
    ownershipChannel: "atlas-managed-template",
    category: "patch-safe",
    action: "replace",
    message: "",
    conflict: false,
    ...overrides,
  };
}

describe("upgrade human output", () => {
  it("prints manifest field changes as from → to, including removals and recovery", () => {
    const lines = formatUpgradeHumanResult(
      baseResult({
        items: [
          item({
            relativePath: "package.json#scripts.lint",
            category: "patch-safe",
            manifestChange: {
              relativePath: "package.json",
              field: "scripts.lint",
              operation: "set",
              sourceOwned: true,
              targetOwned: true,
              sourceValue: "eslint .",
              targetValue: "eslint . --max-warnings=0",
            },
          }),
          item({
            relativePath: "package.json#scripts.old",
            category: "patch-safe",
            manifestChange: {
              relativePath: "package.json",
              field: "scripts.old",
              operation: "remove",
              sourceOwned: true,
              targetOwned: false,
              sourceValue: "node old.js",
              recovery: true,
            },
          }),
          item({
            relativePath: "package.json#scripts.new",
            manifestChange: {
              relativePath: "package.json",
              field: "scripts.new",
              operation: "set",
              sourceOwned: false,
              targetOwned: true,
              targetValue: "node new.js",
            },
          }),
        ],
      })
    );

    const text = lines.join("\n");
    expect(text).toContain("eslint . → eslint . --max-warnings=0");
    expect(text).toContain("node old.js → (removed)");
    expect(text).toContain("patch-safe recovery");
    expect(text).toContain("(absent) → node new.js");
  });

  it("lists skipped manifest changes and file items as flags, then conflicts and applied paths", () => {
    const conflict = item({
      relativePath: "src/app/layout.tsx",
      category: "merge-required",
      action: "merge",
      conflict: true,
      message: "Consumer modified this synced path.",
    });
    const lines = formatUpgradeHumanResult(
      baseResult({
        status: "blocked",
        latestStable: "1.3.2",
        messages: ["Resolve conflicts and rerun."],
        items: [
          conflict,
          item({
            relativePath: "package.json#name",
            action: "skip",
            manifestChange: {
              relativePath: "package.json",
              field: "name",
              operation: "set",
              sourceOwned: false,
              targetOwned: false,
            },
          }),
        ],
        conflicts: [conflict],
        appliedPaths: ["docs/upgrades.md"],
        baselineUpdated: false,
      })
    );

    expect(lines).toContain("Latest stable: 1.3.2");
    expect(lines).toContain("Resolve conflicts and rerun.");
    expect(lines).toContain("  - src/app/layout.tsx: merge | merge-required | conflict");
    expect(lines).toContain("  - package.json#name: skip | patch-safe | ok");
    expect(lines).toContain("Blocking conflicts:");
    expect(lines).toContain("  - src/app/layout.tsx: Consumer modified this synced path.");
    expect(lines).toContain("Applied paths (1):");
    expect(lines.at(-1)).toBe("Baseline updated: no");
  });

  it("only prints the upgrade path when there is more than one hop", () => {
    expect(formatUpgradeHumanResult(baseResult({ hops: ["1.3.2"] })).join("\n")).not.toContain(
      "Upgrade path:"
    );
    expect(
      formatUpgradeHumanResult(baseResult({ sourceVersion: "1.2.4", hops: ["1.3.1", "1.3.2"] }))
    ).toContain("Upgrade path: 1.2.4 → 1.3.1 → 1.3.2");
  });
});

describe("upgradeExitCodeFromResult", () => {
  it.each<[UpgradeRunStatus, number]>([
    ["success", 0],
    ["already-current", 0],
    ["planned", 0],
    ["blocked", 9],
    ["validation-failed", 8],
    ["migration-failed", 8],
    ["failed", 1],
  ])("maps %s to exit %d", (status, exitCode) => {
    expect(upgradeExitCodeFromResult(baseResult({ status }))).toBe(exitCode);
  });

  it("fails closed for an unknown status", () => {
    expect(upgradeExitCodeFromResult(baseResult({ status: "mystery" as UpgradeRunStatus }))).toBe(
      1
    );
  });
});

describe("writeUpgradeHelp", () => {
  it("prints help lines, or one JSON envelope with --json", () => {
    const human = capture();
    writeUpgradeHelp(human.writer, false);
    expect(human.stdout()).toContain("atlas upgrade [--to <version>] [options]");

    const json = capture();
    writeUpgradeHelp(json.writer, true);
    const payload = JSON.parse(json.stdout()) as {
      ok: boolean;
      command: string;
      result: { lines: string[] };
    };
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe("upgrade-help");
    expect(payload.result.lines).toContain(
      "  --dry-run            Plan without filesystem mutations"
    );
  });
});
