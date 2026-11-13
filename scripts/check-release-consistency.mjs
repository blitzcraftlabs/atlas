#!/usr/bin/env node
/**
 * Fails when a public GitHub Release has no npm version, or an npm version has no
 * canonical tag. Drafts awaiting npm and orphan tags are reported as warnings.
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { evaluateReleaseConsistency } from "./lib/release-consistency.mjs";
import { readGithubReleaseState, readNpmVersions } from "./lib/release-github-state.mjs";

const scriptPath = fileURLToPath(import.meta.url);

export function main(argv = process.argv.slice(2), deps = {}) {
  const ownerRepoIndex = argv.indexOf("--owner-repo");
  const ownerRepo =
    ownerRepoIndex >= 0
      ? argv[ownerRepoIndex + 1]
      : (process.env.GITHUB_REPOSITORY ?? "blitzcraftlabs/atlas");
  const { tags, releases } = (deps.readGithubReleaseState ?? readGithubReleaseState)(ownerRepo);
  const npmVersions = (deps.readNpmVersions ?? readNpmVersions)();
  const result = evaluateReleaseConsistency({ tags, releases, npmVersions });

  for (const warning of result.warnings) process.stdout.write(`⚠ ${warning}\n`);
  for (const error of result.errors) process.stderr.write(`✗ ${error}\n`);
  if (result.errors.length === 0) {
    process.stdout.write(
      `✓ GitHub Releases and npm are consistent (${npmVersions.length} npm versions)\n`
    );
  }
  return result;
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(scriptPath).href
) {
  try {
    const result = main();
    if (result.errors.length > 0) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
