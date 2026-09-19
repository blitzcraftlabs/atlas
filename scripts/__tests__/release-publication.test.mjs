import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { generateSpdxSbom } from "../generate-sbom.mjs";
import {
  createGitTag,
  preparePublication,
  runPublication,
  writePublicationGithubOutputs,
} from "../publish-atlas-release.mjs";
import {
  PublicationError,
  REQUIRED_RELEASE_CHECK_WORKFLOWS,
  REQUIRED_WORKFLOW_RUN_JSON_FIELDS,
  buildCanonicalReleaseNotes,
  collectVersionConsistencyErrors,
  evaluateCurrentPublicationState,
  evaluatePublicationDecision,
  evaluateRequiredReleaseChecks,
  isFirstCanonicalPublicRelease,
  isGitAncestor,
  isHistoricalUnpublishedVersion,
  publicationSideEffects,
  readPublicationInputs,
  sbomAssetNameForCommit,
  tagNameForVersion,
} from "../release-publication.mjs";

const alignedWorkspaces = [
  { name: "@atlas/web", version: "0.2.0" },
  { name: "@atlas/ui", version: "0.2.0" },
];

const changelog020 = `# Changelog

## [Unreleased]

## [0.2.0] - 2026-09-11

### Added
- First public release automation

## 0.1.0 - 2026-08-19

### Added
- Historical snapshot
`;

describe("version consistency", () => {
  it("fails when root version != workspace fixed-group version", () => {
    const errors = collectVersionConsistencyErrors({
      rootVersion: "0.2.0",
      workspaceVersions: [
        { name: "@atlas/web", version: "0.2.0" },
        { name: "@atlas/ui", version: "0.1.0" },
      ],
      changelog: changelog020,
    });
    assert.match(errors.join("\n"), /@atlas\/ui is 0\.1\.0/);
  });

  it("fails when changelog version != package version", () => {
    const errors = collectVersionConsistencyErrors({
      rootVersion: "0.2.0",
      workspaceVersions: alignedWorkspaces,
      changelog: "## [0.1.0]\n\n- old\n",
    });
    assert.match(errors.join("\n"), /no section for current Atlas version 0\.2\.0/);
  });

  it("accepts 1.0.0 as a valid publication identity", () => {
    const errors = collectVersionConsistencyErrors({
      rootVersion: "1.0.0",
      workspaceVersions: [
        { name: "@atlas/web", version: "1.0.0" },
        { name: "@atlas/ui", version: "1.0.0" },
      ],
      changelog: `# Changelog

## [Unreleased]

## [1.0.0] - 2026-09-17

### Added
- First supported public distribution
`,
      proposedTag: "v1.0.0",
    });
    assert.deepEqual(errors, []);
  });

  it("fails when tag version != package version", () => {
    const errors = collectVersionConsistencyErrors({
      rootVersion: "0.2.0",
      workspaceVersions: alignedWorkspaces,
      changelog: changelog020,
      proposedTag: "v0.3.0",
    });
    assert.match(errors.join("\n"), /Tag v0\.3\.0 does not match package version 0\.2\.0/);
  });
});

