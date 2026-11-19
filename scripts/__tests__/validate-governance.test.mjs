import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import {
  ATLAS_WORKSPACE_PACKAGES,
  CANONICAL_GOVERNANCE_DOC,
  PUBLIC_CLI_PACKAGE_NAME,
} from "../atlas-workspaces.mjs";
import { REPO_ROOT } from "../coverage-policy.mjs";
import { collectGovernanceErrors } from "../validate-governance.mjs";

/**
 * Every file validate-governance reads. If a new check reads another file, the
 * "accepts an unmodified copy" test fails and this list needs that file added.
 */
const GOVERNED_FILES = [
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "package.json",
  CANONICAL_GOVERNANCE_DOC,
  "docs/migrations/README.md",
  "docs/security/threat-model.md",
  "docs/how-we-build/security.md",
  "docs/public/faq.md",
  ".changeset/config.json",
  ".github/workflows/release.yml",
  "scripts/lib/release-consistency.mjs",
  "scripts/release-publication.mjs",
  "scripts/publish-npm-package.mjs",
  "scripts/lib/npm-publication.mjs",
  "node_modules/@changesets/cli/dist/changesets-cli.cjs.js",
  ...ATLAS_WORKSPACE_PACKAGES.map((pkg) => path.join(pkg.relativePath, "package.json")),
];

const WORKFLOW = ".github/workflows/release.yml";

