import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

import {
  evaluateCoveragePolicy,
  evaluateSubsystem,
  loadCoverageReport,
  loadPolicy,
  parseLcovReport,
  percent,
  REPO_ROOT,
  resolveReportPaths,
  summarizeFileCoverage,
} from "../coverage-policy.mjs";

const fixtures = path.join(REPO_ROOT, "scripts", "__fixtures__", "coverage-policy");
const cli = path.join(REPO_ROOT, "scripts", "coverage-policy.mjs");

function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return {
      status: error.status ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

describe("coverage policy evaluator", () => {
  it("fails when the coverage report is missing", () => {
    const policy = loadPolicy(path.join(fixtures, "policy-web-api.json"));
    const evaluation = evaluateCoveragePolicy({
      policy,
      reports: { web: path.join(fixtures, "does-not-exist.json") },
    });
    assert.equal(evaluation.ok, false);
    assert.match(evaluation.failures.join("\n"), /Missing coverage report/);
  });

  it("fails when a subsystem matches zero files", () => {
    const report = loadCoverageReport(path.join(fixtures, "passing-web.json"));
    const result = evaluateSubsystem(
      {
        id: "web-api",
        include: ["**/apps/web/src/lib/does-not-exist/**"],
        thresholds: { statements: 85 },
      },
      report
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "zero-matched-files");
  });

  it("fails when a HIGH-risk subsystem is below threshold", () => {
    const result = runCli([
      "--policy",
      path.join(fixtures, "policy-web-api.json"),
      "--report",
      "web",
      path.join(fixtures, "below-threshold-web-api.json"),
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /web-api statements:/);
  });

  it("passes a subsystem that meets the floor", () => {
    const policy = loadPolicy(path.join(fixtures, "policy-web-api.json"));
    const reports = resolveReportPaths(policy, {
      web: path.join(fixtures, "passing-web.json"),
    });
    const evaluation = evaluateCoveragePolicy({ policy, reports });
    assert.equal(evaluation.ok, true, evaluation.failures.join("\n"));
  });

  it("derives line coverage from statementMap and s, not statement totals", () => {
    const fileCoverage = {
      path: "/repo/apps/web/src/lib/api/client.ts",
      statementMap: {
        0: { start: { line: 10, column: 0 }, end: { line: 10, column: 5 } },
        1: { start: { line: 10, column: 6 }, end: { line: 10, column: 10 } },
        2: { start: { line: 11, column: 0 }, end: { line: 11, column: 10 } },
      },
      fnMap: {},
      branchMap: {},
      s: { 0: 1, 1: 0, 2: 1 },
      f: {},
      b: {},
    };

    const summary = summarizeFileCoverage(fileCoverage, fileCoverage.path);
    const result = evaluateSubsystem(
      {
        id: "web-api",
        include: ["**/apps/web/src/lib/api/**"],
        thresholds: { statements: 0, lines: 0 },
      },
      { [fileCoverage.path]: fileCoverage }
    );

    assert.equal(percent(summary.statements.covered, summary.statements.total), (2 / 3) * 100);
    assert.equal(percent(summary.lines.covered, summary.lines.total), 100);
    assert.ok(Math.abs(result.percents.statements - 66.67) < 0.1, result.percents.statements);
    assert.equal(result.percents.lines, 100);
  });

  it("fails when a statement has no statementMap entry", () => {
    const filePath = "/repo/apps/web/src/lib/api/client.ts";
    const fileCoverage = {
      path: filePath,
      s: { 1: 1 },
      f: {},
      b: {},
      statementMap: {},
    };

    assert.throws(
      () => summarizeFileCoverage(fileCoverage, filePath),
      /statement 1 has no valid statementMap entry/
    );

    const evaluation = evaluateSubsystem(
      {
        id: "web-api",
        include: ["**/apps/web/src/lib/api/**"],
        thresholds: { lines: 85 },
      },
      { [filePath]: fileCoverage }
    );
    assert.equal(evaluation.ok, false);
    assert.match(evaluation.failures.join("\n"), /statement 1 has no valid statementMap entry/);
  });

  it("fails when statementMap.start.line is invalid", () => {
    const filePath = "/repo/apps/web/src/lib/api/client.ts";
    const fileCoverage = {
      path: filePath,
      s: { 1: 1 },
      f: {},
      b: {},
      statementMap: {
        1: { start: { line: null, column: 0 }, end: { line: 1, column: 10 } },
      },
    };

    assert.throws(
      () => summarizeFileCoverage(fileCoverage, filePath),
      /statement 1 has no valid statementMap entry/
    );
  });

  it("fails when statementMap is missing while line thresholds are configured", () => {
    const filePath = "/repo/apps/web/src/lib/api/client.ts";
    const fileCoverage = {
      path: filePath,
      s: { 0: 1 },
      f: {},
      b: {},
    };

    const evaluation = evaluateSubsystem(
      {
        id: "web-api",
        include: ["**/apps/web/src/lib/api/**"],
        thresholds: { lines: 85 },
      },
      { [filePath]: fileCoverage }
    );

    assert.equal(evaluation.ok, false);
    assert.match(evaluation.failures.join("\n"), /statementMap must be an object/);
  });

  it("fails through the CLI when coverage is malformed", () => {
    const malformedPath = path.join(fixtures, "malformed-missing-statement-map-entry.json");
    const result = runCli([
      "--policy",
      path.join(fixtures, "policy-web-api.json"),
      "--report",
      "web",
      malformedPath,
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /statement 1 has no valid statementMap entry/);
  });
});

describe("LCOV coverage reports", () => {
  const lcovPath = path.join(fixtures, "scripts-release.lcov");

  it("summarizes lines, functions and branches per file, with no statements", () => {
    const report = loadCoverageReport(lcovPath, "lcov");
    assert.deepEqual(report["scripts/publish-atlas-release.mjs"], {
      statements: { covered: 0, total: 0 },
      lines: { covered: 3, total: 5 },
      functions: { covered: 1, total: 2 },
      // BRDA "-" means the block never ran: counted as an uncovered branch.
      branches: { covered: 1, total: 3 },
    });
    assert.deepEqual(report["scripts/lib/other.mjs"].lines, { covered: 1, total: 1 });
  });

  it("merges a file listed twice instead of double counting it", () => {
    const text = [
      "SF:scripts/a.mjs",
      "DA:1,0",
      "DA:2,1",
      "end_of_record",
      "SF:scripts/a.mjs",
      "DA:1,3",
      "DA:2,0",
      "end_of_record",
    ].join("\n");
    assert.deepEqual(parseLcovReport(text)["scripts/a.mjs"].lines, { covered: 2, total: 2 });
  });

  it("rejects malformed counts and records outside an SF block", () => {
    assert.throws(
      () => parseLcovReport("SF:a.mjs\nDA:1,many\nend_of_record", "x.lcov"),
      /x\.lcov:2/
    );
    assert.throws(() => parseLcovReport("DA:1,1\n", "x.lcov"), /outside SF block/);
  });

  it("rejects an unknown report format", () => {
    assert.throws(
      () => loadCoverageReport(lcovPath, "cobertura"),
      /Unsupported coverage report format/
    );
  });

  it("fails a statements floor on an LCOV report instead of passing it vacuously", () => {
    const result = evaluateSubsystem(
      {
        id: "scripts-release",
        include: ["scripts/publish-atlas-release.mjs"],
        thresholds: { statements: 50 },
      },
      loadCoverageReport(lcovPath, "lcov"),
      { format: "lcov" }
    );
    assert.equal(result.ok, false);
    assert.match(result.failures.join("\n"), /no instrumented statements/);
  });

  it("fails when a required file was never loaded by any test", () => {
    const result = evaluateSubsystem(
      {
        id: "scripts-release",
        include: ["scripts/*.mjs"],
        requireFiles: ["scripts/publish-atlas-release.mjs", "scripts/validate-governance.mjs"],
        thresholds: { lines: 50 },
      },
      loadCoverageReport(lcovPath, "lcov"),
      { format: "lcov" }
    );
    assert.equal(result.ok, false);
    assert.deepEqual(result.failures, [
      "scripts-release: required file scripts/validate-governance.mjs is missing from the coverage report",
    ]);
  });

  it("passes when every required file is present and above its floors", () => {
    const result = evaluateSubsystem(
      {
        id: "scripts-release",
        include: ["scripts/publish-atlas-release.mjs"],
        requireFiles: ["scripts/publish-atlas-release.mjs"],
        thresholds: { lines: 60, branches: 33, functions: 50 },
      },
      loadCoverageReport(lcovPath, "lcov"),
      { format: "lcov" }
    );
    assert.equal(result.ok, true, result.failures.join("\n"));
  });

  it("fails through the CLI for an LCOV report missing a required file", () => {
    const result = runCli([
      "--policy",
      path.join(fixtures, "policy-scripts-release.json"),
      "--report",
      "scripts",
      lcovPath,
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /required file scripts\/validate-governance\.mjs is missing/);
  });
});
