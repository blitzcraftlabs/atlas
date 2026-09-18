#!/usr/bin/env node
/**
 * Validates internal Markdown links in the Atlas repository.
 *
 * Guarantees:
 * - Repository-relative Markdown links resolve to existing files.
 * - Heading fragments are checked when the target is a Markdown file.
 * - Canonical docs must not link into docs/_archive (archive policy).
 *
 * Does NOT guarantee:
 * - External HTTP(S) availability (use --external for a best-effort check).
 * - Links inside fenced code blocks or inline code spans.
 * - Links in archived docs, nested package READMEs, or .cursor skill files.
 * - Perfect parity with every Markdown renderer's heading slug algorithm.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const EXCLUDED_DIR_NAMES = new Set([
  "node_modules",
  ".next",
  ".turbo",
  "coverage",
  "storybook-static",
  "dist",
  "build",
  "playwright-report",
  "test-results",
  ".cursor",
  "_archive",
]);

const MAINTAINED_ROOT_FILES = new Set(["README.md", "AGENTS.md", "CONTRIBUTING.md", "SECURITY.md"]);

const MAINTAINED_DIRECTORIES = [
  path.join("docs", "public"),
  path.join("docs", "how-we-build"),
  path.join("docs", "adr"),
  path.join("docs", "audit"),
  path.join("docs", "security"),
  path.join(".github"),
];

const CANONICAL_PREFIXES = [
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  path.join("docs", "public"),
  path.join("docs", "how-we-build"),
  path.join("docs", "adr"),
  path.join("docs", "security"),
];

const MARKDOWN_LINK_RE = /!?\[[^\]]*\]\(([^)]+)\)/g;

export function isExcludedPath(absolutePath) {
  const relative = path.relative(REPO_ROOT, absolutePath);
  if (relative.startsWith("..")) return true;
  return relative.split(path.sep).some((segment) => EXCLUDED_DIR_NAMES.has(segment));
}

export function isCanonicalDoc(filePath) {
  const relative = normalizeRepoPath(path.relative(REPO_ROOT, filePath));
  return CANONICAL_PREFIXES.some((prefix) => {
    if (prefix.endsWith(".md")) return relative === prefix;
    return relative === prefix || relative.startsWith(`${prefix}/`);
  });
}

export function normalizeRepoPath(filePath) {
  return filePath.split(path.sep).join("/");
}

export function stripCodeLiterals(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "");
}

export function decodeLinkTarget(raw) {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (/^(https?:|mailto:|tel:|javascript:)/i.test(trimmed)) return { kind: "external", target: trimmed };
  const withoutTitle = trimmed.split(/\s+/)[0];
  const [filePart, fragment = ""] = withoutTitle.split("#");
  return {
    kind: "internal",
    filePart: decodeURIComponent(filePart),
    fragment: decodeURIComponent(fragment),
  };
}

export function slugifyHeading(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function extractHeadingSlugs(markdown) {
  const slugs = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) slugs.add(slugifyHeading(match[2]));
  }
  return slugs;
}

export function resolveInternalLink(sourceFile, filePart) {
  if (filePart.startsWith("/")) {
    return path.normalize(path.join(REPO_ROOT, filePart.slice(1)));
  }
  const sourceDir = path.dirname(sourceFile);
  return path.normalize(path.resolve(sourceDir, filePart));
}

export function collectMarkdownFiles(rootDir = REPO_ROOT) {
  const files = [];

  function walk(current) {
    if (isExcludedPath(current)) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIR_NAMES.has(entry.name)) walk(absolute);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".md")) files.push(absolute);
    }
  }

  for (const fileName of MAINTAINED_ROOT_FILES) {
    const absolute = path.join(rootDir, fileName);
    if (fs.existsSync(absolute)) files.push(absolute);
  }

  for (const dir of MAINTAINED_DIRECTORIES) {
    const absoluteDir = path.join(rootDir, dir);
    if (fs.existsSync(absoluteDir)) walk(absoluteDir);
  }

  return [...new Set(files)].sort();
}

export function extractLinkTargets(markdown) {
  const prose = stripCodeLiterals(markdown);
  const targets = [];
  for (const match of prose.matchAll(MARKDOWN_LINK_RE)) {
    targets.push(match[1]);
  }
  return targets;
}

export function validateInternalLink({ sourceFile, parsed, options = {} }) {
  const issues = [];
  const targetPath = resolveInternalLink(sourceFile, parsed.filePart);
  const relativeTarget = normalizeRepoPath(path.relative(REPO_ROOT, targetPath));
  const sourceRelative = normalizeRepoPath(path.relative(REPO_ROOT, sourceFile));

  if (isCanonicalDoc(sourceFile) && relativeTarget.startsWith("docs/_archive/")) {
    issues.push({
      type: "archive-policy",
      source: sourceRelative,
      target: parsed.filePart,
      message: "Canonical documentation must not link to docs/_archive/",
    });
  }

  if (!fs.existsSync(targetPath)) {
    issues.push({
      type: "missing-file",
      source: sourceRelative,
      target: parsed.filePart,
      message: `Missing file: ${parsed.filePart}`,
    });
    return issues;
  }

  if (parsed.fragment && targetPath.endsWith(".md")) {
    const content = fs.readFileSync(targetPath, "utf8");
    const slugs = extractHeadingSlugs(content);
    if (!slugs.has(parsed.fragment) && !options.allowMissingFragments) {
      issues.push({
        type: "missing-fragment",
        source: sourceRelative,
        target: `${parsed.filePart}#${parsed.fragment}`,
        message: `Missing heading fragment: #${parsed.fragment}`,
      });
    }
  }

  return issues;
}

export function checkDocumentationLinks(options = {}) {
  const files = options.files ?? collectMarkdownFiles();
  const issues = [];
  const externalLinks = [];

  for (const file of files) {
    if (isExcludedPath(file)) continue;
    const markdown = fs.readFileSync(file, "utf8");
    for (const rawTarget of extractLinkTargets(markdown)) {
      const parsed = decodeLinkTarget(rawTarget);
      if (!parsed) continue;
      if (parsed.kind === "external") {
        externalLinks.push({ source: file, url: parsed.target });
        continue;
      }
      issues.push(
        ...validateInternalLink({
          sourceFile: file,
          parsed,
          options,
        }),
      );
    }
  }

  return { issues, externalLinks, scannedFiles: files.length };
}

async function checkExternalLinks(externalLinks, { timeoutMs = 8000, retries = 2 } = {}) {
  const failures = [];
  const unique = [...new Map(externalLinks.map((item) => [item.url, item])).values()];

  for (const { source, url } of unique) {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          method: "HEAD",
          redirect: "follow",
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (response.ok || response.status === 405) {
          lastError = null;
          break;
        }
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    if (lastError) {
      failures.push({
        source: normalizeRepoPath(path.relative(REPO_ROOT, source)),
        url,
        message: lastError.message ?? String(lastError),
      });
    }
  }

  return failures;
}

function printReport(result, externalFailures = []) {
  const { issues, scannedFiles } = result;
  console.log(`Scanned ${scannedFiles} maintained Markdown files.`);

  if (issues.length === 0 && externalFailures.length === 0) {
    console.log("✓ No documentation link issues found.");
    return 0;
  }

  for (const issue of issues) {
    console.error(`✗ [${issue.type}] ${issue.source} → ${issue.target}: ${issue.message}`);
  }
  for (const failure of externalFailures) {
    console.error(`✗ [external] ${failure.source} → ${failure.url}: ${failure.message}`);
  }

  console.error(
    `\nFound ${issues.length} internal issue(s) and ${externalFailures.length} external failure(s).`,
  );
  return issues.length + externalFailures.length > 0 ? 1 : 0;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const checkExternal = args.has("--external");

  const result = checkDocumentationLinks();
  let externalFailures = [];

  if (checkExternal) {
    console.log("Checking external links (best-effort; network flakiness may cause false positives)...");
    externalFailures = await checkExternalLinks(result.externalLinks);
  } else if (result.externalLinks.length > 0) {
    console.log(
      `Skipped ${result.externalLinks.length} external link(s). Run with --external for a best-effort HTTP check.`,
    );
  }

  const exitCode = printReport(result, externalFailures);
  process.exit(exitCode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

function pathToFileURL(filePath) {
  const resolved = path.resolve(filePath);
  return new URL(`file://${resolved}`);
}

// Self-hosted runner verification marker (safe to remove after CI validation).
