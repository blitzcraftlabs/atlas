/**
 * Fail-closed Atlas GitHub Release publication decisions.
 *
 * Decision evaluation is pure given explicit inputs (including proven ancestry).
 * `isGitAncestor` is the Git primitive used by the CLI wrapper to prove that
 * an existing tag target is an ancestor of the current publication SHA.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { ATLAS_TAG_PATTERN, readRootVersion, readWorkspaceVersions } from "./atlas-workspaces.mjs";
import { extractChangelogSection } from "./extract-changelog-section.mjs";
import {
  isGithubPrerelease,
  isPreOnePointZero,
  isStablePublicRelease,
  parseSemver,
} from "./semver-utils.mjs";

/** Internal snapshot that must never receive a public tag or GitHub Release. */
export const HISTORICAL_UNPUBLISHED_VERSIONS = Object.freeze(["0.1.0"]);

export const REQUIRED_RELEASE_CHECK_WORKFLOWS = Object.freeze([
  "CI",
  "Security Audit",
  "UI Quality",
]);

/**
 * Fields requested from `gh run list --json`. `databaseId` is GitHub's
 * monotonically assigned workflow-run ID and is the primary ordering key.
 * `attempt` is the re-run counter for that same run.
 */
export const REQUIRED_WORKFLOW_RUN_JSON_FIELDS = Object.freeze([
  "name",
  "conclusion",
  "status",
  "headSha",
  "workflowName",
  "databaseId",
  "attempt",
  "createdAt",
  "updatedAt",
]);

const INCOMPLETE_WORKFLOW_STATUSES = new Set([
  "queued",
  "in_progress",
  "waiting",
  "requested",
  "pending",
]);

export const REQUIRED_RELEASE_ASSET_LICENSE = "LICENSE";

export class PublicationError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string }} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = "PublicationError";
    this.code = options.code ?? "INVALID_RELEASE_STATE";
  }
}

export function tagNameForVersion(version) {
  return `v${version}`;
}

export function sbomAssetNameForCommit(commitSha) {
  return `atlas-sbom-${commitSha}.spdx.json`;
}

/**
 * Canonical Release assets that must exist before publication is complete.
 * SBOM is mandatory; LICENSE is uploaded with every canonical Release.
 *
 * @param {string} commitSha
 * @returns {string[]}
 */
export function requiredReleaseAssetNames(commitSha) {
  return [sbomAssetNameForCommit(commitSha), REQUIRED_RELEASE_ASSET_LICENSE];
}

/**
 * @param {{ assets?: string[] } | null | undefined} release
 * @param {string} commitSha
 * @returns {string[]}
 */
export function missingRequiredReleaseAssets(release, commitSha) {
  const assets = new Set(release?.assets ?? []);
  return [sbomAssetNameForCommit(commitSha)].filter((name) => !assets.has(name));
}

/**
 * True when `ancestorSha` is an ancestor of `descendantSha`.
 * Uses `git merge-base --is-ancestor`. Unproven ancestry is false.
 *
 * @param {string} ancestorSha
 * @param {string} descendantSha
 * @param {{ repoRoot: string }} options
 * @returns {boolean}
 */
export function isGitAncestor(ancestorSha, descendantSha, options) {
  if (!ancestorSha || !descendantSha || !options?.repoRoot) {
    return false;
  }

  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestorSha, descendantSha], {
      cwd: options.repoRoot,
      encoding: "utf8",
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{ sha?: string | null, assets?: string[] } | null | undefined} release
 * @param {string} commitSha
 */
function isCompleteCanonicalRelease(release, commitSha) {
  if (!release || !commitSha || release.sha !== commitSha) {
    return false;
  }

  return missingRequiredReleaseAssets(release, commitSha).length === 0;
}

/**
 * Live side effects for a publication decision. Repair never creates a new tag.
 *
 * @param {"publish" | "repair-release" | "repair-assets" | "noop"} action
 */
