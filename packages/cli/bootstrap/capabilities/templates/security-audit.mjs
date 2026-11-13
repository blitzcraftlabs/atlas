#!/usr/bin/env node
/**
 * Consumer-safe dependency audit. Fails on high or critical pnpm audit findings
 * unless a documented advisory + package + version exception matches *every*
 * finding path. Broad dependency-subtree suppression is not used.
 *
 * This is not the Atlas maintainer security-audit policy (Gitleaks, SBOM, workflow pins).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);
const RECOGNIZED_SEVERITIES = new Set(["info", "low", "moderate", "high", "critical"]);
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Documented advisory + package + version + path exceptions. Each entry must
 * name an advisory, package, exact versions, a `pathIncludes` scope and an
 * `expiresOn` date; a finding is ignored only when *every* path matches the scope.
 *
 * The starter ships with no exceptions. The former @lhci/cli tmp and extract-zip
 * exceptions were removed once @lhci/cli 0.16 (Lighthouse 13, @puppeteer/browsers 3)
 * dropped both packages from the dependency tree.
 */
export const CONSUMER_SECURITY_EXCEPTIONS = [];

function isValidIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function advisoryIdFromUrl(url) {
  if (typeof url !== "string") {
    return "";
  }
  const match = url.match(/GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i);
  return match ? match[0].toLowerCase() : "";
}

