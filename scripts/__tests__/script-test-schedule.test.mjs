import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  runIsolatedScriptTestsSequentially,
  runScriptTestBatch,
} from "../lib/script-test-execution.mjs";
import {
  discoverScriptTestFileNames,
  ISOLATED_AFTER_PARALLEL_SCRIPT_TESTS,
  partitionScriptTests,
  REPO_ROOT,
} from "../lib/script-test-schedule.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("script test schedule", () => {
  it("partitions every discovered test file without overlap", () => {
    const all = discoverScriptTestFileNames();
    const { parallelTests, isolatedAfterParallelTests } = partitionScriptTests(all);

    assert.ok(all.length > 0);
    assert.equal(parallelTests.length + isolatedAfterParallelTests.length, all.length);

    const union = new Set([...parallelTests, ...isolatedAfterParallelTests]);
    assert.equal(union.size, all.length);
    for (const name of all) {
      assert.equal(union.has(name), true, `missing partition for ${name}`);
    }
  });

  it("keeps shared-build-output integration tests out of the parallel batch", () => {
    assert.deepEqual(ISOLATED_AFTER_PARALLEL_SCRIPT_TESTS, [
      "cli-workspace-build.test.mjs",
      "consolidate-production-snapshot-refresh.test.mjs",
      "npm-publication-catalog.test.mjs",
      "cli-turbo-build-cache.test.mjs",
    ]);

    const { parallelTests, isolatedAfterParallelTests } = partitionScriptTests(
      discoverScriptTestFileNames(),
    );

    assert.deepEqual(isolatedAfterParallelTests, [...ISOLATED_AFTER_PARALLEL_SCRIPT_TESTS]);
    assert.equal(isolatedAfterParallelTests.at(-1), "cli-turbo-build-cache.test.mjs");
    for (const isolatedName of ISOLATED_AFTER_PARALLEL_SCRIPT_TESTS) {
      assert.equal(parallelTests.includes(isolatedName), false, `${isolatedName} must be isolated`);
    }
    assert.equal(parallelTests.includes("validate-dependencies.test.mjs"), true);
    assert.equal(isolatedAfterParallelTests.includes("validate-dependencies.test.mjs"), false);
  });

  it("runs isolated script tests one file per node --test invocation", () => {
    const calls = [];
    const status = runIsolatedScriptTestsSequentially(
      "/repo",
      ["first.test.mjs", "second.test.mjs"],
      (repoRoot, fileNames, extraArgs) => {
        calls.push({ repoRoot, fileNames, extraArgs });
        return 0;
      },
      ["--flag"],
    );

    assert.equal(status, 0);
    assert.deepEqual(calls, [
      { repoRoot: "/repo", fileNames: ["first.test.mjs"], extraArgs: ["--flag"] },
      { repoRoot: "/repo", fileNames: ["second.test.mjs"], extraArgs: ["--flag"] },
    ]);
  });

  it("stops sequential isolated execution on the first failing file", () => {
    const calls = [];
    const status = runIsolatedScriptTestsSequentially(
      "/repo",
      ["ok.test.mjs", "fail.test.mjs", "skipped.test.mjs"],
      (_repoRoot, fileNames) => {
        calls.push(fileNames[0]);
        return fileNames[0] === "fail.test.mjs" ? 1 : 0;
      },
    );

    assert.equal(status, 1);
    assert.deepEqual(calls, ["ok.test.mjs", "fail.test.mjs"]);
  });

  it("is the single source of truth for script test runners", () => {
    const scheduleImport = /script-test-schedule\.mjs/;
    const executionImport = /script-test-execution\.mjs/;
    const runners = ["scripts/run-script-tests.mjs", "scripts/collect-scripts-coverage.mjs"];

    for (const relativePath of runners) {
      const source = readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
      assert.match(source, scheduleImport, `${relativePath} must import script-test-schedule.mjs`);
      assert.match(
        source,
        executionImport,
        `${relativePath} must import script-test-execution.mjs`,
      );
      assert.match(
        source,
        /runIsolatedScriptTestsSequentially/,
        `${relativePath} must run isolated tests sequentially`,
      );
      assert.doesNotMatch(
        source,
        /readdirSync\([\s\S]*__tests__/,
        `${relativePath} must not rediscover tests independently`,
      );
    }
  });

  it("runs parallel batches through a single node --test invocation", () => {
    assert.equal(typeof runScriptTestBatch, "function");
    const source = readFileSync(path.join(REPO_ROOT, "scripts/run-script-tests.mjs"), "utf8");
    assert.match(source, /runScriptTestBatch\(repoRoot, parallelTests\)/);
    assert.doesNotMatch(
      source,
      /runScriptTestBatch\(repoRoot, isolatedAfterParallelTests/,
      "isolated tests must not share one concurrent node --test batch",
    );
  });
});