describe("publication decision", () => {
  it("no-ops without publication for the historical 0.1.0 snapshot", () => {
    const decision = evaluatePublicationDecision({
      rootVersion: "0.1.0",
      workspaceVersions: [
        { name: "@atlas/web", version: "0.1.0" },
        { name: "@atlas/ui", version: "0.1.0" },
      ],
      changelog: "## 0.1.0 - 2026-08-19\n\n### Added\n- Historical snapshot\n",
      targetSha: "abc",
      canonicalMainSha: "abc",
    });
    assert.equal(decision.action, "noop");
    assert.match(decision.reason, /historical internal snapshot/);
    assert.equal(isHistoricalUnpublishedVersion("0.1.0"), true);
  });

  it("no-ops historical 0.1.0 even when pending changesets remain", () => {
    const decision = evaluatePublicationDecision({
      rootVersion: "0.1.0",
      workspaceVersions: [
        { name: "@atlas/web", version: "0.1.0" },
        { name: "@atlas/ui", version: "0.1.0" },
      ],
      changelog: "## 0.1.0 - 2026-08-19\n\n### Added\n- Historical snapshot\n",
      pendingChangesetFiles: ["public-release-automation.md"],
      targetSha: "abc",
      canonicalMainSha: "abc",
    });
    assert.equal(decision.action, "noop");
  });

  it("fails when a non-historical version still has pending changesets", () => {
    assert.throws(
      () =>
        evaluatePublicationDecision({
          rootVersion: "0.2.0",
          workspaceVersions: alignedWorkspaces,
          changelog: changelog020,
          pendingChangesetFiles: ["foo.md", "bar.md"],
          targetSha: "abc",
          canonicalMainSha: "abc",
        }),
      (error) =>
        error instanceof PublicationError &&
        error.code === "PENDING_CHANGESETS" &&
        /Cannot publish v0\.2\.0 while pending changesets remain/.test(error.message) &&
        /- foo\.md/.test(error.message) &&
        /- bar\.md/.test(error.message)
    );
  });

  it("publishes 0.2.0 when no pending changesets remain", () => {
    const decision = evaluatePublicationDecision({
      rootVersion: "0.2.0",
      workspaceVersions: alignedWorkspaces,
      changelog: changelog020,
      pendingChangesetFiles: [],
      targetSha: "abc",
      canonicalMainSha: "abc",
    });
    assert.equal(decision.action, "publish");
    assert.equal(decision.tag, "v0.2.0");
  });

  it("fails when the target tag already exists at a different SHA", () => {
    assert.throws(
      () =>
        evaluatePublicationDecision({
          rootVersion: "0.2.0",
          workspaceVersions: alignedWorkspaces,
          changelog: changelog020,
          existingTags: [{ name: "v0.2.0", sha: "oldsha" }],
          targetSha: "newsha",
          canonicalMainSha: "newsha",
        }),
      (error) => error instanceof PublicationError && error.code === "TAG_EXISTS"
    );
  });

  it("fails when the GitHub Release already exists for a different SHA", () => {
    assert.throws(
      () =>
        evaluatePublicationDecision({
          rootVersion: "0.2.0",
          workspaceVersions: alignedWorkspaces,
          changelog: changelog020,
          existingTags: [{ name: "v0.2.0", sha: "newsha" }],
          existingReleases: [{ tagName: "v0.2.0", sha: "oldsha" }],
          targetSha: "newsha",
          canonicalMainSha: "newsha",
        }),
      (error) => error instanceof PublicationError && error.code === "RELEASE_EXISTS"
    );
  });

  it("no-ops when tag, Release, and required SBOM exist at this SHA", () => {
    const decision = evaluatePublicationDecision({
      rootVersion: "0.2.0",
      workspaceVersions: alignedWorkspaces,
      changelog: changelog020,
      existingTags: [{ name: "v0.2.0", sha: "abc" }],
      existingReleases: [
        {
          tagName: "v0.2.0",
          sha: "abc",
          assets: [sbomAssetNameForCommit("abc"), "LICENSE"],
        },
      ],
      targetSha: "abc",
      canonicalMainSha: "abc",
    });
    assert.equal(decision.action, "noop");
    assert.match(decision.reason, /already exist/);
    assert.equal(publicationSideEffects(decision.action).createTag, false);
    assert.equal(publicationSideEffects(decision.action).createRelease, false);
    assert.equal(publicationSideEffects(decision.action).uploadAssets, false);
  });

  it("no-ops when a complete release tag is a proven ancestor of current main", () => {
    const releaseSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const mainSha = "cccccccccccccccccccccccccccccccccccccccc";
    const decision = evaluatePublicationDecision({
      rootVersion: "0.2.0",
      workspaceVersions: alignedWorkspaces,
      changelog: changelog020,
      existingTags: [{ name: "v0.2.0", sha: releaseSha }],
      existingReleases: [
        {
          tagName: "v0.2.0",
          sha: releaseSha,
          assets: [sbomAssetNameForCommit(releaseSha), "LICENSE"],
        },
      ],
      targetSha: mainSha,
      canonicalMainSha: mainSha,
      isCommitAncestor: (ancestorSha, descendantSha) =>
        ancestorSha === releaseSha && descendantSha === mainSha,
    });
    assert.equal(decision.action, "noop");
    assert.match(
      decision.reason,
      /Atlas 0\.2\.0 is already published; current main contains post-release commits/
    );
    assert.equal(publicationSideEffects(decision.action).createTag, false);
    assert.equal(publicationSideEffects(decision.action).createRelease, false);
    assert.equal(publicationSideEffects(decision.action).uploadAssets, false);
  });

  it("does not noop an ancestor tag without a complete Release", () => {
    const releaseSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const mainSha = "cccccccccccccccccccccccccccccccccccccccc";
    assert.throws(
      () =>
        evaluatePublicationDecision({
          rootVersion: "0.2.0",
          workspaceVersions: alignedWorkspaces,
          changelog: changelog020,
          existingTags: [{ name: "v0.2.0", sha: releaseSha }],
          existingReleases: [],
          targetSha: mainSha,
          canonicalMainSha: mainSha,
          isCommitAncestor: () => true,
        }),
      (error) => error instanceof PublicationError && error.code === "TAG_EXISTS"
    );
  });

  it("does not repair assets against current main when the complete tag is only an ancestor", () => {
    const releaseSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const mainSha = "cccccccccccccccccccccccccccccccccccccccc";
    assert.throws(
      () =>
        evaluatePublicationDecision({
          rootVersion: "0.2.0",
          workspaceVersions: alignedWorkspaces,
          changelog: changelog020,
          existingTags: [{ name: "v0.2.0", sha: releaseSha }],
          existingReleases: [{ tagName: "v0.2.0", sha: releaseSha, assets: ["LICENSE"] }],
          targetSha: mainSha,
          canonicalMainSha: mainSha,
          isCommitAncestor: () => true,
        }),
      (error) => error instanceof PublicationError && error.code === "TAG_EXISTS"
    );
  });

  it("fails closed when the existing tag is not a proven ancestor of the target", () => {
    assert.throws(
      () =>
        evaluatePublicationDecision({
          rootVersion: "0.2.0",
          workspaceVersions: alignedWorkspaces,
          changelog: changelog020,
          existingTags: [{ name: "v0.2.0", sha: "unrelated" }],
          existingReleases: [
            {
              tagName: "v0.2.0",
              sha: "unrelated",
              assets: [sbomAssetNameForCommit("unrelated"), "LICENSE"],
            },
          ],
          targetSha: "mainsha",
          canonicalMainSha: "mainsha",
          isCommitAncestor: () => false,
        }),
      (error) => error instanceof PublicationError && error.code === "TAG_EXISTS"
    );
  });

  it("fails closed when ancestry is not proven", () => {
    assert.throws(
      () =>
        evaluatePublicationDecision({
          rootVersion: "0.2.0",
          workspaceVersions: alignedWorkspaces,
          changelog: changelog020,
          existingTags: [{ name: "v0.2.0", sha: "oldsha" }],
          existingReleases: [
            {
              tagName: "v0.2.0",
              sha: "oldsha",
              assets: [sbomAssetNameForCommit("oldsha"), "LICENSE"],
            },
          ],
          targetSha: "newsha",
          canonicalMainSha: "newsha",
        }),
      (error) => error instanceof PublicationError && error.code === "TAG_EXISTS"
    );
  });

  it("fails when the tag target is a descendant of the requested publication SHA", () => {
    assert.throws(
      () =>
        evaluatePublicationDecision({
          rootVersion: "0.2.0",
          workspaceVersions: alignedWorkspaces,
          changelog: changelog020,
          existingTags: [{ name: "v0.2.0", sha: "later" }],
          existingReleases: [
            {
              tagName: "v0.2.0",
              sha: "later",
              assets: [sbomAssetNameForCommit("later"), "LICENSE"],
            },
          ],
          targetSha: "earlier",
          canonicalMainSha: "earlier",
          isCommitAncestor: () => false,
        }),
      (error) => error instanceof PublicationError && error.code === "TAG_EXISTS"
    );
  });

  it("still refuses pending changesets when a complete ancestor release already exists", () => {
    assert.throws(
      () =>
        evaluatePublicationDecision({
          rootVersion: "0.2.0",
          workspaceVersions: alignedWorkspaces,
          changelog: changelog020,
          pendingChangesetFiles: ["next-minor.md"],
          existingTags: [{ name: "v0.2.0", sha: "oldsha" }],
          existingReleases: [
            {
              tagName: "v0.2.0",
              sha: "oldsha",
              assets: [sbomAssetNameForCommit("oldsha"), "LICENSE"],
            },
          ],
          targetSha: "newsha",
          canonicalMainSha: "newsha",
          isCommitAncestor: () => true,
        }),
      (error) => error instanceof PublicationError && error.code === "PENDING_CHANGESETS"
    );
  });

  it("repairs assets when the Release exists but the required SBOM is missing", () => {
    const decision = evaluatePublicationDecision({
      rootVersion: "0.2.0",
      workspaceVersions: alignedWorkspaces,
      changelog: changelog020,
      existingTags: [{ name: "v0.2.0", sha: "abc" }],
      existingReleases: [{ tagName: "v0.2.0", sha: "abc", assets: ["LICENSE"] }],
      targetSha: "abc",
      canonicalMainSha: "abc",
    });
    assert.equal(decision.action, "repair-assets");
    assert.deepEqual(decision.missingAssets, [sbomAssetNameForCommit("abc")]);
    assert.equal(publicationSideEffects(decision.action).createTag, false);
  });

  it("repairs the Release when only the tag exists at the correct SHA", () => {
    const decision = evaluatePublicationDecision({
      rootVersion: "0.2.0",
      workspaceVersions: alignedWorkspaces,
      changelog: changelog020,
      existingTags: [{ name: "v0.2.0", sha: "abc" }],
      existingReleases: [],
      targetSha: "abc",
      canonicalMainSha: "abc",
    });
    assert.equal(decision.action, "repair-release");
    assert.equal(publicationSideEffects(decision.action).createTag, false);
    assert.equal(publicationSideEffects(decision.action).createRelease, true);
  });

  it("fails when a GitHub Release exists without a matching tag", () => {
    assert.throws(
      () =>
        evaluatePublicationDecision({
          rootVersion: "0.2.0",
          workspaceVersions: alignedWorkspaces,
          changelog: changelog020,
          existingTags: [],
          existingReleases: [
            {
              tagName: "v0.2.0",
              sha: "abc",
              assets: [sbomAssetNameForCommit("abc")],
            },
          ],
          targetSha: "abc",
          canonicalMainSha: "abc",
        }),
      (error) => error instanceof PublicationError && error.code === "RELEASE_WITHOUT_TAG"
    );
  });

  it("publishes when a non-historical version has no tag or release", () => {
    const decision = evaluatePublicationDecision({
      rootVersion: "0.2.0",
      workspaceVersions: alignedWorkspaces,
      changelog: changelog020,
      targetSha: "abc",
      canonicalMainSha: "abc",
    });
    assert.equal(decision.action, "publish");
    assert.equal(decision.tag, "v0.2.0");
  });

  it("fails when pending version metadata is inconsistent", () => {
    assert.throws(
      () =>
        evaluatePublicationDecision({
          rootVersion: "0.2.0",
          workspaceVersions: [{ name: "@atlas/web", version: "0.1.1" }],
          changelog: changelog020,
        }),
      (error) => error instanceof PublicationError && error.code === "INVALID_RELEASE_STATE"
    );
  });

  it("fails when the target SHA is not canonical main", () => {
    assert.throws(
      () =>
        evaluatePublicationDecision({
          rootVersion: "0.2.0",
          workspaceVersions: alignedWorkspaces,
          changelog: changelog020,
          targetSha: "feature",
          canonicalMainSha: "mainsha",
        }),
      (error) => error instanceof PublicationError && error.code === "STALE_SHA"
    );
  });

  it("never creates a tag on repair actions", () => {
    assert.equal(publicationSideEffects("publish").createTag, true);
    assert.equal(publicationSideEffects("repair-release").createTag, false);
    assert.equal(publicationSideEffects("repair-assets").createTag, false);
    assert.equal(publicationSideEffects("repair-assets").clobberExactAssets, true);
    assert.equal(publicationSideEffects("publish").clobberExactAssets, false);
  });
});