describe("validate-governance", () => {
  let template;
  let root;

  before(() => {
    template = mkdtempSync(path.join(os.tmpdir(), "atlas-governance-template-"));
    for (const relativePath of GOVERNED_FILES) {
      mkdirSync(path.dirname(path.join(template, relativePath)), { recursive: true });
      cpSync(path.join(REPO_ROOT, relativePath), path.join(template, relativePath));
    }
  });
  after(() => rmSync(template, { recursive: true, force: true }));

  beforeEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = mkdtempSync(path.join(os.tmpdir(), "atlas-governance-"));
    cpSync(template, root, { recursive: true });
  });
  after(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function read(relativePath) {
    return readFileSync(path.join(root, relativePath), "utf8");
  }

  function write(relativePath, content) {
    writeFileSync(path.join(root, relativePath), content);
  }

  function editJson(relativePath, edit) {
    const value = JSON.parse(read(relativePath));
    edit(value);
    write(relativePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  /** Replace `from` with `to` inside one top-level job of release.yml only. */
  function editJob(jobId, from, to) {
    const lines = read(WORKFLOW).split("\n");
    const start = lines.indexOf(`  ${jobId}:`);
    assert.notEqual(start, -1, `release.yml has no ${jobId} job`);
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
        end = index;
        break;
      }
    }
    const job = lines.slice(start, end).join("\n");
    assert.ok(job.includes(from), `${jobId} job does not contain ${JSON.stringify(from)}`);
    lines.splice(start, end - start, ...job.replace(from, to).split("\n"));
    write(WORKFLOW, lines.join("\n"));
  }

  function assertFailsWith(pattern) {
    const errors = collectGovernanceErrors(root);
    assert.ok(
      errors.some((error) => pattern.test(error)),
      `expected an error matching ${pattern}, got:\n${errors.join("\n") || "(none)"}`
    );
  }

  it("accepts an unmodified copy of the repository", () => {
    assert.deepEqual(collectGovernanceErrors(root), []);
  });

  it("accepts the real repository", () => {
    assert.deepEqual(collectGovernanceErrors(REPO_ROOT), []);
  });

  it("does not leak errors from one run into the next", () => {
    write("README.md", "Atlas is open source.\n");
    assert.ok(collectGovernanceErrors(root).length > 0);
    assert.deepEqual(collectGovernanceErrors(REPO_ROOT), []);
  });

  describe("release workflow", () => {
    it("keeps the GitHub Release step from running while a Version PR is pending", () => {
      editJob("github-release", "needs.version-pr.outputs.has-changesets != 'true'", "true");
      assertFailsWith(/github-release job must skip publication when version-pr reports pending/);
    });

    it("keeps npm publish gated on the canonical GitHub Release action", () => {
      editJob("npm-publish", "needs.github-release.outputs.action == 'publish'", "true");
      assertFailsWith(/npm-publish/);
    });

    it("keeps npm publish packing from the fetched canonical tag", () => {
      editJob("npm-publish", "fetch-tags: true", "fetch-tags: false");
      assertFailsWith(/npm-publish job must fetch git tags/);
    });

    it("refuses a long-lived npm token in the publish job", () => {
      editJob(
        "npm-publish",
        "npm@11.5.1",
        "npm@11.5.1\n        env:\n          NODE_AUTH_TOKEN: x"
      );
      assertFailsWith(/must not use a long-lived NPM_TOKEN/);
    });

    it("keeps the publish job long enough for npm's malware scan window", () => {
      editJob("npm-publish", "timeout-minutes: 55", "timeout-minutes: 15");
      assertFailsWith(/publish-time malware scan window/);
    });

    it("keeps draft Releases private until npm publish succeeds", () => {
      editJob("finalize-release", "needs.npm-publish.result == 'success'", "always()");
      assertFailsWith(/finalize-release job must run only after npm-publish succeeds/);
    });

    it("requires GitHub Releases to be created as drafts", () => {
      const source = read("scripts/lib/release-consistency.mjs");
      assert.ok(source.includes('"--draft"'));
      write("scripts/lib/release-consistency.mjs", source.replace('"--draft",', ""));
      assertFailsWith(/must be created as drafts until npm publication/);
    });

    it("refuses continue-on-error anywhere in the release workflow", () => {
      editJob("sbom", "runs-on:", "continue-on-error: true\n    runs-on:");
      assertFailsWith(/must not use continue-on-error/);
    });

    it("reports a missing release workflow", () => {
      rmSync(path.join(root, WORKFLOW));
      assertFailsWith(/Missing \.github\/workflows\/release\.yml/);
    });
  });

  describe("packages and versions", () => {
    const cli = ATLAS_WORKSPACE_PACKAGES.find((pkg) => pkg.name === PUBLIC_CLI_PACKAGE_NAME);
    const privateWorkspace = ATLAS_WORKSPACE_PACKAGES.find((pkg) => pkg !== cli);

    it("requires every workspace version to match the root version", () => {
      editJson(path.join(privateWorkspace.relativePath, "package.json"), (pkg) => {
        pkg.version = "0.0.1";
      });
      assertFailsWith(new RegExp(`Version mismatch: .* ${privateWorkspace.name} is 0\\.0\\.1`));
    });

    it("keeps internal workspaces private so Changesets cannot publish them", () => {
      editJson(path.join(privateWorkspace.relativePath, "package.json"), (pkg) => {
        delete pkg.private;
      });
      assertFailsWith(/must remain private/);
    });

    it("keeps the CLI public with its bin and public access", () => {
      editJson(path.join(cli.relativePath, "package.json"), (pkg) => {
        pkg.publishConfig = { access: "restricted" };
        pkg.bin = { atlas: "./cli.js" };
      });
      assertFailsWith(/publishConfig\.access must be "public"/);
      assertFailsWith(/bin\.atlas must remain \.\/dist\/cli\.js/);
    });

    it("requires a changelog section for the current version", () => {
      editJson("package.json", (pkg) => {
        pkg.version = "99.0.0";
      });
      assertFailsWith(/CHANGELOG\.md has no section for current Atlas version 99\.0\.0/);
    });

    it("requires public Changesets access", () => {
      editJson(".changeset/config.json", (config) => {
        config.access = "restricted";
      });
      assertFailsWith(/\.changeset\/config\.json access must be "public"/);
    });

    it("requires the Apache-2.0 license everywhere", () => {
      editJson("package.json", (pkg) => {
        pkg.license = "MIT";
      });
      write("LICENSE", "MIT License\n");
      assertFailsWith(/package\.json license must be "Apache-2\.0" \(found: MIT\)/);
      assertFailsWith(/LICENSE does not appear to be Apache License 2\.0/);
    });
  });

  describe("documentation", () => {
    it("refuses an unqualified open-source claim", () => {
      write("docs/public/faq.md", `${read("docs/public/faq.md")}\nAtlas is open source.\n`);
      assertFailsWith(/docs\/public\/faq\.md must not claim unqualified open-source status/);
    });

    it("allows the qualified Apache-2.0 wording", () => {
      write(
        "docs/public/faq.md",
        `${read("docs/public/faq.md")}\nAtlas is open source under Apache-2.0.\n`
      );
      assert.deepEqual(collectGovernanceErrors(root), []);
    });

    it("requires the security and migration documents", () => {
      rmSync(path.join(root, "SECURITY.md"));
      rmSync(path.join(root, "docs/migrations/README.md"));
      assertFailsWith(/Missing security policy: SECURITY\.md/);
      assertFailsWith(/Missing migrations index/);
    });
  });
});