export function publicationSideEffects(action) {
  return {
    createTag: action === "publish",
    createRelease: action === "publish" || action === "repair-release",
    uploadAssets: action === "publish" || action === "repair-release" || action === "repair-assets",
    clobberExactAssets: action === "repair-assets",
  };
}

/**
 * Normalize a `gh run list` row. Ordering uses `databaseId` then `runAttempt`,
 * never `gh run list` array position (GitHub does not document that order).
 *
 * @param {Record<string, unknown>} run
 */
export function normalizeWorkflowRun(run) {
  return {
    name: String(run.name ?? run.workflowName ?? ""),
    status: run.status ?? null,
    conclusion: run.conclusion ?? null,
    headSha: run.headSha ?? null,
    databaseId: Number(run.databaseId ?? run.database_id ?? 0),
    createdAt: run.createdAt ?? run.created_at ?? null,
    runAttempt: Number(run.runAttempt ?? run.attempt ?? 0),
    updatedAt: run.updatedAt ?? run.updated_at ?? null,
  };
}

/**
 * Compare two normalized runs. Later is greater.
 *
 * Rule: `databaseId` (monotonic GitHub workflow-run ID), then `runAttempt`
 * (re-run of that same run), then `createdAt` as a last resort.
 *
 * @param {ReturnType<typeof normalizeWorkflowRun>} left
 * @param {ReturnType<typeof normalizeWorkflowRun>} right
 */
export function compareWorkflowRunOrder(left, right) {
  if (left.databaseId !== right.databaseId) {
    return left.databaseId - right.databaseId;
  }
  if (left.runAttempt !== right.runAttempt) {
    return left.runAttempt - right.runAttempt;
  }
  const leftCreated = Date.parse(String(left.createdAt ?? "")) || 0;
  const rightCreated = Date.parse(String(right.createdAt ?? "")) || 0;
  return leftCreated - rightCreated;
}

export function selectLatestWorkflowRun(runs) {
  if (!runs || runs.length === 0) {
    return null;
  }
  return [...runs].sort(compareWorkflowRunOrder).at(-1) ?? null;
}

function isIncompleteWorkflowStatus(status) {
  return !status || status !== "completed" || INCOMPLETE_WORKFLOW_STATUSES.has(status);
}

/**
 * Evaluate required workflow runs for one exact commit.
 * `--commit <sha>` is the primary filter; `headSha` is a defense-in-depth check.
 *
 * For each required workflow, only the latest run/attempt on this SHA counts.
 * An older success does not mask a later failure; a later in-progress retry
 * stays pending even if an older run failed.
 *
 * @param {Array<Record<string, unknown>>} runs
 * @param {{ requiredWorkflows?: readonly string[], commitSha: string }} options
 * @returns {{ failed: Array<{ name: string, conclusion: string }>, pending: string[] }}
 */
export function evaluateRequiredReleaseChecks(runs, options) {
  const requiredWorkflows = [...(options.requiredWorkflows ?? REQUIRED_RELEASE_CHECK_WORKFLOWS)];
  const commitSha = options.commitSha;
  const relevant = (runs ?? [])
    .map((run) => normalizeWorkflowRun(run))
    .filter((run) => {
      if (!run.name || !requiredWorkflows.includes(run.name)) {
        return false;
      }
      if (run.headSha && run.headSha !== commitSha) {
        return false;
      }
      return true;
    });

  const failed = [];
  const pending = [];

  for (const name of requiredWorkflows) {
    const latest = selectLatestWorkflowRun(relevant.filter((run) => run.name === name));
    if (!latest || isIncompleteWorkflowStatus(latest.status)) {
      pending.push(name);
      continue;
    }

    if (latest.conclusion === "success") {
      continue;
    }

    failed.push({
      name,
      conclusion: latest.conclusion ?? "unknown",
    });
  }

  return { failed, pending };
}

export function isHistoricalUnpublishedVersion(version) {
  return HISTORICAL_UNPUBLISHED_VERSIONS.includes(version);
}