describe("required release checks", () => {
  const sha = "abc123def456abc123def456abc123def456abcd";
  const otherSha = "ffffffffffffffffffffffffffffffffffffffff";

  function passingOthers(extra = []) {
    return [
      {
        name: "Security Audit",
        conclusion: "success",
        status: "completed",
        headSha: sha,
        databaseId: 1,
      },
      {
        name: "UI Quality",
        conclusion: "success",
        status: "completed",
        headSha: sha,
        databaseId: 2,
      },
      ...extra,
    ];
  }

  it("requires CI, Security Audit, and UI Quality", () => {
    assert.deepEqual([...REQUIRED_RELEASE_CHECK_WORKFLOWS], ["CI", "Security Audit", "UI Quality"]);
  });

  it("queries GitHub with the evaluator ordering fields", () => {
    assert.equal(REQUIRED_WORKFLOW_RUN_JSON_FIELDS.includes("databaseId"), true);
    assert.equal(REQUIRED_WORKFLOW_RUN_JSON_FIELDS.includes("attempt"), true);
  });

  it("accepts success only for the exact target SHA", () => {
    const result = evaluateRequiredReleaseChecks(
      passingOthers([
        {
          name: "CI",
          conclusion: "success",
          status: "completed",
          headSha: otherSha,
          databaseId: 200,
        },
        {
          name: "CI",
          conclusion: "success",
          status: "completed",
          headSha: sha,
          databaseId: 100,
        },
      ]),
      { commitSha: sha }
    );
    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.pending, []);
  });

  it("ignores a successful run from another SHA", () => {
    const result = evaluateRequiredReleaseChecks(
      passingOthers([
        {
          name: "CI",
          conclusion: "success",
          status: "completed",
          headSha: otherSha,
          databaseId: 101,
        },
      ]),
      { commitSha: sha }
    );
    assert.deepEqual(result.pending, ["CI"]);
  });

  it("does not let a newer other-SHA success mask the target SHA", () => {
    const result = evaluateRequiredReleaseChecks(
      passingOthers([
        {
          name: "CI",
          conclusion: "failure",
          status: "completed",
          headSha: sha,
          databaseId: 100,
        },
        {
          name: "CI",
          conclusion: "success",
          status: "completed",
          headSha: otherSha,
          databaseId: 101,
        },
      ]),
      { commitSha: sha }
    );
    assert.equal(result.failed[0]?.name, "CI");
    assert.equal(result.failed[0]?.conclusion, "failure");
  });

  it("fails closed on cancelled or failed required runs without a successful retry", () => {
    const cancelled = evaluateRequiredReleaseChecks(
      [{ name: "CI", conclusion: "cancelled", status: "completed", headSha: sha, databaseId: 10 }],
      { commitSha: sha }
    );
    assert.equal(cancelled.failed[0]?.conclusion, "cancelled");

    const failed = evaluateRequiredReleaseChecks(
      [
        {
          name: "UI Quality",
          conclusion: "failure",
          status: "completed",
          headSha: sha,
          databaseId: 11,
        },
      ],
      { commitSha: sha }
    );
    assert.equal(failed.failed[0]?.conclusion, "failure");
  });

  it("treats failure then a later successful retry as success", () => {
    const result = evaluateRequiredReleaseChecks(
      passingOthers([
        { name: "CI", conclusion: "failure", status: "completed", headSha: sha, databaseId: 100 },
        { name: "CI", conclusion: "success", status: "completed", headSha: sha, databaseId: 101 },
      ]),
      { commitSha: sha }
    );
    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.pending, []);
  });

  it("treats success then a later failure as failed", () => {
    const result = evaluateRequiredReleaseChecks(
      passingOthers([
        { name: "CI", conclusion: "success", status: "completed", headSha: sha, databaseId: 100 },
        { name: "CI", conclusion: "failure", status: "completed", headSha: sha, databaseId: 101 },
      ]),
      { commitSha: sha }
    );
    assert.equal(result.failed[0]?.conclusion, "failure");
    assert.deepEqual(result.pending, []);
  });

  it("treats failure then an in-progress retry as pending", () => {
    const result = evaluateRequiredReleaseChecks(
      passingOthers([
        { name: "CI", conclusion: "failure", status: "completed", headSha: sha, databaseId: 100 },
        { name: "CI", conclusion: null, status: "in_progress", headSha: sha, databaseId: 101 },
      ]),
      { commitSha: sha }
    );
    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.pending, ["CI"]);
  });

  it("treats success then an in-progress retry as pending", () => {
    const result = evaluateRequiredReleaseChecks(
      passingOthers([
        { name: "CI", conclusion: "success", status: "completed", headSha: sha, databaseId: 100 },
        { name: "CI", conclusion: null, status: "in_progress", headSha: sha, databaseId: 101 },
      ]),
      { commitSha: sha }
    );
    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.pending, ["CI"]);
  });

  it("keeps waiting when a required workflow is still pending", () => {
    const result = evaluateRequiredReleaseChecks(
      [
        { name: "CI", conclusion: "success", status: "completed", headSha: sha, databaseId: 1 },
        {
          name: "Security Audit",
          conclusion: null,
          status: "in_progress",
          headSha: sha,
          databaseId: 2,
        },
      ],
      { commitSha: sha }
    );
    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.pending, ["Security Audit", "UI Quality"]);
  });
});

