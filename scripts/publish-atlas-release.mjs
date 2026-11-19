#!/usr/bin/env node
/**
 * Apply a fail-closed Atlas GitHub Release publication decision.
 *
 * Dry-run (default for rehearsal) verifies version, changelog, tag name, SBOM,
 * and release notes without creating a Git tag or GitHub Release.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { generateSpdxSbom } from "./generate-sbom.mjs";
import { appendGithubOutput } from "./lib/npm-publication.mjs";
import { githubReleaseCreateArgs } from "./lib/release-consistency.mjs";
import {
  PublicationError,
  REQUIRED_RELEASE_CHECK_WORKFLOWS,
  REQUIRED_WORKFLOW_RUN_JSON_FIELDS,
  buildCanonicalReleaseNotes,
  evaluateCurrentPublicationState,
  evaluateRequiredReleaseChecks,
  isFirstCanonicalPublicRelease,
  isGitAncestor,
  publicationSideEffects,
  readPublicationInputs,
  sbomAssetNameForCommit,
} from "./release-publication.mjs";

export function parseArgs(argv, env = process.env) {
  const options = {
    dryRun: false,
    skipGithub: false,
    skipChecks: false,
    repoRoot: process.cwd(),
    stateFile: null,
    outputDir: null,
    ownerRepo: env.GITHUB_REPOSITORY ?? "blitzcraftlabs/atlas",
    targetSha: env.GITHUB_SHA ?? null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--skip-github") {
      options.skipGithub = true;
    } else if (arg === "--skip-checks") {
      options.skipChecks = true;
    } else if (arg === "--repo-root") {
      options.repoRoot = argv[index + 1];
      index += 1;
    } else if (arg === "--state-file") {
      options.stateFile = argv[index + 1];
      index += 1;
    } else if (arg === "--output-dir") {
      options.outputDir = argv[index + 1];
      index += 1;
    } else if (arg === "--owner-repo") {
      options.ownerRepo = argv[index + 1];
      index += 1;
    } else if (arg === "--target-sha") {
      options.targetSha = argv[index + 1];
      index += 1;
    }
  }

  return options;
}

function runGh(args, options) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    cwd: options.repoRoot,
    env: process.env,
  }).trim();
}

function runGit(args, options) {
  return execFileSync("git", args, {
    encoding: "utf8",
    cwd: options.repoRoot,
    env: process.env,
  }).trim();
}

function sleepMs(ms) {
  execFileSync("sleep", [String(Math.ceil(ms / 1000))], { stdio: "ignore" });
}

export function loadGithubState(options, { gh = runGh } = {}) {
  if (options.stateFile) {
    return JSON.parse(readFileSync(options.stateFile, "utf8"));
  }

  if (options.skipGithub) {
    return {
      existingTags: [],
      existingReleases: [],
      canonicalMainSha: options.targetSha,
    };
  }

  const [owner, repo] = options.ownerRepo.split("/");
  const tagsJson = gh(["api", `repos/${owner}/${repo}/tags`, "--paginate"], options);
  const releasesJson = gh(["api", `repos/${owner}/${repo}/releases`, "--paginate"], options);
  const mainJson = gh(["api", `repos/${owner}/${repo}/commits/main`], options);

  const tags = JSON.parse(tagsJson || "[]");
  const releases = JSON.parse(releasesJson || "[]");
  const main = JSON.parse(mainJson);
  const existingTags = tags.map((tag) => ({
    name: tag.name,
    sha: tag.commit?.sha ?? null,
  }));

  return {
    existingTags,
    existingReleases: releases.map((release) => ({
      tagName: release.tag_name,
      draft: release.draft === true,
      sha: resolveReleaseSha(release, existingTags),
      assets: (release.assets ?? []).map((asset) => asset.name).filter(Boolean),
    })),
    canonicalMainSha: main.sha,
  };
}

function isGitCommitSha(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
}

function resolveReleaseSha(release, existingTags) {
  const target = release.target_commitish ?? null;
  if (isGitCommitSha(target)) {
    return target;
  }

  const matchingTag = existingTags.find((entry) => entry.name === release.tag_name);
  return matchingTag?.sha ?? null;
}

function writeSbom(repoRoot, commitSha, outputDir) {
  const sbom = generateSpdxSbom({ root: repoRoot, commitSha });
  const fileName = sbomAssetNameForCommit(commitSha);
  const filePath = path.join(outputDir, fileName);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(sbom, null, 2)}\n`);
  return { fileName, filePath, packageCount: sbom.packages.length };
}

export function waitForRequiredChecks(
  options,
  sha,
  {
    gh = runGh,
    sleep = sleepMs,
    now = Date.now,
    env = process.env,
    write = (text) => process.stdout.write(text),
  } = {}
) {
  const timeoutMs = Number(env.ATLAS_RELEASE_CHECK_TIMEOUT_MS ?? 25 * 60 * 1000);
  const pollMs = Number(env.ATLAS_RELEASE_CHECK_POLL_MS ?? 30_000);
  const started = now();
  const required = new Set(REQUIRED_RELEASE_CHECK_WORKFLOWS);
  // JSON fields include databaseId and attempt so the evaluator can order runs.

  while (now() - started < timeoutMs) {
    const raw = gh(
      [
        "run",
        "list",
        "--repo",
        options.ownerRepo,
        "--commit",
        sha,
        "--json",
        REQUIRED_WORKFLOW_RUN_JSON_FIELDS.join(","),
      ],
      options
    );
    const runs = JSON.parse(raw || "[]");
    const { failed, pending } = evaluateRequiredReleaseChecks(runs, {
      requiredWorkflows: [...required],
      commitSha: sha,
    });
    if (failed.length > 0) {
      throw new PublicationError(
        `Required checks failed: ${failed.map((run) => `${run.name}=${run.conclusion}`).join(", ")}`,
        { code: "CHECKS_FAILED" }
      );
    }

    if (pending.length === 0) {
      return;
    }

    write(`Waiting for required checks: ${pending.join(", ")}\n`);
    sleep(pollMs);
  }

  throw new PublicationError(`Timed out waiting for required checks: ${[...required].join(", ")}`, {
    code: "CHECKS_TIMEOUT",
  });
}

export function createGitTag(options, tag, sha, git = runGit) {
  git(
    [
      "-c",
      "user.name=github-actions[bot]",
      "-c",
      "user.email=41898282+github-actions[bot]@users.noreply.github.com",
      "tag",
      "-a",
      tag,
      sha,
      "-m",
      `Atlas ${tag.slice(1)}`,
    ],
    options
  );
  git(["push", "origin", tag], options);
}

function uploadCanonicalReleaseAssets(options, tag, sbomPath, { clobber, gh = runGh }) {
  const sbomArgs = ["release", "upload", tag, sbomPath, "--repo", options.ownerRepo];
  if (clobber) {
    sbomArgs.push("--clobber");
  }
  gh(sbomArgs, options);

  const licensePath = path.join(options.repoRoot, "LICENSE");
  if (existsSync(licensePath)) {
    const licenseArgs = ["release", "upload", tag, licensePath, "--repo", options.ownerRepo];
    if (clobber) {
      licenseArgs.push("--clobber");
    }
    gh(licenseArgs, options);
  }
}

function createGithubRelease(options, decision, notesPath, sbomPath, gh = runGh) {
  // Draft until npm publication is verified; finalize-atlas-release.mjs makes it public.
  gh(
    githubReleaseCreateArgs(decision, {
      ownerRepo: options.ownerRepo,
      targetSha: options.targetSha,
      notesPath,
    }),
    options
  );
  uploadCanonicalReleaseAssets(options, decision.tag, sbomPath, { clobber: false, gh });
}

function resolvePublicationState(options, targetSha, loadState, dependencies = {}) {
  const inputs = readPublicationInputs(options.repoRoot);
  const githubState = loadState(options);
  const resolvedSha = targetSha ?? options.targetSha ?? githubState.canonicalMainSha;
  const isCommitAncestor =
    dependencies.isCommitAncestor ??
    ((ancestorSha, descendantSha) =>
      isGitAncestor(ancestorSha, descendantSha, { repoRoot: options.repoRoot }));
  return evaluateCurrentPublicationState({
    inputs,
    githubState,
    targetSha: resolvedSha,
    isCommitAncestor,
  });
}

export function preparePublication(options, dependencies = {}) {
  const loadState = dependencies.loadGithubState ?? loadGithubState;
  const evaluated = resolvePublicationState(options, options.targetSha, loadState, dependencies);
  const { decision, inputs, githubState, targetSha } = evaluated;

  const outputDir = options.outputDir ?? path.join(options.repoRoot, "artifacts");
  const sbom = writeSbom(options.repoRoot, targetSha, outputDir);
  const notes = buildCanonicalReleaseNotes(inputs.changelog, inputs.rootVersion, {
    commitSha: targetSha,
    sbomFileName: sbom.fileName,
    firstCanonicalPublicRelease: isFirstCanonicalPublicRelease(githubState),
  });
  const notesPath = path.join(outputDir, `atlas-release-notes-${inputs.rootVersion}.md`);
  writeFileSync(notesPath, notes);

  return {
    decision,
    inputs,
    githubState,
    targetSha,
    sbom,
    notesPath,
    notes,
  };
}

export function writePublicationGithubOutputs(decision, options = {}) {
  appendGithubOutput("action", decision.action, options);
  appendGithubOutput("version", decision.version, options);
  appendGithubOutput("tag", decision.tag, options);
}

function finalizePublication(prepared, options = {}) {
  writePublicationGithubOutputs(prepared.decision, options);
  return prepared;
}

function writeDecision(prepared, options) {
  const { decision, targetSha, sbom, notesPath } = prepared;
  process.stdout.write(
    [
      `Release decision: ${decision.action}`,
      `  Version: ${decision.version}`,
      `  Tag: ${decision.tag}`,
      `  SHA: ${targetSha}`,
      `  Reason: ${decision.reason}`,
      `  SBOM: ${sbom.filePath} (${sbom.packageCount} packages)`,
      `  Notes: ${notesPath}`,
      options.dryRun
        ? "  Mode: dry-run (no tag or GitHub Release will be created)"
        : "  Mode: live",
      "",
    ].join("\n")
  );
}

export function applyPublication(
  options,
  prepared,
  { gh = runGh, git = runGit, write = (text) => process.stdout.write(text) } = {}
) {
  const { decision, targetSha, sbom, notesPath } = prepared;
  const effects = publicationSideEffects(decision.action);
  if (effects.createTag) {
    createGitTag(options, decision.tag, targetSha, git);
  }
  if (effects.createRelease) {
    createGithubRelease(options, decision, notesPath, sbom.filePath, gh);
  } else if (effects.uploadAssets) {
    uploadCanonicalReleaseAssets(options, decision.tag, sbom.filePath, {
      clobber: effects.clobberExactAssets,
      gh,
    });
  }
  write(`✓ Published ${decision.tag}\n`);
}

/**
 * Live publication. After required checks succeed, GitHub state is reloaded
 * and the original target SHA is re-evaluated. Mutation uses only that fresh
 * decision. Workflow concurrency (`cancel-in-progress`) is not a substitute.
 */
