#!/usr/bin/env node
/**
 * Evaluate coverage reports against named subsystem floors.
 *
 * Reports are Istanbul coverage-final.json (Jest) by default, or LCOV when the report entry sets
 * `"format": "lcov"` (Node's test runner, used for root `scripts/**`). LCOV has no statements
 * metric, so an LCOV subsystem must not set a statements threshold.
 *
 * Fail closed: missing report, missing subsystem, zero matched files, a `requireFiles` entry absent
 * from the report, or a metric below threshold exits non-zero.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");

const METRICS = ["statements", "branches", "functions", "lines"];

export function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0double\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\0double\0/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

export function matchesAny(filePath, patterns) {
  if (!patterns || patterns.length === 0) {
    return false;
  }
  const posix = toPosixPath(filePath);
  return patterns.some((pattern) => globToRegExp(pattern).test(posix));
}

function countHits(values) {
  let covered = 0;
  let total = 0;
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const hit of value) {
        total += 1;
        if (hit > 0) covered += 1;
      }
    } else {
      total += 1;
      if (value > 0) covered += 1;
    }
  }
  return { covered, total };
}

function assertCoverageField(value, fieldName, filePath) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Malformed Istanbul coverage for ${filePath}: ${fieldName} must be an object`);
  }
}

function assertValidStatementLine(statementId, location, filePath) {
  if (!location?.start || !Number.isInteger(location.start.line) || location.start.line < 1) {
    throw new Error(
      `Malformed Istanbul coverage for ${filePath}: statement ${statementId} has no valid statementMap entry`
    );
  }
}

function getLineHits(fileCoverage, filePath) {
  assertCoverageField(fileCoverage.statementMap, "statementMap", filePath);

  const lineHits = new Map();
  for (const [statementId, hits] of Object.entries(fileCoverage.s)) {
    const location = fileCoverage.statementMap[statementId];
    assertValidStatementLine(statementId, location, filePath);

    const line = location.start.line;
    const previous = lineHits.get(line) ?? 0;
    lineHits.set(line, Math.max(previous, hits));
  }

  return [...lineHits.values()];
}

export function summarizeFileCoverage(fileCoverage, filePath = "<unknown>") {
  assertCoverageField(fileCoverage, "file coverage", filePath);
  assertCoverageField(fileCoverage.s, "s", filePath);
  assertCoverageField(fileCoverage.f, "f", filePath);
  assertCoverageField(fileCoverage.b, "b", filePath);

  const statements = countHits(Object.values(fileCoverage.s));
  const functions = countHits(Object.values(fileCoverage.f));
  const branches = countHits(Object.values(fileCoverage.b));
  const lines = countHits(getLineHits(fileCoverage, filePath));

  return { statements, functions, branches, lines };
}

export function mergeSummaries(summaries) {
  const merged = {
    statements: { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 },
    branches: { covered: 0, total: 0 },
    lines: { covered: 0, total: 0 },
  };
  for (const summary of summaries) {
    for (const metric of METRICS) {
      merged[metric].covered += summary[metric].covered;
      merged[metric].total += summary[metric].total;
    }
  }
  return merged;
}

export function percent(covered, total) {
  if (total === 0) return 100;
  return (covered / total) * 100;
}

export function loadPolicy(policyPath) {
  const raw = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray(raw.reports) ||
    !Array.isArray(raw.subsystems)
  ) {
    throw new Error("Coverage policy must include reports[] and subsystems[]");
  }
  return raw;
}

function lcovNumber(value, field, reportPath, lineNumber) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Malformed LCOV at ${reportPath}:${lineNumber}: ${field} has invalid count`);
  }
  return parsed;
}

function hitsToCount(hitsByKey) {
  let covered = 0;
  for (const hits of hitsByKey.values()) {
    if (hits > 0) covered += 1;
  }
  return { covered, total: hitsByKey.size };
}

/**
 * Parse LCOV into per-file summaries shaped like `summarizeFileCoverage` output.
 * Counts come from DA/FNDA/BRDA records so a file listed more than once is merged, not double
 * counted. Statements are reported as zero-of-zero because LCOV does not record them.
 */
