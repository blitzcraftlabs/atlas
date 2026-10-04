import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(moduleDir, "../..");

/**
 * Integration tests that mutate shared workspace build outputs (`packages/cli`,
 * `packages/project`, etc.). Each runs in its own post-parallel `node --test`
 * process (see `script-test-execution.mjs`) so they never race each other or
 * `validate-dependencies.test.mjs`, which also runs `turbo build` for the CLI.
 */
export const ISOLATED_AFTER_PARALLEL_SCRIPT_TESTS = Object.freeze([
  "cli-workspace-build.test.mjs",
  "consolidate-production-snapshot-refresh.test.mjs",
  "npm-publication-catalog.test.mjs",
  "version-pr-prospective-release-state.test.mjs",
  "cli-turbo-build-cache.test.mjs",
]);

export function scriptsTestDirectory(root = REPO_ROOT) {
  return path.join(root, "scripts", "__tests__");
}

/** @returns {string[]} basenames under `scripts/__tests__`, sorted. */
export function discoverScriptTestFileNames(testDir = scriptsTestDirectory()) {
  return readdirSync(testDir)
    .filter((name) => name.endsWith(".test.mjs"))
    .sort((a, b) => a.localeCompare(b));
}

/** Repo-relative path passed to `node --test`. */
export function scriptTestRelativePath(fileName) {
  return path.join("scripts", "__tests__", fileName);
}

/**
 * @param {string[]} fileNames from {@link discoverScriptTestFileNames}
 * @returns {{ parallelTests: string[], isolatedAfterParallelTests: string[] }}
 */
export function partitionScriptTests(fileNames) {
  const isolatedSet = new Set(ISOLATED_AFTER_PARALLEL_SCRIPT_TESTS);
  const parallelTests = fileNames.filter((name) => !isolatedSet.has(name));
  const isolatedAfterParallelTests = ISOLATED_AFTER_PARALLEL_SCRIPT_TESTS.filter((name) =>
    fileNames.includes(name),
  );

  assertCompletePartition(fileNames, parallelTests, isolatedAfterParallelTests);

  return { parallelTests, isolatedAfterParallelTests };
}

function assertCompletePartition(all, parallelTests, isolatedAfterParallelTests) {
  const combined = [...parallelTests, ...isolatedAfterParallelTests];
  if (combined.length !== all.length) {
    throw new Error(
      `script test partition dropped files: expected ${all.length}, got ${combined.length}`,
    );
  }

  const seen = new Set(combined);
  if (seen.size !== all.length) {
    throw new Error("script test partition assigned overlapping file names");
  }

  for (const name of all) {
    if (!seen.has(name)) {
      throw new Error(`script test partition missing ${name}`);
    }
  }
}