describe("release notes", () => {
  it("frames the first canonical public release without claiming GitHub-release provenance or SLSA", () => {
    const notes = buildCanonicalReleaseNotes(changelog020, "0.2.0", {
      commitSha: "abc123",
      sbomFileName: "atlas-sbom-abc123.spdx.json",
      firstCanonicalPublicRelease: true,
    });
    assert.match(notes, /first canonical public GitHub Release/);
    assert.match(notes, /historical internal snapshot/);
    assert.match(notes, /Commit: `abc123`/);
    assert.match(notes, /Internal `@atlas\/\*` workspace packages remain `private`/);
    assert.match(notes, /public npm package identity/);
    assert.match(notes, /npm distribution occurs after the canonical GitHub Release/);
    assert.match(notes, /first npm publication was a human-authenticated publish/);
    assert.match(notes, /Trusted Publishing/);
    assert.match(notes, /This GitHub Release does \*\*not\*\* include signed provenance, SLSA attestation/);
    assert.match(notes, /not a GitHub Release attestation and is not SLSA/);
    assert.doesNotMatch(notes, /this GitHub Release workflow does \*\*not\*\* publish it to the npm registry/);
    assert.match(notes, /pre-1\.0 repository\/platform snapshot/);
  });

  it("frames 1.0.0 as the first supported public distribution without claiming LTS or audit completion", () => {
    const notes = buildCanonicalReleaseNotes(
      `# Changelog

## [Unreleased]

## [1.0.0] - 2026-09-17

### Added
- First supported public distribution
`,
      "1.0.0",
      { commitSha: "def456", firstCanonicalPublicRelease: false }
    );
    assert.match(notes, /first supported public distribution/);
    assert.match(notes, /0\.x GitHub releases were the platform-development\/proving line/);
    assert.match(notes, /Breaking public-contract changes after 1\.0 require a major version/);
    assert.match(notes, /No LTS programme/);
    assert.match(notes, /public npm package identity/);
    assert.match(notes, /npm Trusted Publishing attaches npm provenance/);
    assert.doesNotMatch(notes, /formal security audit completed/);
    assert.doesNotMatch(notes, /Atlas remains pre-1\.0/);
  });

  it("detects first canonical public release from empty GitHub state", () => {
    assert.equal(isFirstCanonicalPublicRelease({ existingTags: [], existingReleases: [] }), true);
    assert.equal(
      isFirstCanonicalPublicRelease({
        existingTags: [{ name: "v0.2.0" }],
        existingReleases: [],
      }),
      false
    );
  });
});

