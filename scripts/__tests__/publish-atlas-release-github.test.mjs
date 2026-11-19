import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  applyPublication,
  loadGithubState,
  parseArgs,
  waitForRequiredChecks,
} from "../publish-atlas-release.mjs";
import {
  PublicationError,
  REQUIRED_RELEASE_CHECK_WORKFLOWS,
  REQUIRED_WORKFLOW_RUN_JSON_FIELDS,
} from "../release-publication.mjs";

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);

/** Records every command and answers from a queue or a function. */
function recorder(respond = () => "") {
  const calls = [];
  const run = (args) => {
    calls.push([...args]);
    return respond(args, calls.length);
  };
  return { calls, run };
}

function successfulRuns(sha = SHA) {
  return REQUIRED_RELEASE_CHECK_WORKFLOWS.map((name, index) => ({
    name,
    status: "completed",
    conclusion: "success",
    headSha: sha,
    databaseId: index + 1,
    attempt: 1,
  }));
}

describe("parseArgs", () => {
  it("defaults to a live run against GITHUB_REPOSITORY and GITHUB_SHA", () => {
    const options = parseArgs([], { GITHUB_REPOSITORY: "acme/atlas-fork", GITHUB_SHA: SHA });
    assert.equal(options.dryRun, false);
    assert.equal(options.skipChecks, false);
    assert.equal(options.ownerRepo, "acme/atlas-fork");
    assert.equal(options.targetSha, SHA);
  });

  it("falls back to the canonical repository and no target outside Actions", () => {
    const options = parseArgs([], {});
    assert.equal(options.ownerRepo, "blitzcraftlabs/atlas");
    assert.equal(options.targetSha, null);
  });

  it("reads every flag and value", () => {
    const options = parseArgs(
      [
        "--dry-run",
        "--skip-github",
        "--skip-checks",
        "--repo-root",
        "/repo",
        "--state-file",
        "/state.json",
        "--output-dir",
        "/out",
        "--owner-repo",
        "acme/atlas",
        "--target-sha",
        OTHER_SHA,
      ],
      {}
    );
    assert.deepEqual(options, {
      dryRun: true,
      skipGithub: true,
      skipChecks: true,
      repoRoot: "/repo",
      stateFile: "/state.json",
      outputDir: "/out",
      ownerRepo: "acme/atlas",
      targetSha: OTHER_SHA,
    });
  });
});

describe("loadGithubState", () => {
  let root;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "atlas-publish-state-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("reads a state file without calling GitHub", () => {
    const stateFile = path.join(root, "state.json");
    const state = { existingTags: [], existingReleases: [], canonicalMainSha: SHA };
    writeFileSync(stateFile, JSON.stringify(state));
    const gh = recorder();

    assert.deepEqual(loadGithubState({ stateFile }, { gh: gh.run }), state);
    assert.equal(gh.calls.length, 0);
  });

  it("returns empty state at the target SHA with --skip-github", () => {
    const gh = recorder();

    assert.deepEqual(loadGithubState({ skipGithub: true, targetSha: SHA }, { gh: gh.run }), {
      existingTags: [],
      existingReleases: [],
      canonicalMainSha: SHA,
    });
    assert.equal(gh.calls.length, 0);
  });

  it("maps tags, releases and main from the GitHub API", () => {
    const responses = {
      "repos/acme/atlas/tags": JSON.stringify([
        { name: "v1.3.0", commit: { sha: OTHER_SHA } },
        { name: "v1.4.0", commit: { sha: SHA } },
        { name: "v0.9.0" },
      ]),
      "repos/acme/atlas/releases": JSON.stringify([
        {
          // target_commitish is a branch name: the SHA must come from the matching tag.
          tag_name: "v1.4.0",
          target_commitish: "main",
          draft: true,
          assets: [{ name: "atlas-sbom.spdx.json" }, { name: "" }, {}],
        },
        { tag_name: "v1.3.0", target_commitish: OTHER_SHA.toUpperCase(), draft: false },
        // Draft release whose tag does not exist yet.
        { tag_name: "v1.5.0", target_commitish: "main" },
      ]),
      "repos/acme/atlas/commits/main": JSON.stringify({ sha: SHA }),
    };
    const gh = recorder((args) => responses[args[1]]);

    const state = loadGithubState({ ownerRepo: "acme/atlas" }, { gh: gh.run });

    assert.deepEqual(gh.calls, [
      ["api", "repos/acme/atlas/tags", "--paginate"],
      ["api", "repos/acme/atlas/releases", "--paginate"],
      ["api", "repos/acme/atlas/commits/main"],
    ]);
    assert.deepEqual(state, {
      existingTags: [
        { name: "v1.3.0", sha: OTHER_SHA },
        { name: "v1.4.0", sha: SHA },
        { name: "v0.9.0", sha: null },
      ],
      existingReleases: [
        { tagName: "v1.4.0", draft: true, sha: SHA, assets: ["atlas-sbom.spdx.json"] },
        { tagName: "v1.3.0", draft: false, sha: OTHER_SHA.toUpperCase(), assets: [] },
        { tagName: "v1.5.0", draft: false, sha: null, assets: [] },
      ],
      canonicalMainSha: SHA,
    });
  });

  it("treats empty tag and release responses as none", () => {
    const gh = recorder((args) => (args[1].endsWith("commits/main") ? `{"sha":"${SHA}"}` : ""));

    const state = loadGithubState({ ownerRepo: "acme/atlas" }, { gh: gh.run });

    assert.deepEqual(state.existingTags, []);
    assert.deepEqual(state.existingReleases, []);
  });
});