export function listPendingChangesetFiles(repoRoot = process.cwd()) {
  const directory = path.join(repoRoot, ".changeset");
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort();
}

/**
 * @param {{
 *   rootVersion: string,
 *   workspaceVersions: Array<{ name: string, version: string }>,
 *   changelog: string,
 *   proposedTag?: string | null,
 * }} input
 * @returns {string[]}
 */
export function collectVersionConsistencyErrors(input) {
  const errors = [];
  const { rootVersion, workspaceVersions, changelog, proposedTag } = input;

  if (!parseSemver(rootVersion)) {
    errors.push(`Invalid root/platform version "${rootVersion}"`);
    return errors;
  }

  for (const pkg of workspaceVersions) {
    if (pkg.version !== rootVersion) {
      errors.push(`Version mismatch: root is ${rootVersion}, ${pkg.name} is ${pkg.version}`);
    }
  }

  if (!extractChangelogSection(changelog, rootVersion)) {
    errors.push(`CHANGELOG.md has no section for current Atlas version ${rootVersion}`);
  }

  if (proposedTag) {
    if (!ATLAS_TAG_PATTERN.test(proposedTag)) {
      errors.push(`Invalid Atlas tag format "${proposedTag}" (expected vX.Y.Z)`);
    }
    if (proposedTag !== tagNameForVersion(rootVersion)) {
      errors.push(`Tag ${proposedTag} does not match package version ${rootVersion}`);
    }
  }

  return errors;
}

/**
 * @param {{
 *   rootVersion: string,
 *   workspaceVersions: Array<{ name: string, version: string }>,
 *   changelog: string,
 *   existingTags?: Array<{ name: string, sha?: string | null }>,
 *   existingReleases?: Array<{ tagName: string, sha?: string | null, assets?: string[] }>,
 *   proposedTag?: string | null,
 *   targetSha?: string | null,
 *   canonicalMainSha?: string | null,
 *   pendingChangesetFiles?: string[],
 *   isCommitAncestor?: (ancestorSha: string, descendantSha: string) => boolean,
 * }} input
 */
