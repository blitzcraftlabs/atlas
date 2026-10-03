import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { SpawnSyncReturns } from "node:child_process";

import type { OutputWriter } from "../output/write";
import { runUpgradeCommand } from "../commands/upgrade";
import {
  ATLAS_UPGRADE_HANDOFF_ENV,
  buildUpgradeHandoffArgs,
  decideUpgradeHandoff,
  executeUpgradeHandoff,
} from "../upgrade/cli-handoff";
import { CLI_PACKAGE_NAME } from "../version";
import { parseLatestReleaseOutput } from "../upgrade/release-discovery";

function writeConsumer(root: string, atlasVersion: string): void {
  writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "consumer", version: "0.1.0" }, null, 2)}\n`
  );
  writeFileSync(
    path.join(root, "atlas.config.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        platform: {
          baseline: {
            atlasVersion,
            contractSchemaVersion: 1,
            templateManifestSchemaVersion: 1,
            syncedPathChecksums: {},
          },
        },
      },
      null,
      2
    )}\n`
  );
}

function captureWriter(): { writer: OutputWriter; stdout: () => string; stderr: () => string } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    writer: {
      writeStdout: (line) => {
        stdout.push(line);
      },
      writeStderr: (line) => {
        stderr.push(line);
      },
    },
    stdout: () => stdout.join("\n"),
    stderr: () => stderr.join("\n"),
  };
}
function spawnResult(overrides: Partial<SpawnSyncReturns<string>> = {}): SpawnSyncReturns<string> {
  return {
    pid: 1,
    output: [],
    stdout: "",
    stderr: "",
    status: 0,
    signal: null,
    ...overrides,
  };
}

