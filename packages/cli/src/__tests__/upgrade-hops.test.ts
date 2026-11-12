import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { SpawnSyncReturns } from "node:child_process";

import { runUpgradeCommand } from "../commands/upgrade";
import type { OutputWriter } from "../output/write";
import { formatHopPath, parsePublishedVersionsOutput, planUpgradeHops } from "../upgrade/hop-plan";
import { CLI_PACKAGE_NAME } from "../version";

/** npm-published versions as of 1.3.3. 1.0.0, 1.2.3 and 1.3.0 were never on npm. */
const PUBLISHED = ["1.0.1", "1.1.0", "1.2.0", "1.2.1", "1.2.2", "1.2.4", "1.3.1", "1.3.2", "1.3.3"];

/**
 * supportedVersions from each published package's assets/releases/catalog.json, read from npm.
 * The hop planner must only ever ask a release's CLI to upgrade from a version it supports.
 */
const PUBLISHED_CATALOGS: Record<string, string[]> = {
  "1.0.1": ["1.0.0", "1.0.1"],
  "1.1.0": ["1.0.1", "1.1.0"],
  "1.2.0": ["1.1.0", "1.2.0"],
  "1.2.1": ["1.2.0", "1.2.1"],
  "1.2.2": ["1.2.1", "1.2.2"],
  "1.2.4": ["1.2.3", "1.2.4"],
  "1.3.1": ["1.2.2", "1.2.4", "1.3.1"],
  "1.3.2": ["1.3.1", "1.3.2"],
  "1.3.3": ["1.3.2", "1.3.3"],
};

function assertEveryHopSupported(source: string, hops: string[]): void {
  let current = source;
  for (const hop of hops) {
    expect(PUBLISHED_CATALOGS[hop]).toContain(current);
    current = hop;
  }
}

describe("planUpgradeHops", () => {
  it("returns a single hop for adjacent releases", () => {
    expect(
      planUpgradeHops({
        sourceVersion: "1.3.2",
        targetVersion: "1.3.3",
        publishedVersions: PUBLISHED,
      })
    ).toEqual(["1.3.3"]);
  });

  it("walks every published release from 1.1.0 and routes 1.2.2 through the 1.3.1 bridge", () => {
    const hops = planUpgradeHops({
      sourceVersion: "1.1.0",
      targetVersion: "1.3.3",
      publishedVersions: PUBLISHED,
    });
    expect(hops).toEqual(["1.2.0", "1.2.1", "1.2.2", "1.3.1", "1.3.2", "1.3.3"]);
    assertEveryHopSupported("1.1.0", hops);
  });

  it("produces a supported path from every published or GitHub-only baseline", () => {
    for (const source of ["1.0.0", ...PUBLISHED.slice(0, -1), "1.2.4"]) {
      const hops = planUpgradeHops({
        sourceVersion: source,
        targetVersion: "1.3.3",
        publishedVersions: PUBLISHED,
      });
      expect(hops.at(-1)).toBe("1.3.3");
      assertEveryHopSupported(source, hops);
    }
  });

  it("skips unpublished snapshots and GitHub-only releases", () => {
    const hops = planUpgradeHops({
      sourceVersion: "1.2.4",
      targetVersion: "1.3.3",
      publishedVersions: PUBLISHED,
    });
    expect(hops).not.toContain("1.3.0");
    expect(hops[0]).toBe("1.3.1");
  });

  it("stops at an intermediate target", () => {
    expect(
      planUpgradeHops({
        sourceVersion: "1.1.0",
        targetVersion: "1.2.1",
        publishedVersions: PUBLISHED,
      })
    ).toEqual(["1.2.0", "1.2.1"]);
  });

  it("keeps the direct hop when the target is not npm-published", () => {
    expect(
      planUpgradeHops({
        sourceVersion: "1.1.0",
        targetVersion: "1.3.0",
        publishedVersions: PUBLISHED,
      })
    ).toEqual(["1.3.0"]);
  });

  it("formats and parses registry output", () => {
    expect(formatHopPath("1.2.2", ["1.3.1", "1.3.2"])).toBe("1.2.2 → 1.3.1 → 1.3.2");
    expect(parsePublishedVersionsOutput('["1.0.1","1.1.0","nope"]')).toEqual(["1.0.1", "1.1.0"]);
    expect(parsePublishedVersionsOutput('"1.0.1"')).toEqual(["1.0.1"]);
  });
});

function writeConsumer(root: string, atlasVersion: string): void {
  writeFileSync(path.join(root, "package.json"), '{"name":"consumer","version":"0.1.0"}\n');
  writeFileSync(
    path.join(root, "atlas.config.json"),
    JSON.stringify({
      schemaVersion: 1,
      platform: {
        baseline: {
          atlasVersion,
          contractSchemaVersion: 1,
          templateManifestSchemaVersion: 1,
          syncedPathChecksums: {},
        },
      },
    })
  );
}