describe("waitForRequiredChecks", () => {
  function clock(stepMs) {
    let current = 0;
    return () => {
      const value = current;
      current += stepMs;
      return value;
    };
  }

  it("returns at once when every required workflow succeeded on the commit", () => {
    const gh = recorder(() => JSON.stringify(successfulRuns()));
    const sleeps = [];

    waitForRequiredChecks({ ownerRepo: "acme/atlas" }, SHA, {
      gh: gh.run,
      sleep: (ms) => sleeps.push(ms),
      env: {},
      write: () => {},
    });

    assert.deepEqual(gh.calls, [
      [
        "run",
        "list",
        "--repo",
        "acme/atlas",
        "--commit",
        SHA,
        "--json",
        REQUIRED_WORKFLOW_RUN_JSON_FIELDS.join(","),
      ],
    ]);
    assert.deepEqual(sleeps, []);
  });

  it("polls while a required workflow is still running", () => {
    const pendingRuns = successfulRuns().map((run, index) =>
      index === 0 ? { ...run, status: "in_progress", conclusion: null } : run
    );
    const gh = recorder((_args, call) =>
      JSON.stringify(call === 1 ? pendingRuns : successfulRuns())
    );
    const sleeps = [];
    const output = [];

    waitForRequiredChecks({ ownerRepo: "acme/atlas" }, SHA, {
      gh: gh.run,
      sleep: (ms) => sleeps.push(ms),
      env: { ATLAS_RELEASE_CHECK_POLL_MS: "5000" },
      write: (text) => output.push(text),
    });

    assert.equal(gh.calls.length, 2);
    assert.deepEqual(sleeps, [5000]);
    assert.match(
      output.join(""),
      new RegExp(`Waiting for required checks: ${REQUIRED_RELEASE_CHECK_WORKFLOWS[0]}`)
    );
  });

  it("treats a missing workflow run as pending, not passed", () => {
    const withoutFirst = successfulRuns().slice(1);
    const gh = recorder((_args, call) =>
      JSON.stringify(call === 1 ? withoutFirst : successfulRuns())
    );
    const sleeps = [];

    waitForRequiredChecks({ ownerRepo: "acme/atlas" }, SHA, {
      gh: gh.run,
      sleep: (ms) => sleeps.push(ms),
      env: {},
      write: () => {},
    });

    assert.equal(sleeps.length, 1);
  });

  it("ignores successful runs for a different commit", () => {
    const gh = recorder((_args, call) =>
      JSON.stringify(call === 1 ? successfulRuns(OTHER_SHA) : successfulRuns())
    );
    const sleeps = [];

    waitForRequiredChecks({ ownerRepo: "acme/atlas" }, SHA, {
      gh: gh.run,
      sleep: (ms) => sleeps.push(ms),
      env: {},
      write: () => {},
    });

    assert.equal(gh.calls.length, 2);
  });

  it("fails as soon as a required workflow fails", () => {
    const runs = successfulRuns().map((run, index) =>
      index === 1 ? { ...run, conclusion: "failure" } : run
    );
    const gh = recorder(() => JSON.stringify(runs));

    assert.throws(
      () =>
        waitForRequiredChecks({ ownerRepo: "acme/atlas" }, SHA, {
          gh: gh.run,
          sleep: () => assert.fail("must not sleep after a failure"),
          env: {},
          write: () => {},
        }),
      (error) =>
        error instanceof PublicationError &&
        error.code === "CHECKS_FAILED" &&
        error.message.includes(`${REQUIRED_RELEASE_CHECK_WORKFLOWS[1]}=failure`)
    );
  });

  it("times out instead of publishing when checks never finish", () => {
    const gh = recorder(() => "[]");
    const sleeps = [];

    assert.throws(
      () =>
        waitForRequiredChecks({ ownerRepo: "acme/atlas" }, SHA, {
          gh: gh.run,
          sleep: (ms) => sleeps.push(ms),
          now: clock(1000),
          env: { ATLAS_RELEASE_CHECK_TIMEOUT_MS: "3500", ATLAS_RELEASE_CHECK_POLL_MS: "1000" },
          write: () => {},
        }),
      (error) => error instanceof PublicationError && error.code === "CHECKS_TIMEOUT"
    );
    assert.ok(gh.calls.length >= 1);
    assert.equal(sleeps.length, gh.calls.length);
  });
});

