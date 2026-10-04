import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ATLAS_WORKSPACE_PACKAGES, readJson } from "./atlas-workspaces.mjs";
import { HISTORICAL_UNPUBLISHED_VERSIONS } from "./release-publication.mjs";
import {
  extractChangelogSection,
  extractSectionBody,
  extractSectionDate,
} from "./extract-changelog-section.mjs";
import { buildPlatformReleaseBody, parseChangelogEntries } from "./root-release-changelog.mjs";
import { assertValidAtlasReleaseVersion, parseSemver } from "./semver-utils.mjs";

const ATLAS_REPO_COMPARE = "https://github.com/blitzcraftlabs/atlas/compare";
const ATLAS_REPO_RELEASES = "https://github.com/blitzcraftlabs/atlas/releases/tag";
const CONSOLIDATE_DIR = path.dirname(fileURLToPath(import.meta.url));

function writeJson(relativePath, data, repoRoot) {
  const filePath = path.join(repoRoot, relativePath);
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function syncWorkspaceVersions(version, repoRoot = process.cwd()) {
  writeJson("package.json", { ...readJson("package.json", repoRoot), version }, repoRoot);

  for (const pkg of ATLAS_WORKSPACE_PACKAGES) {
    const pkgPath = path.join(pkg.relativePath, "package.json");
    writeJson(pkgPath, { ...readJson(pkgPath, repoRoot), version }, repoRoot);
  }
}

export function collectPackageChangelogSections(version, repoRoot = process.cwd()) {
  const sections = [];

  for (const pkg of ATLAS_WORKSPACE_PACKAGES) {
    const changelogPath = path.join(repoRoot, pkg.relativePath, "CHANGELOG.md");
    if (!existsSync(changelogPath)) {
      continue;
    }

    const content = readFileSync(changelogPath, "utf8");
    const section = extractChangelogSection(content, version);
    if (section) {
      sections.push({ name: pkg.name, section });
    }
  }

  return sections;
}

export function mergeChangelogSectionBodies(sections) {
  return buildPlatformReleaseBody({
    workspaceBodies: sections.map((entry) => ({
      packageName: entry.name,
      body: extractSectionBody(entry.section),
    })),
  });
}

/** Merge root [Unreleased] content with workspace-generated release bodies. */
export function mergeReleaseBodies(unreleasedBody, workspaceBody) {
  return buildPlatformReleaseBody({
    unreleasedBody,
    workspaceBodies: [{ body: workspaceBody ?? "" }],
  });
}

export function extractUnreleasedBody(rootContent) {
  const unreleasedMatch = rootContent.match(/^##\s+\[Unreleased\]\s*$/m);
  if (!unreleasedMatch) {
    return "";
  }

  const afterStart = unreleasedMatch.index + unreleasedMatch[0].length;
  const afterUnreleased = rootContent.slice(afterStart);
  const nextHeader = afterUnreleased.search(/^##\s+/m);
  let body = nextHeader === -1 ? afterUnreleased : afterUnreleased.slice(0, nextHeader);

  const linkRefIndex = body.search(/^\[[^\]]+\]:\s/m);
  if (linkRefIndex !== -1) {
    body = body.slice(0, linkRefIndex);
  }

  return body.trim();
}

export function resetUnreleasedSection(rootContent) {
  const unreleasedMatch = rootContent.match(/^##\s+\[Unreleased\]\s*$/m);
  if (!unreleasedMatch) {
    throw new Error("Root CHANGELOG.md must contain an [Unreleased] section");
  }

  const afterStart = unreleasedMatch.index + unreleasedMatch[0].length;
  const afterUnreleased = rootContent.slice(afterStart);
  const nextHeader = afterUnreleased.search(/^##\s+/m);
  const nextSectionStart = nextHeader === -1 ? rootContent.length : afterStart + nextHeader;
  const remainder = rootContent.slice(nextSectionStart).replace(/^\s+/, "");

  return `${rootContent.slice(0, afterStart)}\n\n${remainder}`;
}

export function findReleaseVersions(rootContent) {
  const pattern = /^##\s+\[(\d+\.\d+\.\d+)\]/gm;
  const versions = [];
  let match = pattern.exec(rootContent);
  while (match) {
    versions.push(match[1]);
    match = pattern.exec(rootContent);
  }
  return versions;
}

function compareParsedSemver(a, b) {
  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  if (a.patch !== b.patch) {
    return a.patch - b.patch;
  }

  if (!a.prerelease && b.prerelease) {
    return 1;
  }
  if (a.prerelease && !b.prerelease) {
    return -1;
  }
  if (!a.prerelease && !b.prerelease) {
    return 0;
  }

  return a.prerelease.localeCompare(b.prerelease);
}

export function findPreviousReleaseVersion(rootContent, newVersion) {
  const newParsed = parseSemver(newVersion);
  if (!newParsed) {
    return null;
  }

  let previous = null;
  let previousParsed = null;

  for (const version of findReleaseVersions(rootContent)) {
    if (version === newVersion) {
      continue;
    }

    if (HISTORICAL_UNPUBLISHED_VERSIONS.includes(version)) {
      continue;
    }

    const parsed = parseSemver(version);
    if (!parsed || compareParsedSemver(parsed, newParsed) >= 0) {
      continue;
    }

    if (!previousParsed || compareParsedSemver(parsed, previousParsed) > 0) {
      previous = version;
      previousParsed = parsed;
    }
  }

  return previous;
}

export function updateChangelogLinkReferences(rootContent, version, previousVersion) {
  const unreleasedLink = `[Unreleased]: ${ATLAS_REPO_COMPARE}/v${version}...HEAD`;
  const versionLink = previousVersion
    ? `[${version}]: ${ATLAS_REPO_COMPARE}/v${previousVersion}...v${version}`
    : `[${version}]: ${ATLAS_REPO_RELEASES}/v${version}`;

  let content = rootContent;

  if (/\[Unreleased\]:\s/.test(content)) {
    content = content.replace(/\[Unreleased\]:\s*.+/, unreleasedLink);
  } else {
    content = `${content.trimEnd()}\n\n${unreleasedLink}\n`;
  }

  const escaped = version.replace(/\./g, "\\.");
  const versionLinkPattern = new RegExp(`\\[${escaped}\\]:\\s*.+`);

  if (versionLinkPattern.test(content)) {
    content = content.replace(versionLinkPattern, versionLink);
  } else if (previousVersion) {
    const previousEscaped = previousVersion.replace(/\./g, "\\.");
    const previousLinkPattern = new RegExp(`^(\\[${previousEscaped}\\]:\\s*.+)$`, "m");
    if (previousLinkPattern.test(content)) {
      content = content.replace(previousLinkPattern, `${versionLink}\n$1`);
    } else {
      content = `${content.trimEnd()}\n${versionLink}\n`;
    }
  } else {
    content = `${content.trimEnd()}\n${versionLink}\n`;
  }

  return content;
}

function insertOrUpdateVersionSection(rootContent, version, releaseBody, dateLine) {
  const header = dateLine ? `## [${version}] - ${dateLine}` : `## [${version}]`;
  const newSection = `${header}\n\n${releaseBody.trim()}\n`;
  const escaped = version.replace(/\./g, "\\.");
  const headerPattern = new RegExp(
    `^##\\s+(?:\\[${escaped}\\]|${escaped})(?:\\s+-\\s+.+)?\\s*$`,
    "m"
  );
  const headerMatch = rootContent.match(headerPattern);

  if (headerMatch) {
    const start = headerMatch.index;
    const afterHeader = rootContent.slice(start + headerMatch[0].length);
    const nextSection = afterHeader.search(/\n##\s+/);
    const nextLinkRef = afterHeader.search(/\n\[[^\]]+\]:\s/);
    const endOffset = Math.min(
      nextSection === -1 ? afterHeader.length : nextSection,
      nextLinkRef === -1 ? afterHeader.length : nextLinkRef
    );
    const end = start + headerMatch[0].length + endOffset;
    const before = rootContent.slice(0, start).trimEnd();
    const after = rootContent.slice(end).trimStart();
    return `${before}\n\n${newSection.trim()}\n\n${after}`;
  }

  const unreleasedMatch = rootContent.match(/^##\s+\[Unreleased\]\s*$/m);
  if (!unreleasedMatch) {
    throw new Error("Root CHANGELOG.md must contain an [Unreleased] section");
  }

  const afterUnreleasedStart = unreleasedMatch.index + unreleasedMatch[0].length;
  const afterUnreleased = rootContent.slice(afterUnreleasedStart);
  const nextHeader = afterUnreleased.search(/^##\s+/m);
  const insertAt = nextHeader === -1 ? rootContent.length : afterUnreleasedStart + nextHeader;

  const before = rootContent.slice(0, insertAt).trimEnd();
  const after = rootContent.slice(insertAt).trimStart();
  return `${before}\n\n${newSection.trim()}\n\n${after}`;
}

function workspaceBodiesFromInput(workspaceInput) {
  if (!workspaceInput) {
    return [];
  }

  if (Array.isArray(workspaceInput)) {
    return workspaceInput.map((entry) => ({
      packageName: entry.name,
      body: extractSectionBody(entry.section),
    }));
  }

  return [{ body: String(workspaceInput) }];
}

export function updateRootChangelog(rootContent, version, workspaceInput, dateLine) {
  const unreleasedBody = extractUnreleasedBody(rootContent);
  const existingSection = extractChangelogSection(rootContent, version);
  const existingBody = existingSection ? extractSectionBody(existingSection) : "";
  const releaseBody = buildPlatformReleaseBody({
    existingBody,
    unreleasedBody,
    workspaceBodies: workspaceBodiesFromInput(workspaceInput),
  });

  let content = resetUnreleasedSection(rootContent);
  content = insertOrUpdateVersionSection(content, version, releaseBody, dateLine);

  const previousVersion = findPreviousReleaseVersion(content, version);
  content = updateChangelogLinkReferences(content, version, previousVersion);

  return content;
}

export function generateCurrentProductionReleaseSnapshot(repoRoot = process.cwd(), options = {}) {
  const manifestPath = path.join(repoRoot, "templates", "app-infrastructure.manifest.json");
  const cliPackagePath = path.join(repoRoot, "packages", "cli", "package.json");
  if (!existsSync(manifestPath) || !existsSync(cliPackagePath)) {
    return { status: "skipped", reason: "not-an-atlas-checkout" };
  }

  const script = path.join(
    CONSOLIDATE_DIR,
    "../packages/cli/scripts/generate-production-release-snapshot.mjs"
  );
  if (!existsSync(script)) {
    throw new Error(`Missing production snapshot generator at ${script}`);
  }

  const args = [script, "--repo-root", repoRoot];
  if (typeof options.outputDir === "string" && options.outputDir.length > 0) {
    args.push("--output-dir", options.outputDir);
  }
  if (options.replace === true) {
    args.push("--replace");
  }

  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(
      `Failed to generate the production release snapshot for the current Atlas version (${result.status ?? "null"})`
    );
  }

  return { status: "ran" };
}

export function consolidateAtlasRelease(repoRoot = process.cwd(), options = {}) {
  const version = readJson(
    path.join(ATLAS_WORKSPACE_PACKAGES[0].relativePath, "package.json"),
    repoRoot
  ).version;

  assertValidAtlasReleaseVersion(version);

  const packageSections = collectPackageChangelogSections(version, repoRoot);
  const workspaceBody = mergeChangelogSectionBodies(packageSections);
  const hasWorkspaceEntries = packageSections.some(
    (entry) => parseChangelogEntries(extractSectionBody(entry.section)).length > 0
  );

  if (!hasWorkspaceEntries && packageSections.length === 0) {
    throw new Error(
      `No workspace changelog sections found for Atlas version ${version}. Was changeset version run?`
    );
  }

  const dateLine =
    packageSections.map((entry) => extractSectionDate(entry.section)).find(Boolean) ??
    new Date().toISOString().slice(0, 10);

  const rootChangelogPath = path.join(repoRoot, "CHANGELOG.md");
  const rootContent = readFileSync(rootChangelogPath, "utf8");
  const updatedRoot = updateRootChangelog(rootContent, version, packageSections, dateLine);
  writeFileSync(
    rootChangelogPath,
    updatedRoot.endsWith("\n") ? updatedRoot : `${updatedRoot}\n`,
    "utf8"
  );

  syncWorkspaceVersions(version, repoRoot);
  generateCurrentProductionReleaseSnapshot(repoRoot, { replace: true });
  refreshPublishedReleaseRecord(repoRoot, options);

  return { version, mergedBody: workspaceBody, dateLine };
}

const EXACT_RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function refreshPublishedReleaseRecord(repoRoot = process.cwd(), options = {}) {
  const recordPath = path.join(repoRoot, "packages/cli/release-assets/published-releases.json");
  if (!existsSync(recordPath)) {
    return { status: "skipped" };
  }

  const queried = options.publishedVersions ?? queryPublishedCliVersions(repoRoot);
  const versions = [
    ...new Set(queried.filter((version) => EXACT_RELEASE_VERSION.test(version))),
  ].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const current = JSON.parse(readFileSync(recordPath, "utf8"));
  writeFileSync(
    recordPath,
    `${JSON.stringify(
      {
        schemaVersion: current.schemaVersion ?? 1,
        packageName: "@blitzcraftlabs/atlas",
        versions,
      },
      null,
      2
    )}\n`
  );
  return { status: "updated", versions };
}

function queryPublishedCliVersions(repoRoot) {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(pnpm, ["view", "@blitzcraftlabs/atlas", "versions", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(
      `Could not refresh published @blitzcraftlabs/atlas versions from the configured registry.\n${result.stderr || result.stdout || "pnpm view failed"}`
    );
  }
  const parsed = JSON.parse(result.stdout);
  if (!Array.isArray(parsed)) {
    throw new Error("pnpm view versions did not return an array");
  }
  return parsed.filter((version) => typeof version === "string");
}

function main() {
  const result = consolidateAtlasRelease();
  console.log(
    `Consolidated Atlas ${result.version} into CHANGELOG.md and synced workspace versions`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