function capture(): { writer: OutputWriter; stdout: () => string; stderr: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    writer: { writeStdout: (l) => out.push(l), writeStderr: (l) => err.push(l) },
    stdout: () => out.join("\n"),
    stderr: () => err.join("\n"),
  };
}

function result(status: number, stdout = ""): SpawnSyncReturns<string> {
  return { pid: 1, output: [], stdout, stderr: "", status, signal: null };
}

describe("multi-release atlas upgrade", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "atlas-hops-"));
    writeConsumer(root, "1.2.1");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const published = () => ["1.2.1", "1.2.2", "1.2.4", "1.3.1", "1.3.2"];

  it("dry-run reports the full hop plan without spawning a CLI", async () => {
    const out = capture();
    const calls: string[][] = [];
    const code = await runUpgradeCommand({
      cwd: root,
      dryRun: true,
      json: true,
      writer: out.writer,
      runningVersion: "1.3.2",
      resolveLatest: () => "1.3.2",
      resolvePublished: published,
      spawn: (_c, args) => {
        calls.push([...args]);
        return result(0);
      },
    });
    expect(code).toBe(0);
    expect(calls).toHaveLength(0);
    const payload = JSON.parse(out.stdout()) as { result: { hops: string[]; status: string } };
    expect(payload.result.hops).toEqual(["1.2.2", "1.3.1", "1.3.2"]);
    expect(payload.result.status).toBe("planned");
  });

  it("applies each hop with that release's CLI, in order", async () => {
    const out = capture();
    const calls: string[][] = [];
    const code = await runUpgradeCommand({
      cwd: root,
      json: true,
      writer: out.writer,
      runningVersion: "1.3.2",
      resolveLatest: () => "1.3.2",
      resolvePublished: published,
      assertCleanWorktree: () => undefined,
      spawn: (_c, args) => {
        calls.push([...args]);
        return result(
          0,
          JSON.stringify({ ok: true, command: "upgrade", result: { status: "success" } })
        );
      },
    });
    expect(code).toBe(0);
    expect(calls.map((args) => args[1])).toEqual([
      `${CLI_PACKAGE_NAME}@1.2.2`,
      `${CLI_PACKAGE_NAME}@1.3.1`,
      `${CLI_PACKAGE_NAME}@1.3.2`,
    ]);
    expect(calls[0]).not.toContain("--allow-dirty");
    expect(calls[1]).toContain("--allow-dirty");
    const payload = JSON.parse(out.stdout()) as {
      result: { status: string; hopResults: { exitCode: number }[] };
    };
    expect(payload.result.status).toBe("success");
    expect(payload.result.hopResults).toHaveLength(3);
  });

  it("stops at the first blocked hop and reports where the baseline is", async () => {
    const out = capture();
    const calls: string[][] = [];
    const code = await runUpgradeCommand({
      cwd: root,
      json: true,
      writer: out.writer,
      runningVersion: "1.3.2",
      resolveLatest: () => "1.3.2",
      resolvePublished: published,
      assertCleanWorktree: () => undefined,
      spawn: (_c, args) => {
        calls.push([...args]);
        return result(calls.length === 2 ? 9 : 0);
      },
    });
    expect(code).toBe(9);
    expect(calls).toHaveLength(2);
    const payload = JSON.parse(out.stdout()) as { result: { status: string; messages: string[] } };
    expect(payload.result.status).toBe("blocked");
    expect(payload.result.messages.join("\n")).toContain("platform.baseline is 1.2.2");
  });

  it("refuses to start on a dirty worktree before any hop", async () => {
    const out = capture();
    const calls: string[][] = [];
    await expect(
      runUpgradeCommand({
        cwd: root,
        writer: out.writer,
        runningVersion: "1.3.2",
        resolveLatest: () => "1.3.2",
        resolvePublished: published,
        assertCleanWorktree: () => {
          throw new Error("dirty");
        },
        spawn: (_c, args) => {
          calls.push([...args]);
          return result(0);
        },
      })
    ).rejects.toThrow("dirty");
    expect(calls).toHaveLength(0);
  });

  it("does not hop inside a handoff child", async () => {
    const out = capture();
    const calls: string[][] = [];
    await runUpgradeCommand({
      cwd: root,
      targetVersion: "1.3.2",
      writer: out.writer,
      runningVersion: "1.2.2",
      env: { ATLAS_UPGRADE_HANDOFF: "1" },
      resolvePublished: () => {
        throw new Error("must not plan hops in a handoff child");
      },
      spawn: (_c, args) => {
        calls.push([...args]);
        return result(0);
      },
    }).catch(() => undefined);
    expect(calls).toHaveLength(0);
  });
});