describe("upgrade target handoff", () => {
  it("resolves omitted --to to latest and invokes that exact package", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "atlas-handoff-latest-"));
    writeConsumer(root, "1.2.2");
    const captured = captureWriter();
    const calls: string[][] = [];

    const code = await runUpgradeCommand({
      cwd: root,
      writer: captured.writer,
      runningVersion: "1.2.2",
      resolveLatest: () => "1.2.5",
      spawn: (command, args) => {
        calls.push([command, ...args]);
        return spawnResult({ status: 0 });
      },
    });

    expect(code).toBe(0);
    expect(captured.stdout()).toBe("");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(1, 6)).toEqual([
      "dlx",
      `${CLI_PACKAGE_NAME}@1.2.5`,
      "upgrade",
      "--to",
      "1.2.5",
    ]);
    expect(calls[0]).toContain("--cwd");
    expect(calls[0]).toContain(root);
    rmSync(root, { recursive: true, force: true });
  });

  it("does not discover latest when --to is explicit", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "atlas-handoff-explicit-"));
    writeConsumer(root, "1.2.2");
    const captured = captureWriter();
    let discovered = false;
    const calls: string[][] = [];

    const code = await runUpgradeCommand({
      cwd: root,
      targetVersion: "1.2.5",
      dryRun: true,
      json: true,
      allowDirty: true,
      skipValidation: true,
      writer: captured.writer,
      runningVersion: "1.2.2",
      resolveLatest: () => {
        discovered = true;
        return "9.9.9";
      },
      spawn: (_command, args) => {
        calls.push([...args]);
        return spawnResult({ status: 4 });
      },
    });

    expect(discovered).toBe(false);
    expect(calls[0]).toEqual(
      expect.arrayContaining([
        "dlx",
        `${CLI_PACKAGE_NAME}@1.2.5`,
        "--to",
        "1.2.5",
        "--dry-run",
        "--json",
        "--allow-dirty",
        "--skip-validation",
        "--cwd",
        root,
      ])
    );
    expect(code).toBe(4);
    expect(captured.stdout()).toBe("");
    expect(calls[0]).toEqual(expect.arrayContaining(["dlx", `${CLI_PACKAGE_NAME}@1.2.5`]));
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps fixture release directories on the local CLI", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "atlas-handoff-fixture-"));
    writeConsumer(root, "0.1.0");
    const captured = captureWriter();
    let spawned = false;

    await expect(
      runUpgradeCommand({
        cwd: root,
        targetVersion: "0.2.0",
        releasesDir: "releases",
        dryRun: true,
        skipValidation: true,
        allowDirty: true,
        writer: captured.writer,
        runningVersion: "1.2.4",
        spawn: () => {
          spawned = true;
          return spawnResult({ status: 1 });
        },
      })
    ).rejects.toThrow(/release/);

    expect(spawned).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("does not hand off when the running CLI is already the target", () => {
    expect(
      decideUpgradeHandoff({
        runningVersion: "1.2.5",
        targetVersion: "1.2.5",
        handoffChild: false,
      })
    ).toBe("execute");
  });

  it("hands off once and refuses a second hop", () => {
    expect(
      decideUpgradeHandoff({
        runningVersion: "1.2.2",
        targetVersion: "1.2.5",
        handoffChild: false,
      })
    ).toBe("handoff");
    expect(
      decideUpgradeHandoff({
        runningVersion: "1.2.5",
        targetVersion: "1.2.5",
        handoffChild: true,
      })
    ).toBe("execute");
    expect(
      decideUpgradeHandoff({
        runningVersion: "1.2.2",
        targetVersion: "1.2.5",
        handoffChild: true,
      })
    ).toBe("refuse-recursion");
  });

  it("propagates the child exit status and records signals without a shell", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "atlas-handoff-status-"));
    mkdirSync(root, { recursive: true });
    const failed = executeUpgradeHandoff({
      request: { repoRoot: root, targetVersion: "1.2.5", json: true },
      stdio: "pipe",
      spawn: (_command, args, options) => {
        expect(options.shell).toBe(false);
        expect(args.join(" ")).not.toMatch(/[;&|`$]/);
        expect(options.env?.[ATLAS_UPGRADE_HANDOFF_ENV]).toBe("1");
        return spawnResult({ status: 9 });
      },
    });
    expect(failed.exitCode).toBe(9);

    const signaled = executeUpgradeHandoff({
      request: { repoRoot: root, targetVersion: "1.2.5" },
      stdio: "pipe",
      spawn: () => spawnResult({ status: null, signal: "SIGTERM" }),
    });
    expect(signaled.exitCode).toBe(1);
    expect(signaled.signal).toBe("SIGTERM");
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects an invalid registry version before building a package spec", () => {
    expect(() => parseLatestReleaseOutput("1.2.5; touch /tmp/pwned")).toThrow(/1\.2\.5/);
    expect(() => parseLatestReleaseOutput("latest")).toThrow(/latest/);
    expect(parseLatestReleaseOutput('"1.2.5"\n')).toBe("1.2.5");
    expect(() =>
      buildUpgradeHandoffArgs({ repoRoot: "/tmp/app", targetVersion: "1.2.5 && echo owned" })
    ).toThrow(/exact X\.Y\.Z/);
    expect(
      buildUpgradeHandoffArgs({
        repoRoot: "/tmp/app",
        targetVersion: "1.2.5",
        releasesDir: "/tmp/app/releases",
        dryRun: true,
        json: true,
      })
    ).toEqual(
      expect.arrayContaining(["--releases-dir", "/tmp/app/releases", "--dry-run", "--json"])
    );
  });

  it("fails closed when latest discovery is unavailable and does not spawn", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "atlas-handoff-offline-"));
    writeConsumer(root, "1.2.2");
    const captured = captureWriter();
    const commands: string[][] = [];

    await expect(
      runUpgradeCommand({
        cwd: root,
        json: true,
        writer: captured.writer,
        runningVersion: "1.2.2",
        spawn: (_command, args) => {
          commands.push([...args]);
          return spawnResult({ status: 1, stderr: "registry down" });
        },
      })
    ).rejects.toThrow(/Could not resolve the latest published/);

    expect(commands).toEqual([["view", CLI_PACKAGE_NAME, "dist-tags.latest", "--json"]]);
    expect(captured.stdout()).toBe("");
    expect(commands.some((args) => args.includes("dlx"))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("reports already current as JSON and does not hand off when latest matches the baseline", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "atlas-handoff-current-"));
    writeConsumer(root, "1.2.5");
    const captured = captureWriter();

    const code = await runUpgradeCommand({
      cwd: root,
      json: true,
      dryRun: true,
      writer: captured.writer,
      runningVersion: "1.2.5",
      resolveLatest: () => "1.2.5",
      spawn: () => {
        throw new Error("handoff should not run");
      },
    });

    expect(code).toBe(0);
    const payload = JSON.parse(captured.stdout()) as {
      ok: boolean;
      result: {
        status: string;
        sourceVersion: string;
        targetVersion: string;
        latestStable: string;
      };
    };
    expect(payload.ok).toBe(true);
    expect(payload.result.status).toBe("already-current");
    expect(payload.result.sourceVersion).toBe("1.2.5");
    expect(payload.result.targetVersion).toBe("1.2.5");
    expect(payload.result.latestStable).toBe("1.2.5");
    expect(captured.stderr()).toBe("");
    rmSync(root, { recursive: true, force: true });
  });
});
