/**
 * SPDX-oriented dependency license policy for Atlas.
 * Engineering policy only — not legal advice.
 *
 * Multi-license expressions are classified conservatively: Atlas policy is stricter than
 * SPDX "OR" selection semantics. For example, `MIT OR GPL-3.0` is treated as disallowed
 * because any disallowed token makes the whole expression disallowed. Parentheses are
 * stripped before tokenization; nested grouping is not interpreted.
 */

export const LICENSE_POLICY = {
  allowed: [
    "0BSD",
    "Apache-2.0",
    "BlueOak-1.0.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "CC0-1.0",
    "ISC",
    "MIT",
    "Unlicense",
    "WTFPL",
    "Zlib",
  ],
  reviewRequired: [
    "CC-BY-4.0",
    "CDDL-1.0",
    "CDDL-1.1",
    "FSL-1.1-Apache-2.0",
    "FSL-1.1-MIT",
    "LGPL-2.0",
    "LGPL-2.1",
    "LGPL-2.1-or-later",
    "LGPL-3.0",
    "LGPL-3.0-or-later",
    "MPL-1.1",
    "MPL-2.0",
    "Python-2.0",
  ],
  disallowed: [
    "Commercial",
    "GPL-1.0",
    "GPL-2.0",
    "GPL-3.0",
    "AGPL-1.0",
    "AGPL-3.0",
    "UNLICENSED",
    "Proprietary",
  ],
};

const ALLOWED = new Set(LICENSE_POLICY.allowed.map(normalizeSpdxId));
const REVIEW = new Set(LICENSE_POLICY.reviewRequired.map(normalizeSpdxId));
const DISALLOWED = new Set(LICENSE_POLICY.disallowed.map(normalizeSpdxId));

const STATUS_RANK = {
  allowed: 0,
  "review-required": 1,
  unknown: 2,
  disallowed: 3,
};

export function normalizeSpdxId(value) {
  return String(value ?? "")
    .trim()
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Normalize npm `license` / legacy `licenses[]` into a conservative SPDX-like expression.
 * Legacy array entries are combined with AND — Atlas does not assume npm's ambiguous
 * array semantics and fails conservatively when multiple licenses are declared.
 */
export function normalizeLicenseField(license, licenses) {
  if (license != null) {
    if (typeof license === "string") {
      const trimmed = license.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    if (typeof license === "object" && typeof license.type === "string") {
      return license.type.trim() || null;
    }
  }

  if (!Array.isArray(licenses) || licenses.length === 0) {
    return null;
  }

  const types = licenses
    .map((entry) => {
      if (typeof entry === "string") {
        return entry.trim();
      }
      if (typeof entry?.type === "string") {
        return entry.type.trim();
      }
      return "";
    })
    .filter(Boolean);

  if (types.length === 0) {
    return null;
  }

  if (types.length === 1) {
    return types[0];
  }

  return types.join(" AND ");
}

export function classifySingleLicense(spdxId) {
  const normalized = normalizeSpdxId(spdxId);

  if (!normalized) {
    return "unknown";
  }

  if (/^SEE LICENSE/i.test(normalized)) {
    return "review-required";
  }

  if (normalized === "BSD") {
    return classifySingleLicense("BSD-3-Clause");
  }

  const candidates = [normalized];
  if (/-or-later$/i.test(normalized)) {
    candidates.push(normalized.replace(/-or-later$/i, ""));
  }

  for (const candidate of candidates) {
    if (ALLOWED.has(candidate)) {
      return "allowed";
    }
    if (DISALLOWED.has(candidate)) {
      return "disallowed";
    }
    if (REVIEW.has(candidate)) {
      return "review-required";
    }
  }

  return "unknown";
}

function mergeStatuses(statuses, operator) {
  if (statuses.length === 0) {
    return "unknown";
  }

  if (operator === "OR") {
    if (statuses.some((status) => status === "disallowed")) {
      return "disallowed";
    }
    if (statuses.some((status) => status === "unknown")) {
      return "unknown";
    }
    if (statuses.some((status) => status === "review-required")) {
      return "review-required";
    }
    return "allowed";
  }

  return statuses.reduce((current, next) =>
    STATUS_RANK[next] > STATUS_RANK[current] ? next : current,
  );
}

function splitTopLevel(expression, operator) {
  const parts = [];
  let start = 0;

  for (let i = 0; i < expression.length; i += 1) {
    if (expression.slice(i, i + operator.length) === operator) {
      parts.push(expression.slice(start, i).trim());
      start = i + operator.length;
      i += operator.length - 1;
    }
  }

  parts.push(expression.slice(start).trim());
  return parts.filter(Boolean);
}

export function classifyLicenseExpression(expression) {
  const normalized = normalizeSpdxId(expression);

  if (!normalized) {
    return "unknown";
  }

  if (normalized.includes(" AND ")) {
    const parts = splitTopLevel(normalized, " AND ");
    return mergeStatuses(
      parts.map((part) => classifyLicenseExpression(part)),
      "AND",
    );
  }

  if (normalized.includes(" OR ")) {
    const parts = splitTopLevel(normalized, " OR ");
    return mergeStatuses(
      parts.map((part) => classifyLicenseExpression(part)),
      "OR",
    );
  }

  return classifySingleLicense(normalized);
}

export function isAtlasWorkspacePackage(name) {
  return name.startsWith("@atlas/");
}