export function parseLcovReport(text, reportPath = "<lcov>") {
  const files = new Map();
  let current = null;

  const lines = text.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    const lineNumber = index + 1;
    if (line.length === 0) continue;

    if (line.startsWith("SF:")) {
      const filePath = line.slice(3);
      current = files.get(filePath) ?? {
        lines: new Map(),
        functions: new Map(),
        branches: new Map(),
      };
      files.set(filePath, current);
      continue;
    }
    if (line === "end_of_record") {
      current = null;
      continue;
    }
    if (!current) {
      if (line.startsWith("TN:")) continue;
      throw new Error(`Malformed LCOV at ${reportPath}:${lineNumber}: record outside SF block`);
    }

    const separator = line.indexOf(":");
    const tag = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1);

    if (tag === "DA") {
      const [lineNo, hits] = value.split(",");
      const key = lcovNumber(lineNo, "DA line", reportPath, lineNumber);
      const count = lcovNumber(hits, "DA hits", reportPath, lineNumber);
      current.lines.set(key, Math.max(current.lines.get(key) ?? 0, count));
    } else if (tag === "FNDA") {
      const comma = value.indexOf(",");
      const count = lcovNumber(value.slice(0, comma), "FNDA hits", reportPath, lineNumber);
      const name = value.slice(comma + 1);
      current.functions.set(name, Math.max(current.functions.get(name) ?? 0, count));
    } else if (tag === "BRDA") {
      const [lineNo, block, branch, hits] = value.split(",");
      const key = `${lineNo},${block},${branch}`;
      // "-" means the branch's block never ran.
      const count = hits === "-" ? 0 : lcovNumber(hits, "BRDA hits", reportPath, lineNumber);
      current.branches.set(key, Math.max(current.branches.get(key) ?? 0, count));
    }
    // FN, LF/LH, FNF/FNH, BRF/BRH and unknown tags are derivable or informational.
  }

  const report = {};
  for (const [filePath, record] of files) {
    report[filePath] = {
      statements: { covered: 0, total: 0 },
      lines: hitsToCount(record.lines),
      functions: hitsToCount(record.functions),
      branches: hitsToCount(record.branches),
    };
  }
  return report;
}

export function loadCoverageReport(reportPath, format = "istanbul") {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`Missing coverage report: ${reportPath}`);
  }
  if (format === "lcov") {
    return parseLcovReport(fs.readFileSync(reportPath, "utf8"), reportPath);
  }
  if (format !== "istanbul") {
    throw new Error(`Unsupported coverage report format "${format}" for ${reportPath}`);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error(`Coverage report is not an Istanbul coverage-final object: ${reportPath}`);
  }
  return report;
}

export function evaluateSubsystem(subsystem, report, { format = "istanbul" } = {}) {
  const matched = [];
  for (const [filePath, fileCoverage] of Object.entries(report)) {
    if (subsystem.exclude && matchesAny(filePath, subsystem.exclude)) {
      continue;
    }
    if (!subsystem.include || !matchesAny(filePath, subsystem.include)) {
      continue;
    }
    try {
      const summary =
        format === "lcov" ? fileCoverage : summarizeFileCoverage(fileCoverage, filePath);
      matched.push({ filePath, summary });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        id: subsystem.id,
        ok: false,
        reason: "malformed-coverage",
        matchedFiles: matched.length,
        percents: {},
        failures: [message],
      };
    }
  }

  if (matched.length === 0) {
    return {
      id: subsystem.id,
      ok: false,
      reason: "zero-matched-files",
      matchedFiles: 0,
      percents: {},
      failures: [`Subsystem ${subsystem.id} matched zero coverage files`],
    };
  }

  const merged = mergeSummaries(matched.map((entry) => entry.summary));
  const thresholds = subsystem.thresholds ?? {};
  const percents = {};
  const failures = [];

  // LCOV only lists files a test loaded, so an untested file would silently drop out of the
  // subsystem. requireFiles names the files that must be measured.
  const matchedPaths = matched.map((entry) => toPosixPath(entry.filePath));
  for (const required of subsystem.requireFiles ?? []) {
    if (
      !matchedPaths.some((filePath) => filePath === required || filePath.endsWith(`/${required}`))
    ) {
      failures.push(
        `${subsystem.id}: required file ${required} is missing from the coverage report`
      );
    }
  }

  for (const metric of METRICS) {
    if (typeof thresholds[metric] !== "number") continue;
    const value = percent(merged[metric].covered, merged[metric].total);
    percents[metric] = value;
    if (merged[metric].total === 0) {
      failures.push(`${subsystem.id} ${metric}: no instrumented ${metric}`);
    } else if (value + 1e-9 < thresholds[metric]) {
      failures.push(`${subsystem.id} ${metric}: ${value.toFixed(2)}% < ${thresholds[metric]}%`);
    }
  }

  return {
    id: subsystem.id,
    ok: failures.length === 0,
    matchedFiles: matched.length,
    percents,
    totals: merged,
    failures,
  };
}

