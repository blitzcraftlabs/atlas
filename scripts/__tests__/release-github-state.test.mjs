import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { main as checkReleaseConsistency } from "../check-release-consistency.mjs";
import {
  PUBLIC_PACKAGE,
  readGithubReleaseState,
  readNpmVersions,
} from "../lib/release-github-state.mjs";

function npmError(stderr) {
  const error = new Error("Command failed: npm view");
  error.stderr = stderr;
  return error;
}

describe("readNpmVersions", () => {
  it("queries the public CLI package's published versions", () => {
    const calls = [];
    const versions = readNpmVersions({
      run: (command, args) => {
        calls.push([command, ...args]);
        return '["1.4.0","1.5.0"]\n';
      },
    });

    assert.deepEqual(versions, ["1.4.0", "1.5.0"]);
    assert.deepEqual(calls, [["npm", "view", PUBLIC_PACKAGE, "versions", "--json"]]);
  });

  it("wraps a single published version in an array", () => {
    assert.deepEqual(readNpmVersions({ run: () => '"1.0.1"' }), ["1.0.1"]);
  });

  it("treats a package that was never published (E404) as no versions", () => {
    const run = () => {
      throw npmError("npm error code E404\nnpm error 404 Not Found");
    };
    assert.deepEqual(readNpmVersions({ run }), []);
  });

  it("does not hide other registry failures", () => {
    const run = () => {
      throw npmError("npm error code ETIMEDOUT");
    };
    assert.throws(() => readNpmVersions({ run }), /Command failed/);
  });
});

describe("readGithubReleaseState", () => {
  function ghReturning(tagsOutput, releasesOutput) {
    const calls = [];
    return {
      calls,
      run: (command, args) => {
        calls.push([command, ...args]);
        return args[1].includes("/tags") ? tagsOutput : releasesOutput;
      },
    };
  }

  it("joins paginated tag and release pages into single lists", () => {
    // Real `gh api --paginate --jq` output: one compact JSON array per page, per line.
    const gh = ghReturning(
      '["v1.5.0","v1.4.0"]\n["v1.3.0"]\n',
      '[{"tagName":"v1.5.0","draft":true,"prerelease":false}]\n[{"tagName":"v1.4.0","draft":false,"prerelease":false}]\n'
    );

    const state = readGithubReleaseState("acme/atlas", { run: gh.run });

    assert.deepEqual(state.tags, ["v1.5.0", "v1.4.0", "v1.3.0"]);
    assert.deepEqual(state.releases, [
      { tagName: "v1.5.0", draft: true, prerelease: false },
      { tagName: "v1.4.0", draft: false, prerelease: false },
    ]);
    assert.ok(gh.calls.every(([command]) => command === "gh"));
    assert.ok(gh.calls[0].includes("repos/acme/atlas/tags?per_page=100"));
    assert.ok(gh.calls[1].includes("repos/acme/atlas/releases?per_page=100"));
  });

  it("treats empty output as no tags or releases", () => {
    const gh = ghReturning("", "  \n");
    assert.deepEqual(readGithubReleaseState("acme/atlas", { run: gh.run }), {
      tags: [],
      releases: [],
    });
  });
});

describe("check-release-consistency", () => {
  function capture(fn) {
    const out = [];
    const err = [];
    const stdout = process.stdout.write;
    const stderr = process.stderr.write;
    process.stdout.write = (text) => out.push(String(text)) > 0;
    process.stderr.write = (text) => err.push(String(text)) > 0;
    try {
      return { result: fn(), stdout: out.join(""), stderr: err.join("") };
    } finally {
      process.stdout.write = stdout;
      process.stderr.write = stderr;
    }
  }

  it("passes when every public release has an npm version", () => {
    const { result, stdout } = capture(() =>
      checkReleaseConsistency(["--owner-repo", "acme/atlas"], {
        readGithubReleaseState: (ownerRepo) => {
          assert.equal(ownerRepo, "acme/atlas");
          return {
            tags: ["v1.4.0"],
            releases: [{ tagName: "v1.4.0", draft: false, prerelease: false }],
          };
        },
        readNpmVersions: () => ["1.4.0"],
      })
    );

    assert.deepEqual(result.errors, []);
    assert.match(stdout, /consistent \(1 npm versions\)/);
  });

  it("fails when a public GitHub Release has no npm version", () => {
    const { result, stderr } = capture(() =>
      checkReleaseConsistency(["--owner-repo", "acme/atlas"], {
        readGithubReleaseState: () => ({
          tags: ["v1.4.0"],
          releases: [{ tagName: "v1.4.0", draft: false, prerelease: false }],
        }),
        readNpmVersions: () => [],
      })
    );

    assert.ok(result.errors.length > 0);
    assert.match(stderr, /✗ .*1\.4\.0/);
  });

  it("defaults to GITHUB_REPOSITORY", () => {
    const previous = process.env.GITHUB_REPOSITORY;
    process.env.GITHUB_REPOSITORY = "fork/atlas";
    try {
      let seen;
      capture(() =>
        checkReleaseConsistency([], {
          readGithubReleaseState: (ownerRepo) => {
            seen = ownerRepo;
            return { tags: [], releases: [] };
          },
          readNpmVersions: () => [],
        })
      );
      assert.equal(seen, "fork/atlas");
    } finally {
      if (previous === undefined) delete process.env.GITHUB_REPOSITORY;
      else process.env.GITHUB_REPOSITORY = previous;
    }
  });
});