describe("applyPublication", () => {
  let repoRoot;
  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-publish-apply-"));
  });
  afterEach(() => rmSync(repoRoot, { recursive: true, force: true }));

  function prepared(action, overrides = {}) {
    return {
      decision: {
        action,
        version: "1.4.0",
        tag: "v1.4.0",
        reason: "test",
        prerelease: false,
        ...overrides,
      },
      targetSha: SHA,
      sbom: { filePath: "/out/atlas-sbom.spdx.json" },
      notesPath: "/out/notes.md",
    };
  }

  function apply(action, { license = true, overrides } = {}) {
    if (license) {
      writeFileSync(path.join(repoRoot, "LICENSE"), "Apache-2.0\n");
    }
    const sequence = [];
    const gh = recorder((args) => {
      sequence.push(`gh ${args.slice(0, 2).join(" ")}`);
      return "";
    });
    const git = recorder((args) => {
      sequence.push(`git ${args.includes("tag") ? "tag" : args[0]}`);
      return "";
    });
    const output = [];
    applyPublication(
      { repoRoot, ownerRepo: "acme/atlas", targetSha: SHA },
      prepared(action, overrides),
      { gh: gh.run, git: git.run, write: (text) => output.push(text) }
    );
    return { gh: gh.calls, git: git.calls, sequence, output: output.join("") };
  }

  it("publish: tags and pushes, then creates a draft release and uploads SBOM and LICENSE", () => {
    const result = apply("publish");

    assert.deepEqual(result.sequence, [
      "git tag",
      "git push",
      "gh release create",
      "gh release upload",
      "gh release upload",
    ]);
    assert.ok(result.git[0].includes(SHA), "tag must point at the target SHA");
    assert.deepEqual(result.git[1], ["push", "origin", "v1.4.0"]);
    const create = result.gh[0];
    assert.ok(create.includes("--draft"), "release stays a draft until npm publication");
    assert.deepEqual(create.slice(create.indexOf("--target"), create.indexOf("--target") + 2), [
      "--target",
      SHA,
    ]);
    assert.ok(!create.includes("--prerelease"));
    assert.deepEqual(result.gh[1], [
      "release",
      "upload",
      "v1.4.0",
      "/out/atlas-sbom.spdx.json",
      "--repo",
      "acme/atlas",
    ]);
    assert.deepEqual(result.gh[2], [
      "release",
      "upload",
      "v1.4.0",
      path.join(repoRoot, "LICENSE"),
      "--repo",
      "acme/atlas",
    ]);
    assert.match(result.output, /✓ Published v1\.4\.0/);
  });

  it("marks a prerelease decision as a GitHub prerelease", () => {
    const result = apply("publish", { overrides: { prerelease: true } });
    assert.ok(result.gh[0].includes("--prerelease"));
  });

  it("repair-release: recreates the release on the existing tag without tagging", () => {
    const result = apply("repair-release");

    assert.deepEqual(result.git, []);
    assert.deepEqual(result.sequence, [
      "gh release create",
      "gh release upload",
      "gh release upload",
    ]);
    assert.ok(result.gh.slice(1).every((args) => !args.includes("--clobber")));
  });

  it("repair-assets: only re-uploads assets, replacing the existing ones", () => {
    const result = apply("repair-assets");

    assert.deepEqual(result.git, []);
    assert.deepEqual(result.sequence, ["gh release upload", "gh release upload"]);
    assert.ok(result.gh.every((args) => args.at(-1) === "--clobber"));
  });

  it("skips the LICENSE upload when the checkout has no LICENSE", () => {
    const result = apply("publish", { license: false });

    assert.deepEqual(result.sequence, [
      "git tag",
      "git push",
      "gh release create",
      "gh release upload",
    ]);
  });

  it("noop: mutates nothing", () => {
    const result = apply("noop");

    assert.deepEqual(result.git, []);
    assert.deepEqual(result.gh, []);
  });
});
