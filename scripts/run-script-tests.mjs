import path from "node:path";
import { fileURLToPath } from "node:url";

import { isolateFromAmbientGitRepository } from "./lib/git-env-isolation.mjs";
import {
  runIsolatedScriptTestsSequentially,
  runScriptTestBatch,
} from "./lib/script-test-execution.mjs";
import { discoverScriptTestFileNames, partitionScriptTests } from "./lib/script-test-schedule.mjs";

// Git hooks export GIT_DIR; fixture repos created by script tests must not inherit it.
isolateFromAmbientGitRepository();

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const allTests = discoverScriptTestFileNames();
const { parallelTests, isolatedAfterParallelTests } = partitionScriptTests(allTests);

const parallelStatus = runScriptTestBatch(repoRoot, parallelTests);
if (parallelStatus !== 0) {
  process.exit(parallelStatus);
}

process.exit(runIsolatedScriptTestsSequentially(repoRoot, isolatedAfterParallelTests));
