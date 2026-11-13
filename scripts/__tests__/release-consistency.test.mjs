import assert from "node:assert/strict";
import test from "node:test";

import { main as checkMain } from "../check-release-consistency.mjs";
import { main as finalizeMain } from "../finalize-atlas-release.mjs";
import {
  evaluateFinalizeDecision,
  evaluateReleaseConsistency,
  githubReleaseCreateArgs,
  KNOWN_GITHUB_ONLY_VERSIONS,
} from "../lib/release-consistency.mjs";

const NPM = ["1.0.1", "1.1.0", "1.2.0", "1.3.1", "1.3.3"];

test("new GitHub Releases are always created as drafts", () => {
  const args = githubReleaseCreateArgs(
    { tag: "v1.4.0", version: "1.4.0", prerelease: false },
    { ownerRepo: "o/r", targetSha: "a".repeat(40), notesPath: "notes.md" }
  );
  assert.ok(args.includes("--draft"));
  assert.ok(!args.includes("--prerelease"));
  const pre = githubReleaseCreateArgs(
    { tag: "v2.0.0-rc.1", version: "2.0.0-rc.1", prerelease: true },
    { ownerRepo: "o/r", targetSha: "a".repeat(40), notesPath: "notes.md" }
  );
  assert.ok(pre.includes("--draft") && pre.includes("--prerelease"));
});

test("finalize refuses when npm does not have the version", () => {
  assert.throws(
    () =>
      evaluateFinalizeDecision({
        version: "1.4.0",
        npmVersions: NPM,
        release: { tagName: "v1.4.0", draft: true },
      }),
    /not on npm/
  );
});

test("finalize refuses when the Release does not exist", () => {
  assert.throws(
    () => evaluateFinalizeDecision({ version: "1.3.3", npmVersions: NPM, release: null }),
    /does not exist/
  );
});

test("finalize publishes a draft and marks the highest stable release latest", () => {
  const decision = evaluateFinalizeDecision({
    version: "1.4.0",
    npmVersions: [...NPM, "1.4.0"],
    release: { tagName: "v1.4.0", draft: true },
  });
  assert.equal(decision.action, "finalize");
  assert.equal(decision.latest, true);
});

test("finalize of a backport does not steal latest", () => {
  const decision = evaluateFinalizeDecision({
    version: "1.3.1",
    npmVersions: NPM,
    release: { tagName: "v1.3.1", draft: true },
  });
  assert.equal(decision.latest, false);
});

test("finalize is a no-op for an already public Release", () => {
  const decision = evaluateFinalizeDecision({
    version: "1.3.3",
    npmVersions: NPM,
    release: { tagName: "v1.3.3", draft: false },
  });
  assert.equal(decision.action, "noop");
});

test("finalize main edits the Release only for a finalize decision", () => {
  const calls = [];
  const deps = {
    readGithubReleaseState: () => ({ tags: [], releases: [{ tagName: "v1.4.0", draft: true }] }),
    readNpmVersions: () => [...NPM, "1.4.0"],
    runGh: (args) => calls.push(args),
  };
  finalizeMain(["--version", "1.4.0", "--owner-repo", "o/r"], deps);
  assert.deepEqual(calls, [
    ["release", "edit", "v1.4.0", "--repo", "o/r", "--draft=false", "--latest"],
  ]);
  calls.length = 0;
  finalizeMain(["--version", "1.4.0", "--owner-repo", "o/r", "--dry-run"], deps);
  assert.deepEqual(calls, []);
});

test("consistency passes for the historical GitHub-only set", () => {
  const tags = [...KNOWN_GITHUB_ONLY_VERSIONS, ...NPM].map((v) => `v${v}`);
  const releases = tags.map((tagName) => ({ tagName, draft: false }));
  const result = evaluateReleaseConsistency({ tags, releases, npmVersions: NPM });
  assert.deepEqual(result, { errors: [], warnings: [] });
});

test("a new public GitHub-only Release is an error", () => {
  const result = evaluateReleaseConsistency({
    tags: ["v1.4.0", ...NPM.map((v) => `v${v}`)],
    releases: [{ tagName: "v1.4.0", draft: false }],
    npmVersions: NPM,
  });
  assert.deepEqual(result.errors, [
    "Public GitHub Release v1.4.0 has no matching npm version 1.4.0",
  ]);
});

test("a draft waiting for npm and an orphan tag are warnings", () => {
  const result = evaluateReleaseConsistency({
    tags: ["v1.4.0", "v1.4.1", ...NPM.map((v) => `v${v}`)],
    releases: [{ tagName: "v1.4.0", draft: true }],
    npmVersions: NPM,
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 2);
});

test("an npm version without a canonical tag is an error", () => {
  const result = evaluateReleaseConsistency({
    tags: NPM.filter((v) => v !== "1.2.0").map((v) => `v${v}`),
    releases: [],
    npmVersions: NPM,
  });
  assert.deepEqual(result.errors, ["npm version 1.2.0 has no canonical tag v1.2.0"]);
});

test("check main reports errors without throwing", () => {
  const result = checkMain(["--owner-repo", "o/r"], {
    readGithubReleaseState: () => ({
      tags: ["v9.9.9"],
      releases: [{ tagName: "v9.9.9", draft: false }],
    }),
    readNpmVersions: () => [],
  });
  assert.equal(result.errors.length, 1);
});