export function evaluateCoveragePolicy({ policy, reports }) {
  const results = [];
  const failures = [];

  const reportById = new Map(policy.reports.map((entry) => [entry.id, entry]));

  for (const subsystem of policy.subsystems) {
    const reportEntry = reportById.get(subsystem.report);
    if (!reportEntry) {
      const message = `Subsystem ${subsystem.id} references unknown report "${subsystem.report}"`;
      failures.push(message);
      results.push({
        id: subsystem.id,
        ok: false,
        reason: "missing-report-id",
        failures: [message],
      });
      continue;
    }

    const reportPath = reports[subsystem.report];
    if (!reportPath) {
      const message = `Missing coverage report mapping for "${subsystem.report}"`;
      failures.push(message);
      results.push({ id: subsystem.id, ok: false, reason: "missing-report", failures: [message] });
      continue;
    }

    let report;
    try {
      report = loadCoverageReport(reportPath, reportEntry.format);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(message);
      results.push({ id: subsystem.id, ok: false, reason: "missing-report", failures: [message] });
      continue;
    }

    const result = evaluateSubsystem(subsystem, report, { format: reportEntry.format });
    results.push(result);
    failures.push(...result.failures);
  }

  const expectedIds = policy.subsystems.map((subsystem) => subsystem.id);
  for (const id of expectedIds) {
    if (!results.some((result) => result.id === id)) {
      failures.push(`Missing expected subsystem: ${id}`);
    }
  }

  return {
    ok: failures.length === 0,
    results,
    failures,
  };
}

export function formatCoverageSummary(evaluation) {
  const lines = ["Atlas risk coverage policy", ""];
  for (const result of evaluation.results) {
    const status = result.ok ? "pass" : "FAIL";
    const percents = METRICS.filter((metric) => typeof result.percents?.[metric] === "number")
      .map((metric) => `${metric}=${result.percents[metric].toFixed(1)}%`)
      .join(" ");
    lines.push(`- ${result.id}: ${status} files=${result.matchedFiles ?? 0} ${percents}`.trim());
  }
  if (evaluation.failures.length > 0) {
    lines.push("", "Failures:");
    for (const failure of evaluation.failures) {
      lines.push(`  - ${failure}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = { policy: path.join(REPO_ROOT, "coverage-policy.json"), reports: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--policy") {
      args.policy = path.resolve(argv[++i]);
    } else if (current === "--report") {
      const id = argv[++i];
      const reportPath = path.resolve(argv[++i]);
      args.reports[id] = reportPath;
    }
  }
  return args;
}

export function resolveReportPaths(policy, overrides, repoRoot = REPO_ROOT) {
  const reports = {};
  for (const entry of policy.reports) {
    reports[entry.id] = overrides[entry.id] ?? path.join(repoRoot, entry.path);
  }
  return reports;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const policy = loadPolicy(args.policy);
  const reports = resolveReportPaths(policy, args.reports);
  const evaluation = evaluateCoveragePolicy({ policy, reports });
  process.stdout.write(formatCoverageSummary(evaluation));
  process.exit(evaluation.ok ? 0 : 1);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main();
}