describe("SBOM generation failures", () => {
  it("fails visibly when the lockfile has no packages", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "atlas-sbom-empty-"));
    writeFileSync(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\npackages: {}\n");
    assert.throws(
      () => generateSpdxSbom({ root: dir, commitSha: "deadbeef" }),
      /SBOM generation found no packages/
    );
  });
});

describe("preparePublication dry-run", () => {
  it("writes notes and SBOM without requiring GitHub when state is provided", () => {
    const fixture = writePublicationFixture();
    const prepared = preparePublication({
      repoRoot: fixture.dir,
      stateFile: fixture.writeState({
        existingTags: [],
        existingReleases: [],
        canonicalMainSha: "abc123",
      }),
      skipGithub: false,
      dryRun: true,
      outputDir: fixture.outputDir,
      targetSha: "abc123",
    });

    assert.equal(prepared.decision.action, "publish");
    assert.equal(prepared.decision.tag, tagNameForVersion("0.2.0"));
    assert.match(prepared.notes, /Atlas 0\.2\.0/);
    assert.equal(prepared.sbom.packageCount > 0, true);
  });
});

describe("pre-mutation publication revalidation", () => {
  const targetSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const movedMainSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  function emptyGithubState(mainSha = targetSha) {
    return {
      existingTags: [],
      existingReleases: [],
      canonicalMainSha: mainSha,
    };
  }

  function evaluateFresh(githubState) {
    const fixture = writePublicationFixture();
    return evaluateCurrentPublicationState({
      inputs: readPublicationInputs(fixture.dir),
      githubState,
      targetSha,
    });
  }

  it("fails closed with STALE_SHA when main moved while waiting", () => {
    assert.equal(evaluateFresh(emptyGithubState(targetSha)).decision.action, "publish");
    assert.throws(
      () => evaluateFresh(emptyGithubState(movedMainSha)),
      (error) => error instanceof PublicationError && error.code === "STALE_SHA"
    );
  });

  it("becomes repair-release when the tag appears while waiting", () => {
    const fresh = evaluateFresh({
      existingTags: [{ name: "v0.2.0", sha: targetSha }],
      existingReleases: [],
      canonicalMainSha: targetSha,
    });
    assert.equal(fresh.decision.action, "repair-release");
    assert.equal(publicationSideEffects(fresh.decision.action).createTag, false);
  });

  it("becomes noop when a complete Release appears while waiting", () => {
    const fresh = evaluateFresh({
      existingTags: [{ name: "v0.2.0", sha: targetSha }],
      existingReleases: [
        {
          tagName: "v0.2.0",
          sha: targetSha,
          assets: [sbomAssetNameForCommit(targetSha), "LICENSE"],
        },
      ],
      canonicalMainSha: targetSha,
    });
    assert.equal(fresh.decision.action, "noop");
  });

  it("fails closed with TAG_EXISTS when a conflicting tag appears while waiting", () => {
    assert.throws(
      () =>
        evaluateFresh({
          existingTags: [{ name: "v0.2.0", sha: movedMainSha }],
          existingReleases: [],
          canonicalMainSha: targetSha,
        }),
      (error) => error instanceof PublicationError && error.code === "TAG_EXISTS"
    );
  });

  it("reloads GitHub state after waiting and does not mutate from the pre-wait decision", () => {
    const fixture = writePublicationFixture();
    const events = [];
    const applied = [];
    const states = [emptyGithubState(targetSha), emptyGithubState(movedMainSha)];

    assert.throws(
      () =>
        runPublication(
          {
            repoRoot: fixture.dir,
            dryRun: false,
            skipChecks: false,
            outputDir: fixture.outputDir,
            targetSha,
          },
          {
            loadGithubState() {
              events.push("load");
              return states[events.filter((event) => event === "load").length - 1];
            },
            waitForRequiredChecks() {
              events.push("wait");
            },
            applyPublication(_options, prepared) {
              applied.push(prepared.decision.action);
            },
          }
        ),
      (error) => error instanceof PublicationError && error.code === "STALE_SHA"
    );

    assert.deepEqual(events, ["load", "wait", "load"]);
    assert.deepEqual(applied, []);
  });

  it("does not create a second tag when the fresh decision is repair-release", () => {
    const fixture = writePublicationFixture();
    const applied = [];
    const states = [
      emptyGithubState(targetSha),
      {
        existingTags: [{ name: "v0.2.0", sha: targetSha }],
        existingReleases: [],
        canonicalMainSha: targetSha,
      },
    ];
    let loadCount = 0;

    const result = runPublication(
      {
        repoRoot: fixture.dir,
        dryRun: false,
        skipChecks: false,
        outputDir: fixture.outputDir,
        targetSha,
      },
      {
        loadGithubState() {
          const state = states[loadCount];
          loadCount += 1;
          return state;
        },
        waitForRequiredChecks() {},
        applyPublication(_options, prepared) {
          applied.push(prepared.decision);
        },
      }
    );

    assert.equal(result.decision.action, "repair-release");
    assert.equal(applied[0]?.action, "repair-release");
    assert.equal(publicationSideEffects(applied[0].action).createTag, false);
    assert.equal(publicationSideEffects(applied[0].action).createRelease, true);
  });

  it("does not mutate when a complete ancestor release is already published", () => {
    const fixture = writePublicationFixture();
    const releaseSha = "cccccccccccccccccccccccccccccccccccccccc";
    const applied = [];
    const githubState = {
      existingTags: [{ name: "v0.2.0", sha: releaseSha }],
      existingReleases: [
        {
          tagName: "v0.2.0",
          sha: releaseSha,
          assets: [sbomAssetNameForCommit(releaseSha), "LICENSE"],
        },
      ],
      canonicalMainSha: targetSha,
    };

    const runOnce = () =>
      runPublication(
        {
          repoRoot: fixture.dir,
          dryRun: false,
          skipChecks: false,
          outputDir: fixture.outputDir,
          targetSha,
        },
        {
          loadGithubState() {
            return githubState;
          },
          waitForRequiredChecks() {
            throw new Error("ancestor no-op must not wait for required checks");
          },
          applyPublication() {
            applied.push("applied");
          },
          isCommitAncestor: (ancestorSha, descendantSha) =>
            ancestorSha === releaseSha && descendantSha === targetSha,
        }
      );

    const first = runOnce();
    const second = runOnce();

    assert.equal(first.decision.action, "noop");
    assert.equal(second.decision.action, "noop");
    assert.match(first.decision.reason, /already published/);
    assert.deepEqual(applied, []);
  });

  it("does not mutate when the fresh decision is noop", () => {
    const fixture = writePublicationFixture();
    const applied = [];
    const states = [
      emptyGithubState(targetSha),
      {
        existingTags: [{ name: "v0.2.0", sha: targetSha }],
        existingReleases: [
          {
            tagName: "v0.2.0",
            sha: targetSha,
            assets: [sbomAssetNameForCommit(targetSha), "LICENSE"],
          },
        ],
        canonicalMainSha: targetSha,
      },
    ];
    let loadCount = 0;

    const result = runPublication(
      {
        repoRoot: fixture.dir,
        dryRun: false,
        skipChecks: false,
        outputDir: fixture.outputDir,
        targetSha,
      },
      {
        loadGithubState() {
          const state = states[loadCount];
          loadCount += 1;
          return state;
        },
        waitForRequiredChecks() {},
        applyPublication() {
          applied.push("applied");
        },
      }
    );

    assert.equal(result.decision.action, "noop");
    assert.deepEqual(applied, []);
  });

  it("does not mutate when a conflicting tag appears while waiting", () => {
    const fixture = writePublicationFixture();
    const applied = [];
    const states = [
      emptyGithubState(targetSha),
      {
        existingTags: [{ name: "v0.2.0", sha: movedMainSha }],
        existingReleases: [],
        canonicalMainSha: targetSha,
      },
    ];
    let loadCount = 0;

    assert.throws(
      () =>
        runPublication(
          {
            repoRoot: fixture.dir,
            dryRun: false,
            skipChecks: false,
            outputDir: fixture.outputDir,
            targetSha,
          },
          {
            loadGithubState() {
              const state = states[loadCount];
              loadCount += 1;
              return state;
            },
            waitForRequiredChecks() {},
            applyPublication() {
              applied.push("applied");
            },
          }
        ),
      (error) => error instanceof PublicationError && error.code === "TAG_EXISTS"
    );

    assert.deepEqual(applied, []);
    assert.equal(loadCount, 2);
  });
});