function normalizeId(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeSeverity(value) {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().toLowerCase();
  return RECOGNIZED_SEVERITIES.has(normalized) ? normalized : "";
}

function recordPackageName(record) {
  if (typeof record.module_name === "string" && record.module_name.trim()) {
    return record.module_name.trim();
  }
  if (typeof record.name === "string" && record.name.trim()) {
    return record.name.trim();
  }
  return "";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isAuditErrorDocument(audit) {
  return isPlainObject(audit) && Object.hasOwn(audit, "error");
}

export function assertConsumerAuditDocument(audit) {
  if (isAuditErrorDocument(audit)) {
    const detail = isPlainObject(audit.error)
      ? audit.error.message || audit.error.summary || audit.error.code || JSON.stringify(audit.error)
      : String(audit.error);
    throw new Error(`pnpm audit returned an error: ${detail}`);
  }

  if (!isPlainObject(audit)) {
    throw new Error("audit document is missing or not an object");
  }

  const hasV2 = Object.hasOwn(audit, "vulnerabilities");
  const hasV1 = Object.hasOwn(audit, "advisories");
  const hasMetadata = Object.hasOwn(audit, "metadata");

  if (!hasV2 && !hasV1 && !hasMetadata) {
    throw new Error("unrecognized audit report: missing vulnerabilities, advisories, and metadata");
  }

  if (hasV2 && !isPlainObject(audit.vulnerabilities)) {
    throw new Error("audit document vulnerabilities must be an object");
  }

  if (hasV1 && !isPlainObject(audit.advisories)) {
    throw new Error("audit document advisories must be an object");
  }

  if (hasMetadata && !isPlainObject(audit.metadata)) {
    throw new Error("audit document metadata must be an object");
  }

  readMetadataBlockingCounts(audit);
  return audit;
}

function readMetadataBlockingCounts(audit) {
  if (!isPlainObject(audit) || !Object.hasOwn(audit, "metadata")) {
    return null;
  }
  if (!isPlainObject(audit.metadata)) {
    throw new Error("audit document metadata must be an object");
  }
  if (!Object.hasOwn(audit.metadata, "vulnerabilities")) {
    return null;
  }
  const counts = audit.metadata.vulnerabilities;
  if (!isPlainObject(counts)) {
    throw new Error("audit document metadata.vulnerabilities must be an object");
  }
  for (const key of ["high", "critical"]) {
    const value = counts[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(
        `audit document metadata.vulnerabilities.${key} must be a non-negative number`
      );
    }
  }
  return { high: counts.high, critical: counts.critical };
}

export function assertAuditFindingsAreEvaluable(audit, findings) {
  const counts = readMetadataBlockingCounts(audit);
  if (!counts || (counts.high === 0 && counts.critical === 0)) {
    return;
  }
  const evaluable = findings.filter((finding) => BLOCKING_SEVERITIES.has(finding.severity));
  if (evaluable.length === 0) {
    throw new Error(
      `audit metadata reports high=${counts.high} critical=${counts.critical} but no evaluable high/critical findings were present`
    );
  }
}

export function collectAuditFindings(audit) {
  const findings = [];
  if (!audit || typeof audit !== "object") {
    return findings;
  }

  const seen = new Set();
  function addFinding(finding) {
    // Deduplicate only identical records. Distinct path sets and severities
    // must all reach exception evaluation so order cannot hide a blocker.
    const paths = Array.isArray(finding.paths)
      ? [...finding.paths].map((entry) => String(entry)).sort()
      : [];
    const key = [
      finding.advisory,
      finding.packageName,
      finding.version,
      finding.severity,
      ...paths,
    ].join("\0");
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    findings.push(finding);
  }

  const advisories = audit.advisories && typeof audit.advisories === "object" ? Object.entries(audit.advisories) : [];
  for (const [key, advisory] of advisories) {
    if (!isPlainObject(advisory)) {
      throw new Error(`advisory record "${key}" is malformed`);
    }
    const severity = normalizeSeverity(advisory.severity);
    if (!severity) {
      throw new Error(
        `advisory record "${key}" has unknown severity ${JSON.stringify(advisory.severity)}`
      );
    }
    const packageName = recordPackageName(advisory);
    if (!packageName) {
      throw new Error(`advisory record "${key}" is missing a package name`);
    }
    const advisoryId =
      normalizeId(advisory.github_advisory_id) ||
      advisoryIdFromUrl(advisory.url) ||
      normalizeId(typeof advisory.id === "string" ? advisory.id : "");
    if (!advisoryId) {
      throw new Error(`advisory record "${key}" does not identify an advisory`);
    }
    const nested = Array.isArray(advisory.findings) ? advisory.findings : [];
    if (nested.length === 0) {
      addFinding({
        advisory: advisoryId,
        packageName,
        version: typeof advisory.version === "string" ? advisory.version : "",
        paths: [],
        severity,
        title: advisory.title ?? "Untitled advisory",
        url: advisory.url ?? "",
      });
      continue;
    }
    for (const finding of nested) {
      addFinding({
        advisory: advisoryId,
        packageName,
        version: typeof finding?.version === "string" ? finding.version : "",
        paths: Array.isArray(finding?.paths) ? finding.paths.map((entry) => String(entry)) : [],
        severity,
        title: advisory.title ?? "Untitled advisory",
        url: advisory.url ?? "",
      });
    }
  }

  const vulnerabilities = isPlainObject(audit.vulnerabilities) ? audit.vulnerabilities : {};
  if (isPlainObject(audit.vulnerabilities)) {
    for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
      for (const finding of collectFromVulnerability(name, vulnerability, vulnerabilities, new Set())) {
        addFinding(finding);
      }
    }
  }

  return findings;
}

function collectFromVulnerability(packageName, vulnerability, vulnerabilities, visiting) {
  if (!isPlainObject(vulnerability)) {
    throw new Error(`vulnerability record "${packageName}" is malformed`);
  }
  if (Object.hasOwn(vulnerability, "severity") && !normalizeSeverity(vulnerability.severity)) {
    throw new Error(
      `vulnerability record "${packageName}" has unknown severity ${JSON.stringify(vulnerability.severity)}`
    );
  }
  if (!Array.isArray(vulnerability.via)) {
    throw new Error(`vulnerability record "${packageName}" via must be an array`);
  }

  const parentSeverity = normalizeSeverity(vulnerability.severity);
  const findings = [];
  const nodes = Array.isArray(vulnerability.nodes) ? vulnerability.nodes.map((entry) => String(entry)) : [];
  visiting.add(packageName);

  for (const item of vulnerability.via) {
    if (typeof item === "string") {
      const ref = item.trim();
      if (!ref) {
        throw new Error(`vulnerability record "${packageName}" has an empty via reference`);
      }
      if (!Object.hasOwn(vulnerabilities, ref) || !isPlainObject(vulnerabilities[ref])) {
        throw new Error(
          `vulnerability record "${packageName}" has an unresolved via reference "${ref}"`
        );
      }
      if (visiting.has(ref)) {
        continue;
      }
      findings.push(...collectFromVulnerability(ref, vulnerabilities[ref], vulnerabilities, visiting));
      continue;
    }
    if (!isPlainObject(item)) {
      throw new Error(`vulnerability record "${packageName}" has a malformed via entry`);
    }
    const viaSeverity = normalizeSeverity(item.severity) || parentSeverity;
    if (Object.hasOwn(item, "severity") && !normalizeSeverity(item.severity)) {
      throw new Error(
        `via record for "${packageName}" has unknown severity ${JSON.stringify(item.severity)}`
      );
    }
    if (!viaSeverity) {
      throw new Error(`via record for "${packageName}" is missing a known severity`);
    }
    const viaName =
      typeof item.name === "string" && item.name.trim()
        ? item.name.trim()
        : packageName;
    const advisory =
      advisoryIdFromUrl(item.url) ||
      normalizeId(typeof item.github_advisory_id === "string" ? item.github_advisory_id : "") ||
      normalizeId(item.source != null ? String(item.source) : "");
    if (!advisory) {
      throw new Error(`via record for "${packageName}" does not identify an advisory`);
    }
    findings.push({
      advisory,
      packageName: viaName,
      version: typeof item.range === "string" ? item.range : "",
      paths: nodes,
      severity: viaSeverity,
      title: item.title ?? vulnerability.title ?? "Untitled advisory",
      url: item.url ?? "",
    });
  }

  visiting.delete(packageName);

  if (findings.length === 0 && !parentSeverity && vulnerability.via.length === 0) {
    throw new Error(`vulnerability record "${packageName}" is missing a known severity`);
  }
  if (findings.length === 0 && BLOCKING_SEVERITIES.has(parentSeverity)) {
    throw new Error(
      `vulnerability record "${packageName}" has ${parentSeverity} severity but no evaluable advisory entries`
    );
  }

  return findings;
}

export function exceptionApplies(finding, exception, now) {
  if (normalizeId(finding.advisory) !== normalizeId(exception.advisory)) {
    return false;
  }
  if (finding.packageName !== exception.packageName) {
    return false;
  }
  if (!exception.versions.includes(finding.version)) {
    return false;
  }
  if (!isValidIsoDate(exception.expiresOn) || exception.expiresOn < now) {
    return false;
  }
  if (!Array.isArray(finding.paths) || finding.paths.length === 0) {
    return false;
  }
  return finding.paths.every((entry) => String(entry).includes(exception.pathIncludes));
}

export function evaluateConsumerSecurityAudit(audit, exceptions = CONSUMER_SECURITY_EXCEPTIONS, now = todayUtc()) {
  assertConsumerAuditDocument(audit);
  const collected = collectAuditFindings(audit);
  assertAuditFindingsAreEvaluable(audit, collected);
  const findings = collected.filter((finding) => BLOCKING_SEVERITIES.has(finding.severity));
  const blocking = [];
  const ignored = [];

  for (const finding of findings) {
    const matched = exceptions.find((exception) => exceptionApplies(finding, exception, now));
    if (matched) {
      ignored.push({ ...finding, exception: matched.advisory });
    } else {
      blocking.push(finding);
    }
  }

  return { blocking, ignored };
}

export function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const options = { auditJson: null, now: todayUtc() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--audit-json") {
      options.auditJson = argv[index + 1];
      index += 1;
    } else if (arg === "--now") {
      options.now = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

function loadAudit(options) {
  if (options.auditJson) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(options.auditJson, "utf8"));
    } catch (error) {
      throw new Error(`audit fixture is not valid JSON: ${error.message}`);
    }
    return assertConsumerAuditDocument(parsed);
  }

  const result = spawnSync("pnpm", ["audit", "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });

  if (result.error) {
    throw new Error(`pnpm audit failed to start: ${result.error.message}`);
  }

  const stdout = (result.stdout ?? "").trim();
  if (!stdout) {
    throw new Error(
      `pnpm audit returned no JSON (exit ${result.status}): ${(result.stderr ?? "").trim()}`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`pnpm audit returned malformed JSON: ${error.message}`);
  }

  assertConsumerAuditDocument(parsed);

  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `pnpm audit failed with unexpected exit ${result.status}: ${(result.stderr ?? "").trim()}`
    );
  }

  return parsed;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  try {
    const audit = loadAudit(options);
    const { blocking, ignored } = evaluateConsumerSecurityAudit(
      audit,
      CONSUMER_SECURITY_EXCEPTIONS,
      options.now
    );

    if (ignored.length > 0) {
      process.stdout.write(
        `Ignored ${ignored.length} high/critical finding(s) with documented advisory/version/path exceptions.\n`
      );
    }

    if (blocking.length === 0) {
      process.stdout.write("No blocking high/critical advisories.\n");
      process.exit(0);
    }

    process.stderr.write("Blocking high/critical advisories:\n");
    for (const finding of blocking) {
      process.stderr.write(
        `- ${finding.packageName}@${finding.version} (${finding.advisory}, ${finding.severity}): ${finding.title} ${finding.url}\n`
      );
    }
    process.exit(1);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

function isInvokedDirectly() {
  if (!process.argv[1]) {
    return false;
  }
  let invokedPath = process.argv[1];
  try {
    invokedPath = realpathSync(invokedPath);
  } catch {
    // Keep the original path when it cannot be resolved.
  }
  return import.meta.url === pathToFileURL(invokedPath).href;
}

if (isInvokedDirectly()) {
  main();
}
