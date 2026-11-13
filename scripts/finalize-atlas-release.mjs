#!/usr/bin/env node
/**
 * Make a draft Atlas GitHub Release public once its npm version exists.
 *
 * Release order: canonical tag → draft GitHub Release → npm publish (packed from the tag)
 * → registry verification → this script. A Release therefore never becomes public for a
 * version that is missing from npm. Idempotent: an already-public Release is a no-op.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { evaluateFinalizeDecision } from "./lib/release-consistency.mjs";
import { readGithubReleaseState, readNpmVersions, runGh } from "./lib/release-github-state.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

function parseArgs(argv) {
  const options = {
    version: null,
    ownerRepo: process.env.GITHUB_REPOSITORY ?? "blitzcraftlabs/atlas",
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--version") options.version = argv[++index];
    else if (arg === "--owner-repo") options.ownerRepo = argv[++index];
    else if (arg === "--dry-run") options.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  options.version ??= JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
  return options;
}

export function main(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgs(argv);
  const readState = deps.readGithubReleaseState ?? readGithubReleaseState;
  const readNpm = deps.readNpmVersions ?? readNpmVersions;
  const gh = deps.runGh ?? runGh;

  const tag = `v${options.version}`;
  const { releases } = readState(options.ownerRepo);
  const release = releases.find((entry) => entry.tagName === tag) ?? null;
  const decision = evaluateFinalizeDecision({
    version: options.version,
    npmVersions: readNpm(),
    release,
  });
  process.stdout.write(`Finalize decision: ${decision.action}\n  Reason: ${decision.reason}\n`);
  if (decision.action === "noop" || options.dryRun) return decision;

  const args = ["release", "edit", tag, "--repo", options.ownerRepo, "--draft=false"];
  args.push(decision.latest ? "--latest" : "--latest=false");
  gh(args);
  process.stdout.write(`✓ GitHub Release ${tag} is public\n`);
  return decision;
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(scriptPath).href
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