describe("git ancestry publication", () => {
  function git(cwd, args) {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
    }).trim();
  }

  function commit(cwd, message) {
    git(cwd, [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-m",
      message,
    ]);
    return git(cwd, ["rev-parse", "HEAD"]);
  }

  function annotatedTag(cwd, tag, sha) {
    git(cwd, [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "tag.gpgsign=false",
      "tag",
      "-a",
      tag,
      sha,
      "-m",
      `Atlas ${tag.slice(1)}`,
    ]);
  }

  it("no-ops a complete annotated tag that is an ancestor of later main commits", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-release-ancestor-"));

    try {
      git(repoRoot, ["init", "-b", "main"]);
      const commitA = commit(repoRoot, "A");
      annotatedTag(repoRoot, "v0.2.0", commitA);
      commit(repoRoot, "B");
      const commitC = commit(repoRoot, "C");

      assert.equal(isGitAncestor(commitA, commitC, { repoRoot }), true);
      assert.equal(isGitAncestor(commitC, commitA, { repoRoot }), false);

      const decision = evaluatePublicationDecision({
        rootVersion: "0.2.0",
        workspaceVersions: alignedWorkspaces,
        changelog: changelog020,
        existingTags: [{ name: "v0.2.0", sha: commitA }],
        existingReleases: [
          {
            tagName: "v0.2.0",
            sha: commitA,
            assets: [sbomAssetNameForCommit(commitA), "LICENSE"],
          },
        ],
        targetSha: commitC,
        canonicalMainSha: commitC,
        isCommitAncestor: (ancestorSha, descendantSha) =>
          isGitAncestor(ancestorSha, descendantSha, { repoRoot }),
      });

      assert.equal(decision.action, "noop");
      assert.match(decision.reason, /already published/);
      assert.equal(publicationSideEffects(decision.action).createTag, false);
      assert.equal(publicationSideEffects(decision.action).createRelease, false);
      assert.equal(publicationSideEffects(decision.action).uploadAssets, false);
      assert.equal(git(repoRoot, ["rev-parse", "v0.2.0^{commit}"]), commitA);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when the tag points at a divergent commit", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-release-divergent-"));

    try {
      git(repoRoot, ["init", "-b", "main"]);
      const commitA = commit(repoRoot, "A");
      commit(repoRoot, "B");
      const commitC = commit(repoRoot, "C");
      git(repoRoot, ["checkout", "-B", "other", commitA]);
      const commitX = commit(repoRoot, "X");
      annotatedTag(repoRoot, "v0.2.0", commitX);
      git(repoRoot, ["checkout", "main"]);

      assert.equal(isGitAncestor(commitX, commitC, { repoRoot }), false);
      assert.equal(isGitAncestor(commitA, commitC, { repoRoot }), true);

      assert.throws(
        () =>
          evaluatePublicationDecision({
            rootVersion: "0.2.0",
            workspaceVersions: alignedWorkspaces,
            changelog: changelog020,
            existingTags: [{ name: "v0.2.0", sha: commitX }],
            existingReleases: [
              {
                tagName: "v0.2.0",
                sha: commitX,
                assets: [sbomAssetNameForCommit(commitX), "LICENSE"],
              },
            ],
            targetSha: commitC,
            canonicalMainSha: commitC,
            isCommitAncestor: (ancestorSha, descendantSha) =>
              isGitAncestor(ancestorSha, descendantSha, { repoRoot }),
          }),
        (error) => error instanceof PublicationError && error.code === "TAG_EXISTS"
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when the tag target is a descendant of the publication SHA", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-release-descendant-"));

    try {
      git(repoRoot, ["init", "-b", "main"]);
      const commitA = commit(repoRoot, "A");
      commit(repoRoot, "B");
      const commitC = commit(repoRoot, "C");
      annotatedTag(repoRoot, "v0.2.0", commitC);

      assert.equal(isGitAncestor(commitC, commitA, { repoRoot }), false);

      assert.throws(
        () =>
          evaluatePublicationDecision({
            rootVersion: "0.2.0",
            workspaceVersions: alignedWorkspaces,
            changelog: changelog020,
            existingTags: [{ name: "v0.2.0", sha: commitC }],
            existingReleases: [
              {
                tagName: "v0.2.0",
                sha: commitC,
                assets: [sbomAssetNameForCommit(commitC), "LICENSE"],
              },
            ],
            targetSha: commitA,
            canonicalMainSha: commitA,
            isCommitAncestor: (ancestorSha, descendantSha) =>
              isGitAncestor(ancestorSha, descendantSha, { repoRoot }),
          }),
        (error) => error instanceof PublicationError && error.code === "TAG_EXISTS"
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe("annotated tag identity", () => {
  it("does not require global Git identity", () => {
    const publisher = readFileSync(
      new URL("../publish-atlas-release.mjs", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(publisher, /git config --global/);
    assert.doesNotMatch(publisher, /config --global/);
    assert.match(publisher, /-c[\s\S]*user\.name=github-actions\[bot\]/);
    assert.match(
      publisher,
      /-c[\s\S]*user\.email=41898282\+github-actions\[bot\]@users\.noreply\.github\.com/
    );
  });

  it("creates an annotated tag without ambient Git identity", () => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-release-tag-"));
    const originRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-release-tag-origin-"));
    const emptyConfig = path.join(repoRoot, "empty.gitconfig");
    writeFileSync(emptyConfig, "");

    const isolatedEnv = {
      ...process.env,
      GIT_CONFIG_GLOBAL: emptyConfig,
      GIT_CONFIG_SYSTEM: emptyConfig,
      GIT_CONFIG_NOSYSTEM: "1",
    };
    delete isolatedEnv.GIT_AUTHOR_NAME;
    delete isolatedEnv.GIT_AUTHOR_EMAIL;
    delete isolatedEnv.GIT_COMMITTER_NAME;
    delete isolatedEnv.GIT_COMMITTER_EMAIL;
    delete isolatedEnv.EMAIL;

    const runIsolatedGit = (cwd, args) =>
      execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        env: isolatedEnv,
      }).trim();

    try {
      runIsolatedGit(repoRoot, ["init", "-b", "main"]);
      runIsolatedGit(originRoot, ["init", "--bare"]);
      runIsolatedGit(repoRoot, ["remote", "add", "origin", originRoot]);
      runIsolatedGit(repoRoot, [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "commit",
        "--allow-empty",
        "-m",
        "fixture",
      ]);
      const sha = runIsolatedGit(repoRoot, ["rev-parse", "HEAD"]);

      const previous = {
        GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
        GIT_CONFIG_SYSTEM: process.env.GIT_CONFIG_SYSTEM,
        GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
        GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME,
        GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL,
        GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME,
        GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL,
        EMAIL: process.env.EMAIL,
      };

      process.env.GIT_CONFIG_GLOBAL = emptyConfig;
      process.env.GIT_CONFIG_SYSTEM = emptyConfig;
      process.env.GIT_CONFIG_NOSYSTEM = "1";
      delete process.env.GIT_AUTHOR_NAME;
      delete process.env.GIT_AUTHOR_EMAIL;
      delete process.env.GIT_COMMITTER_NAME;
      delete process.env.GIT_COMMITTER_EMAIL;
      delete process.env.EMAIL;

      try {
        createGitTag({ repoRoot }, "v0.2.0", sha);
      } finally {
        restoreEnv(previous);
      }

      const pointedSha = runIsolatedGit(repoRoot, ["rev-parse", "v0.2.0^{commit}"]);
      const tagger = runIsolatedGit(repoRoot, [
        "for-each-ref",
        "refs/tags/v0.2.0",
        "--format=%(taggername) %(taggeremail)",
      ]);
      const originSha = runIsolatedGit(originRoot, ["rev-parse", "v0.2.0^{commit}"]);
      const objectType = runIsolatedGit(repoRoot, ["cat-file", "-t", "v0.2.0"]);

      assert.equal(objectType, "tag");
      assert.equal(pointedSha, sha);
      assert.equal(originSha, sha);
      assert.equal(
        tagger,
        "github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>"
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(originRoot, { recursive: true, force: true });
    }
  });
});

function readGithubOutputs(filePath) {
  const outputs = {};
  for (const line of readFileSync(filePath, "utf8").trim().split("\n")) {
    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }
    outputs[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return outputs;
}

function npmPublishEligible(action) {
  return action === "publish";
}

describe("GitHub Actions publication outputs", () => {
  const targetSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  it("writes action, version, and tag to GITHUB_OUTPUT", () => {
    const outputFile = path.join(mkdtempSync(path.join(os.tmpdir(), "atlas-gh-out-")), "output");
    writePublicationGithubOutputs(
      { action: "publish", version: "0.2.0", tag: "v0.2.0" },
      { outputFile }
    );
    assert.deepEqual(readGithubOutputs(outputFile), {
      action: "publish",
      version: "0.2.0",
      tag: "v0.2.0",
    });
  });

  it("exports noop for post-release commits so npm publish is skipped", () => {
    const fixture = writePublicationFixture();
    const outputFile = path.join(fixture.dir, "github-output");
    const releaseSha = "cccccccccccccccccccccccccccccccccccccccc";
    const githubState = {
      existingTags: [{ name: "v0.2.0", sha: releaseSha }],
      existingReleases: [
        {
          tagName: "v0.2.0",
          sha: releaseSha,
          assets: [sbomAssetNameForCommit(releaseSha), "LICENSE"],
        },
      ],
      canonicalMainSha: targetSha,
    };

    const result = runPublication(
      {
        repoRoot: fixture.dir,
        dryRun: false,
        skipChecks: true,
        outputDir: fixture.outputDir,
        targetSha,
        outputFile,
      },
      {
        loadGithubState: () => githubState,
        waitForRequiredChecks() {},
        applyPublication() {
          throw new Error("noop must not mutate");
        },
        isCommitAncestor: (ancestorSha, descendantSha) =>
          ancestorSha === releaseSha && descendantSha === targetSha,
      }
    );

    const outputs = readGithubOutputs(outputFile);
    assert.equal(result.decision.action, "noop");
    assert.equal(outputs.action, "noop");
    assert.equal(outputs.version, "0.2.0");
    assert.equal(outputs.tag, "v0.2.0");
    assert.equal(npmPublishEligible(outputs.action), false);
  });

  it("exports publish for a genuine new release so npm publish is eligible", () => {
    const fixture = writePublicationFixture();
    const outputFile = path.join(fixture.dir, "github-output");

    const result = runPublication(
      {
        repoRoot: fixture.dir,
        dryRun: false,
        skipChecks: true,
        outputDir: fixture.outputDir,
        targetSha,
        outputFile,
      },
      {
        loadGithubState: () => ({
          existingTags: [],
          existingReleases: [],
          canonicalMainSha: targetSha,
        }),
        waitForRequiredChecks() {},
        applyPublication() {},
      }
    );

    const outputs = readGithubOutputs(outputFile);
    assert.equal(result.decision.action, "publish");
    assert.equal(outputs.action, "publish");
    assert.equal(npmPublishEligible(outputs.action), true);
  });

  it("exports repair actions without enabling npm publish", () => {
    const fixture = writePublicationFixture();
    const outputFile = path.join(fixture.dir, "github-output");

    const result = runPublication(
      {
        repoRoot: fixture.dir,
        dryRun: false,
        skipChecks: true,
        outputDir: fixture.outputDir,
        targetSha,
        outputFile,
      },
      {
        loadGithubState: () => ({
          existingTags: [{ name: "v0.2.0", sha: targetSha }],
          existingReleases: [],
          canonicalMainSha: targetSha,
        }),
        waitForRequiredChecks() {},
        applyPublication() {},
      }
    );

    const outputs = readGithubOutputs(outputFile);
    assert.equal(result.decision.action, "repair-release");
    assert.equal(outputs.action, "repair-release");
    assert.equal(npmPublishEligible(outputs.action), false);
  });

  it("exports the revalidated final decision after required checks", () => {
    const fixture = writePublicationFixture();
    const outputFile = path.join(fixture.dir, "github-output");
    const states = [
      {
        existingTags: [],
        existingReleases: [],
        canonicalMainSha: targetSha,
      },
      {
        existingTags: [{ name: "v0.2.0", sha: targetSha }],
        existingReleases: [
          {
            tagName: "v0.2.0",
            sha: targetSha,
            assets: [sbomAssetNameForCommit(targetSha), "LICENSE"],
          },
        ],
        canonicalMainSha: targetSha,
      },
    ];
    let loadCount = 0;

    const result = runPublication(
      {
        repoRoot: fixture.dir,
        dryRun: false,
        skipChecks: false,
        outputDir: fixture.outputDir,
        targetSha,
        outputFile,
      },
      {
        loadGithubState() {
          const state = states[loadCount];
          loadCount += 1;
          return state;
        },
        waitForRequiredChecks() {},
        applyPublication() {
          throw new Error("revalidated noop must not mutate");
        },
      }
    );

    const outputs = readGithubOutputs(outputFile);
    assert.equal(result.decision.action, "noop");
    assert.equal(outputs.action, "noop");
    assert.equal(npmPublishEligible(outputs.action), false);
  });
});

function restoreEnv(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function writePublicationFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "atlas-publish-dry-"));
  const outputDir = path.join(dir, "artifacts");
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "@atlas/monorepo", version: "0.2.0", private: true })
  );
  mkdirSync(path.join(dir, "apps/web"), { recursive: true });
  mkdirSync(path.join(dir, "packages/ui"), { recursive: true });
  mkdirSync(path.join(dir, "packages/config"), { recursive: true });
  mkdirSync(path.join(dir, "packages/consent"), { recursive: true });
  mkdirSync(path.join(dir, "packages/project"), { recursive: true });
  mkdirSync(path.join(dir, "packages/cli"), { recursive: true });
  mkdirSync(path.join(dir, "apps/reference"), { recursive: true });
  writeFileSync(
    path.join(dir, "apps/web/package.json"),
    JSON.stringify({ name: "@atlas/web", version: "0.2.0", private: true })
  );
  writeFileSync(
    path.join(dir, "packages/ui/package.json"),
    JSON.stringify({ name: "@atlas/ui", version: "0.2.0", private: true })
  );
  writeFileSync(
    path.join(dir, "packages/config/package.json"),
    JSON.stringify({ name: "@atlas/config", version: "0.2.0", private: true })
  );
  writeFileSync(
    path.join(dir, "packages/consent/package.json"),
    JSON.stringify({ name: "@atlas/consent", version: "0.2.0", private: true })
  );
  writeFileSync(
    path.join(dir, "packages/project/package.json"),
    JSON.stringify({ name: "@atlas/project", version: "0.2.0", private: true })
  );
  writeFileSync(
    path.join(dir, "packages/cli/package.json"),
    JSON.stringify({ name: "@blitzcraftlabs/atlas", version: "0.2.0" })
  );
  writeFileSync(
    path.join(dir, "apps/reference/package.json"),
    JSON.stringify({ name: "@atlas/reference", version: "0.2.0", private: true })
  );
  writeFileSync(path.join(dir, "CHANGELOG.md"), changelog020);
  writeFileSync(
    path.join(dir, "pnpm-lock.yaml"),
    `lockfileVersion: '9.0'\npackages:\n  'example@1.0.0':\n    resolution: {integrity: sha512-test}\n`
  );

  return {
    dir,
    outputDir,
    writeState(state) {
      const stateFile = path.join(dir, "state.json");
      writeFileSync(stateFile, JSON.stringify(state));
      return stateFile;
    },
  };
}