export function evaluatePublicationDecision(input) {
  const errors = collectVersionConsistencyErrors(input);
  if (errors.length > 0) {
    throw new PublicationError(errors.join("\n"), { code: "INVALID_RELEASE_STATE" });
  }

  const { rootVersion } = input;
  const tag = tagNameForVersion(rootVersion);
  const existingTags = input.existingTags ?? [];
  const existingReleases = input.existingReleases ?? [];
  const existingTag = existingTags.find((entry) => entry.name === tag);
  const existingRelease = existingReleases.find((entry) => entry.tagName === tag);
  const pendingChangesetFiles = input.pendingChangesetFiles ?? [];

  if (isHistoricalUnpublishedVersion(rootVersion)) {
    return {
      action: "noop",
      version: rootVersion,
      tag,
      prerelease: isGithubPrerelease(rootVersion),
      reason: `${rootVersion} is a historical internal snapshot and must not receive a public tag or GitHub Release`,
    };
  }

  if (pendingChangesetFiles.length > 0) {
    throw new PublicationError(
      `Cannot publish ${tag} while pending changesets remain:\n${pendingChangesetFiles
        .map((name) => `- ${name}`)
        .join("\n")}`,
      { code: "PENDING_CHANGESETS" }
    );
  }

  if (input.targetSha && input.canonicalMainSha && input.targetSha !== input.canonicalMainSha) {
    throw new PublicationError(
      `Target SHA ${input.targetSha} is not the current canonical main (${input.canonicalMainSha})`,
      { code: "STALE_SHA" }
    );
  }

  if (existingTag?.sha && input.targetSha && existingTag.sha !== input.targetSha) {
    const tagIsAncestorOfTarget =
      input.isCommitAncestor?.(existingTag.sha, input.targetSha) === true;
    if (tagIsAncestorOfTarget && isCompleteCanonicalRelease(existingRelease, existingTag.sha)) {
      return {
        action: "noop",
        version: rootVersion,
        tag,
        prerelease: isGithubPrerelease(rootVersion),
        reason: `Atlas ${rootVersion} is already published; current main contains post-release commits.`,
      };
    }

    throw new PublicationError(
      `Tag ${tag} already exists at ${existingTag.sha}; refusing to retag ${input.targetSha}`,
      { code: "TAG_EXISTS" }
    );
  }

  if (existingRelease?.sha && input.targetSha && existingRelease.sha !== input.targetSha) {
    throw new PublicationError(
      `GitHub Release ${tag} already exists for ${existingRelease.sha}; refusing to recreate for ${input.targetSha}`,
      { code: "RELEASE_EXISTS" }
    );
  }

  if (!existingTag && existingRelease) {
    throw new PublicationError(`GitHub Release ${tag} exists without a matching git tag`, {
      code: "RELEASE_WITHOUT_TAG",
    });
  }

  if (existingTag && existingRelease) {
    const missingAssets = missingRequiredReleaseAssets(existingRelease, input.targetSha ?? "");
    if (missingAssets.length > 0) {
      return {
        action: "repair-assets",
        version: rootVersion,
        tag,
        prerelease: isGithubPrerelease(rootVersion),
        missingAssets,
        reason: `GitHub Release ${tag} exists at the release commit but is missing required assets: ${missingAssets.join(", ")}`,
      };
    }

    return {
      action: "noop",
      version: rootVersion,
      tag,
      prerelease: isGithubPrerelease(rootVersion),
      reason: `Tag ${tag} and GitHub Release already exist with required assets for this version`,
    };
  }

  if (existingTag && !existingRelease) {
    return {
      action: "repair-release",
      version: rootVersion,
      tag,
      prerelease: isGithubPrerelease(rootVersion),
      reason: `Tag ${tag} exists at the release commit; creating the missing GitHub Release`,
    };
  }

  return {
    action: "publish",
    version: rootVersion,
    tag,
    prerelease: isGithubPrerelease(rootVersion),
    reason: `Canonical public release ${tag} does not exist yet`,
  };
}

/**
 * Re-evaluate publication against freshly loaded GitHub state for a fixed
 * target SHA. Call this immediately before mutation; do not reuse a decision
 * computed before the required-check wait.
 *
 * @param {{
 *   inputs: ReturnType<typeof readPublicationInputs>,
 *   githubState: {
 *     existingTags?: Array<{ name: string, sha?: string | null }>,
 *     existingReleases?: Array<{ tagName: string, sha?: string | null, assets?: string[] }>,
 *     canonicalMainSha?: string | null,
 *   },
 *   targetSha: string,
 *   isCommitAncestor?: (ancestorSha: string, descendantSha: string) => boolean,
 * }} options
 */
export function evaluateCurrentPublicationState(options) {
  const { inputs, githubState, targetSha, isCommitAncestor } = options;
  if (!targetSha) {
    throw new PublicationError("Missing target SHA for publication", { code: "MISSING_SHA" });
  }

  const decision = evaluatePublicationDecision({
    ...inputs,
    proposedTag: tagNameForVersion(inputs.rootVersion),
    existingTags: githubState.existingTags,
    existingReleases: githubState.existingReleases,
    targetSha,
    canonicalMainSha: githubState.canonicalMainSha ?? targetSha,
    isCommitAncestor,
  });

  return {
    decision,
    inputs,
    githubState,
    targetSha,
  };
}

/**
 * @param {string} version
 */
function describeReleaseLine(version) {
  if (version === "1.0.0") {
    return [
      "Atlas 1.0.0 is the first supported public distribution.",
      "The 0.x GitHub releases were the platform-development/proving line; they are not the public npm contract.",
      "Public CLI, generated-project, upgrade, and distribution contracts are now treated as stable.",
      "Breaking public-contract changes after 1.0 require a major version. Internal implementation may still evolve.",
    ].join(" ");
  }

  if (isStablePublicRelease(version)) {
    return `Atlas ${version} is a stable public-contract release. Breaking public CLI, project, upgrade, or distribution contracts requires a major version.`;
  }

  return `Atlas ${version} is a pre-1.0 repository/platform snapshot release.`;
}