export function runPublication(options, dependencies = {}) {
  const loadState = dependencies.loadGithubState ?? loadGithubState;
  const wait = dependencies.waitForRequiredChecks ?? waitForRequiredChecks;
  const apply = dependencies.applyPublication ?? applyPublication;

  const prepared = preparePublication(options, dependencies);
  writeDecision(prepared, options);

  if (prepared.decision.action === "noop") {
    process.stdout.write("✓ No publication required\n");
    return finalizePublication(prepared, options);
  }

  if (options.dryRun) {
    process.stdout.write("✓ Publication prerequisites satisfied (dry-run)\n");
    return finalizePublication(prepared, options);
  }

  if (!options.skipChecks) {
    wait(options, prepared.targetSha);
  }

  const fresh = resolvePublicationState(options, prepared.targetSha, loadState, dependencies);
  if (fresh.decision.action !== prepared.decision.action) {
    process.stdout.write(
      `Release decision after revalidation: ${fresh.decision.action}\n  Reason: ${fresh.decision.reason}\n`
    );
  }

  if (fresh.decision.action === "noop") {
    process.stdout.write("✓ No publication required\n");
    return finalizePublication(
      { ...prepared, decision: fresh.decision, githubState: fresh.githubState },
      options
    );
  }

  const toApply = {
    ...prepared,
    decision: fresh.decision,
    githubState: fresh.githubState,
  };
  apply(options, toApply);
  return finalizePublication(toApply, options);
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  try {
    runPublication(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Publication failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
