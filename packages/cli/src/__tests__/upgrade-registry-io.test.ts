import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { SpawnSyncReturns } from "node:child_process";

import { CliError, CliErrorCode } from "../errors/cli-error";
import { installConsumerDependencies } from "../upgrade/dependency-install";
import {
  parsePublishedReleaseRecord,
  readPublishedReleaseRecord,
} from "../upgrade/published-releases";
import { PUBLISHED_RELEASES_SCHEMA_VERSION } from "../upgrade/release-constants";
import {
  type CommandRunner,
  discoverLatestPublishedRelease,
  LATEST_RELEASE_DISCOVERY_ERROR,
  parseLatestReleaseOutput,
} from "../upgrade/release-discovery";
import { readRootPackageVersion, writeRootPackageVersion } from "../upgrade/version-identity";
import { CLI_PACKAGE_NAME } from "../version";

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

function runnerReturning(result: SpawnSyncReturns<string>): {
  spawn: CommandRunner;
  calls: { command: string; args: readonly string[] }[];
} {
  const calls: { command: string; args: readonly string[] }[] = [];
  return {
    calls,
    spawn: (command, args) => {
      calls.push({ command, args });
      return result;
    },
  };
}

function captureCliError(fn: () => unknown): CliError {
  try {
    fn();
  } catch (error) {
    if (error instanceof CliError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected a CliError");
}

describe("parseLatestReleaseOutput", () => {
  it("accepts a bare version, a JSON string, and a { latest } object", () => {
    expect(parseLatestReleaseOutput("1.4.0\n")).toBe("1.4.0");
    expect(parseLatestReleaseOutput('"1.4.0"')).toBe("1.4.0");
    expect(parseLatestReleaseOutput('{"latest":"1.4.0"}')).toBe("1.4.0");
  });

  it("reads the version from the last line when pnpm prints notices first", () => {
    expect(parseLatestReleaseOutput("Progress: resolved 1\nWARN something\n1.4.0")).toBe("1.4.0");
  });

  it("rejects empty output, prereleases, and unsafe JSON payloads", () => {
    expect(() => parseLatestReleaseOutput("   ")).toThrow(/no version/);
    expect(() => parseLatestReleaseOutput("1.4.0-beta.1")).toThrow(/1\.4\.0-beta\.1/);
    expect(() => parseLatestReleaseOutput('{"latest":"1.4.0 && rm -rf /"}')).toThrow();
    expect(() => parseLatestReleaseOutput('{"next":"1.4.0"}')).toThrow();
    expect(() => parseLatestReleaseOutput("{not json")).toThrow();
  });
});

describe("discoverLatestPublishedRelease", () => {
  it("queries the dist-tag for the Atlas CLI package without a shell", () => {
    const calls: { args: readonly string[]; shell: unknown }[] = [];
    const version = discoverLatestPublishedRelease({
      cwd: "/repo",
      spawn: (_command, args, options) => {
        calls.push({ args, shell: options.shell });
        return spawnResult({ stdout: '"1.4.0"\n' });
      },
    });

    expect(version).toBe("1.4.0");
    expect(calls).toEqual([
      { args: ["view", CLI_PACKAGE_NAME, "dist-tags.latest", "--json"], shell: false },
    ]);
  });

  it("fails closed with the registry stderr when pnpm exits non-zero", () => {
    const { spawn } = runnerReturning(
      spawnResult({ status: 1, stderr: "ERR_PNPM_FETCH_404 Not Found\n" })
    );

    const error = captureCliError(() => discoverLatestPublishedRelease({ cwd: "/repo", spawn }));

    expect(error.code).toBe(CliErrorCode.UPGRADE_PREREQUISITE);
    expect(error.message).toBe(LATEST_RELEASE_DISCOVERY_ERROR);
    expect(error.details).toEqual(["ERR_PNPM_FETCH_404 Not Found"]);
  });

  it("falls back to stdout, then the spawn error, then a generic detail", () => {
    const fromStdout = captureCliError(() =>
      discoverLatestPublishedRelease({
        cwd: "/repo",
        spawn: runnerReturning(spawnResult({ status: 1, stdout: "offline" })).spawn,
      })
    );
    expect(fromStdout.details).toEqual(["offline"]);

    const fromSpawnError = captureCliError(() =>
      discoverLatestPublishedRelease({
        cwd: "/repo",
        spawn: runnerReturning(spawnResult({ status: null, error: new Error("spawn pnpm ENOENT") }))
          .spawn,
      })
    );
    expect(fromSpawnError.details).toEqual(["spawn pnpm ENOENT"]);

    const generic = captureCliError(() =>
      discoverLatestPublishedRelease({
        cwd: "/repo",
        spawn: runnerReturning(spawnResult({ status: 2 })).spawn,
      })
    );
    expect(generic.details).toEqual(["pnpm view failed."]);
  });

  it("wraps a throwing runner and unparseable output in the same prerequisite error", () => {
    const thrown = captureCliError(() =>
      discoverLatestPublishedRelease({
        cwd: "/repo",
        spawn: () => {
          throw new Error("EACCES");
        },
      })
    );
    expect(thrown.message).toBe(LATEST_RELEASE_DISCOVERY_ERROR);
    expect(thrown.details).toEqual(["EACCES"]);

    const garbage = captureCliError(() =>
      discoverLatestPublishedRelease({
        cwd: "/repo",
        spawn: runnerReturning(spawnResult({ stdout: "latest" })).spawn,
      })
    );
    expect(garbage.code).toBe(CliErrorCode.UPGRADE_PREREQUISITE);
    expect(garbage.details?.[0]).toMatch(/latest/);
  });
});

describe("published release record", () => {
  const valid = {
    schemaVersion: PUBLISHED_RELEASES_SCHEMA_VERSION,
    packageName: CLI_PACKAGE_NAME,
    versions: ["1.2.0", "1.2.1"],
  };

  it("accepts a well-formed record", () => {
    expect(parsePublishedReleaseRecord(valid, "record.json")).toEqual(valid);
  });

  it.each([
    ["a non-object", null, /must be a JSON object/],
    ["an unknown schema version", { ...valid, schemaVersion: 999 }, /Unsupported .* schemaVersion/],
    ["another package", { ...valid, packageName: "left-pad" }, /must describe/],
    ["non-array versions", { ...valid, versions: "1.2.0" }, /versions to be an array/],
    ["a non-exact version", { ...valid, versions: ["1.2.0", "^1.3.0"] }, /versions\[1\]/],
    ["a prerelease version", { ...valid, versions: ["1.3.0-rc.1"] }, /versions\[0\]/],
    ["a duplicated version", { ...valid, versions: ["1.2.0", "1.2.0"] }, /more than once/],
  ])("rejects %s", (_label, raw, message) => {
    const error = captureCliError(() => parsePublishedReleaseRecord(raw, "record.json"));
    expect(error.code).toBe(CliErrorCode.UPGRADE_PREREQUISITE);
    expect(error.message).toMatch(message);
  });

  describe("from disk", () => {
    let root: string;
    beforeEach(() => {
      root = mkdtempSync(path.join(os.tmpdir(), "atlas-published-"));
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it("refuses a missing record instead of trusting snapshot directories", () => {
      const error = captureCliError(() =>
        readPublishedReleaseRecord(path.join(root, "published.json"))
      );
      expect(error.message).toMatch(/Snapshot directories are not publication evidence/);
    });

    it("reports invalid JSON with the record path", () => {
      const recordPath = path.join(root, "published.json");
      writeFileSync(recordPath, "{ nope", "utf8");

      const error = captureCliError(() => readPublishedReleaseRecord(recordPath));
      expect(error.message).toContain(recordPath);
      expect(error.message).toMatch(/invalid JSON/);
    });

    it("reads and validates a record", () => {
      const recordPath = path.join(root, "published.json");
      writeFileSync(recordPath, JSON.stringify(valid), "utf8");

      expect(readPublishedReleaseRecord(recordPath).versions).toEqual(["1.2.0", "1.2.1"]);
    });
  });
});

describe("installConsumerDependencies", () => {
  it("runs pnpm install without a frozen lockfile in the repository root", () => {
    const calls: { args: readonly string[]; cwd: unknown }[] = [];
    const result = installConsumerDependencies({
      repoRoot: "/consumer",
      spawn: (_command, args, options) => {
        calls.push({ args, cwd: options.cwd });
        return spawnResult();
      },
    });

    expect(result.status).toBe("passed");
    expect(calls).toEqual([{ args: ["install", "--no-frozen-lockfile"], cwd: "/consumer" }]);
  });

  it("reports failure and states that the baseline was not advanced", () => {
    const result = installConsumerDependencies({
      repoRoot: "/consumer",
      spawn: runnerReturning(spawnResult({ status: 1, stderr: "ERR_PNPM_OUTDATED_LOCKFILE" }))
        .spawn,
    });

    expect(result.status).toBe("failed");
    expect(result.message).toMatch(/platform\.baseline was not advanced/);
    expect(result.message).toContain("ERR_PNPM_OUTDATED_LOCKFILE");
  });

  it("treats a signal-terminated install as failed even with exit status 0", () => {
    const result = installConsumerDependencies({
      repoRoot: "/consumer",
      spawn: runnerReturning(spawnResult({ status: 0, signal: "SIGTERM" })).spawn,
    });

    expect(result.status).toBe("failed");
    expect(result.message).toContain("signal SIGTERM");
  });

  it("uses the spawn error when pnpm cannot start", () => {
    const result = installConsumerDependencies({
      repoRoot: "/consumer",
      spawn: runnerReturning(spawnResult({ status: null, error: new Error("spawn pnpm ENOENT") }))
        .spawn,
    });

    expect(result.status).toBe("failed");
    expect(result.message).toContain("spawn pnpm ENOENT");
  });
});

describe("checkout root package version", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "atlas-version-identity-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("reads the version and refuses a missing or blank one", () => {
    const packageJsonPath = path.join(root, "package.json");
    writeFileSync(packageJsonPath, JSON.stringify({ name: "atlas", version: "1.4.0" }), "utf8");
    expect(readRootPackageVersion(root)).toBe("1.4.0");

    writeFileSync(packageJsonPath, JSON.stringify({ name: "atlas", version: "  " }), "utf8");
    expect(() => readRootPackageVersion(root)).toThrow(/Missing version/);

    writeFileSync(packageJsonPath, JSON.stringify({ name: "atlas" }), "utf8");
    expect(() => readRootPackageVersion(root)).toThrow(/Missing version/);
  });

  it("rewrites only the version and keeps a trailing newline", () => {
    const packageJsonPath = path.join(root, "package.json");
    writeFileSync(
      packageJsonPath,
      JSON.stringify({ name: "atlas", version: "1.3.0", private: true }),
      "utf8"
    );

    writeRootPackageVersion(root, "1.4.0");

    const written = readFileSync(packageJsonPath, "utf8");
    expect(written.endsWith("}\n")).toBe(true);
    expect(JSON.parse(written)).toEqual({ name: "atlas", version: "1.4.0", private: true });
  });
});