/**
 * @param {string} version
 */
function describeSupportLimitations(version) {
  const lines = [
    "- Supported line: current Atlas release plus the immediately previous supported production release.",
    "- No LTS programme at this stage.",
    "- Internal `@atlas/*` workspace packages remain `private` and are **not** published to npm.",
    "- `@blitzcraftlabs/atlas` is the public npm package identity. npm distribution occurs after the canonical GitHub Release; registry availability is verified separately. The first npm publication was a human-authenticated publish of `@blitzcraftlabs/atlas@1.0.1` from canonical `v1.0.1`. Later releases use GitHub Actions OIDC / npm Trusted Publishing (`release.yml`).",
    "- This GitHub Release does **not** include signed provenance, SLSA attestation, or a formal security audit. npm Trusted Publishing attaches npm provenance to later `@blitzcraftlabs/atlas` publishes; that is not a GitHub Release attestation and is not SLSA.",
  ];

  if (isPreOnePointZero(version)) {
    lines.push(
      "- Pre-1.0 APIs, templates, and upgrade mechanics may still evolve; breaking changes use a **minor** bump."
    );
  } else {
    lines.push(
      "- After 1.0, breaking public-contract changes use a **major** bump. Compatible features use minor; fixes use patch."
    );
  }

  return lines.join("\n");
}

/**
 * @param {string} changelog
 * @param {string} version
 * @param {{
 *   commitSha?: string,
 *   sbomFileName?: string,
 *   firstCanonicalPublicRelease?: boolean,
 * }} [options]
 */
export function buildCanonicalReleaseNotes(changelog, version, options = {}) {
  const section = extractChangelogSection(changelog, version);
  if (!section) {
    throw new PublicationError(
      `No changelog section found for Atlas version ${version} in CHANGELOG.md`,
      { code: "CHANGELOG_MISSING" }
    );
  }

  const firstPublic = options.firstCanonicalPublicRelease === true;
  const summary = firstPublic
    ? [
        "`0.1.0` was a historical internal snapshot. No public `v0.1.0` tag or GitHub Release was published.",
        `**${version} is the first canonical public GitHub Release.** ${describeReleaseLine(version)}`,
      ].join("\n")
    : describeReleaseLine(version);

  const preamble = [
    `# Atlas ${version}`,
    "",
    summary,
    "",
    "## Changes",
    "",
    section,
    "",
    "## Release identity",
    "",
    `- Tag: \`${tagNameForVersion(version)}\``,
    options.commitSha ? `- Commit: \`${options.commitSha}\`` : null,
    "- Product: Atlas repository/platform snapshot (not independent npm packages)",
    options.sbomFileName
      ? `- SBOM: \`${options.sbomFileName}\` (SPDX 2.3 snapshot of \`pnpm-lock.yaml\`)`
      : null,
    "",
    "## Support and limitations",
    "",
    describeSupportLimitations(version),
    "",
    "License: Apache-2.0. See `LICENSE` and `docs/how-we-build/releases-and-governance.md`.",
  ]
    .filter((line) => line !== null)
    .join("\n");

  return `${preamble}\n`;
}

export function isFirstCanonicalPublicRelease({ existingTags = [], existingReleases = [] } = {}) {
  const publicTags = existingTags.filter(
    (entry) => ATLAS_TAG_PATTERN.test(entry.name) && entry.name !== tagNameForVersion("0.1.0")
  );
  return publicTags.length === 0 && existingReleases.length === 0;
}

export function readPublicationInputs(repoRoot = process.cwd()) {
  return {
    rootVersion: readRootVersion(repoRoot),
    workspaceVersions: readWorkspaceVersions(repoRoot),
    changelog: readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8"),
    pendingChangesetFiles: listPendingChangesetFiles(repoRoot),
  };
}
