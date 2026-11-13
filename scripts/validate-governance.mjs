import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import {
  ATLAS_TAG_PATTERN,
  ATLAS_WORKSPACE_PACKAGES,
  CANONICAL_GOVERNANCE_DOC,
  LEGACY_PACKAGE_TAG_PATTERN,
  PUBLIC_CLI_PACKAGE_NAME,
  readJson,
  readRootVersion,
  readWorkspaceVersions,
} from "./atlas-workspaces.mjs";
import { extractChangelogSection } from "./extract-changelog-section.mjs";

const errors = [];

function fail(message) {
  errors.push(message);
}

function stripYamlComments(content) {
  return content
    .split("\n")
    .map((line) => line.replace(/#.*$/, ""))
    .join("\n");
}

function assertFileExists(relativePath, label) {
  if (!existsSync(path.join(process.cwd(), relativePath))) {
    fail(`Missing ${label}: ${relativePath}`);
  }
}

function assertLicenseIsApache(relativePath) {
  const pkg = readJson(relativePath);
  if (pkg.license !== "Apache-2.0") {
    fail(`${relativePath} license must be "Apache-2.0" (found: ${pkg.license ?? "none"})`);
  }
}

function assertPrivateWorkspace(relativePath) {
  const pkg = readJson(relativePath);
  if (pkg.private !== true) {
    fail(`${relativePath} must remain private (not an independent npm product)`);
  }
}

function assertPublicCliPackage(relativePath) {
  const pkg = readJson(relativePath);
  if (pkg.private === true) {
    fail(`${relativePath} must not be private; it is Atlas's public npm CLI package`);
  }
  if (pkg.name !== PUBLIC_CLI_PACKAGE_NAME) {
    fail(`${relativePath} name must be ${PUBLIC_CLI_PACKAGE_NAME} (found: ${pkg.name ?? "none"})`);
  }
  if (pkg.bin?.atlas !== "./dist/cli.js") {
    fail(`${relativePath} bin.atlas must remain ./dist/cli.js`);
  }
  if (pkg.publishConfig?.access !== "public") {
    fail(`${relativePath} publishConfig.access must be "public"`);
  }
}

function checkLicenseFile() {
  const licensePath = path.join(process.cwd(), "LICENSE");
  if (!existsSync(licensePath)) {
    fail("Missing root LICENSE file");
    return;
  }

  const content = readFileSync(licensePath, "utf8");
  if (!content.includes("Apache License") || !content.includes("Version 2.0")) {
    fail("LICENSE does not appear to be Apache License 2.0");
  }
}

function checkVersionAlignment() {
  const rootVersion = readRootVersion();
  const workspaces = readWorkspaceVersions();

  for (const pkg of workspaces) {
    if (pkg.version !== rootVersion) {
      fail(`Version mismatch: root is ${rootVersion}, ${pkg.name} is ${pkg.version}`);
    }
  }

  const governanceDoc = readFileSync(path.join(process.cwd(), CANONICAL_GOVERNANCE_DOC), "utf8");
  if (!governanceDoc.includes("## Atlas 1.0 stability contract")) {
    fail(`${CANONICAL_GOVERNANCE_DOC} must define the Atlas 1.0 stability contract`);
  }
}

function checkChangelog() {
  const version = readRootVersion();
  const changelogPath = path.join(process.cwd(), "CHANGELOG.md");

  if (!existsSync(changelogPath)) {
    fail("Missing root CHANGELOG.md");
    return;
  }

  const changelog = readFileSync(changelogPath, "utf8");
  if (!extractChangelogSection(changelog, version)) {
    fail(`CHANGELOG.md has no section for current Atlas version ${version}`);
  }
}

function checkPackageScripts() {
  const pkg = readJson("package.json");
  if (pkg.scripts?.["docs:check"]?.includes("validate-governance")) {
    fail("docs:check must remain the documentation link checker");
  }
  if (!pkg.scripts?.["governance:check"]) {
    fail("Missing governance:check script");
  }
}

function extractNamedJob(workflow, jobId) {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line === `  ${jobId}:`);
  if (start === -1) {
    return null;
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join("\n");
}

function checkReleaseWorkflow() {
  const workflowPath = path.join(process.cwd(), ".github/workflows/release.yml");
  if (!existsSync(workflowPath)) {
    fail("Missing .github/workflows/release.yml");
    return;
  }

  const workflow = readFileSync(workflowPath, "utf8");

  if (workflow.includes("@atlas/ui@")) {
    fail("release.yml still references package-style @atlas/ui@ tags");
  }

  if (/changesets\/action[\s\S]{0,500}^\s+publish:\s+/m.test(workflow)) {
    fail("release.yml must not configure changesets/action npm publish");
  }

  if (!workflow.includes("workflow_dispatch")) {
    fail("release.yml must support workflow_dispatch for release rehearsal");
  }

  if (!/verify_version:/.test(workflow)) {
    fail("release.yml workflow_dispatch must accept an explicit verify_version input");
  }

  if (!workflow.includes("publish-atlas-release")) {
    fail(
      "release.yml must invoke publish-atlas-release for fail-closed GitHub Release publication"
    );
  }

  if (workflow.includes("continue-on-error")) {
    fail("release.yml must not use continue-on-error to mask release or SBOM failures");
  }

  const versionPrJob = extractNamedJob(workflow, "version-pr");
  if (!versionPrJob) {
    fail("release.yml is missing the version-pr job");
  } else {
    if (!/id:\s*changesets/.test(versionPrJob)) {
      fail("version-pr job must keep the Changesets Action step id `changesets`");
    }
    if (
      !/has-changesets:\s*\$\{\{\s*steps\.changesets\.outputs\.hasChangesets\s*\}\}/.test(
        versionPrJob
      )
    ) {
      fail(
        "version-pr job must expose steps.changesets.outputs.hasChangesets as the has-changesets job output"
      );
    }
    if (!/steps\.changesets\.outcome/.test(versionPrJob)) {
      fail("version-pr job must inspect steps.changesets.outcome when reporting Version PR status");
    }
    if (!/pullRequestNumber/.test(versionPrJob)) {
      fail("version-pr job must inspect pullRequestNumber when reporting Version PR creation");
    }
    if (
      /hasChangesets[\s\S]{0,180}Version PR opened or updated/.test(versionPrJob) ||
      /HAS_CHANGESETS[\s\S]{0,180}Version PR opened or updated/.test(versionPrJob)
    ) {
      fail(
        "version-pr reporting must not claim Version PR success solely because hasChangesets is true"
      );
    }
  }

  const publishJob = extractNamedJob(workflow, "github-release");
  if (!publishJob) {
    fail("release.yml is missing the github-release job");
  } else {
    if (!/permissions:[\s\S]*contents:\s*write/.test(publishJob)) {
      fail("github-release job must request contents: write to create the tag and Release");
    }
    if (!/permissions:[\s\S]*actions:\s*read/.test(publishJob)) {
      fail(
        "github-release job must request actions: read so publication can inspect required workflow runs"
      );
    }
    if (/packages:\s*write/.test(publishJob) || /id-token:\s*write/.test(publishJob)) {
      fail("github-release job must not request npm publish or provenance permissions");
    }
    if (
      !/needs:[\s\S]*\bsbom\b/.test(publishJob) ||
      !/needs:[\s\S]*\bversion-pr\b/.test(publishJob)
    ) {
      fail("github-release job must depend on both sbom and version-pr");
    }
    if (!/github\.event_name\s*==\s*'push'/.test(publishJob)) {
      fail("github-release job must remain push-gated");
    }
    if (!/needs\.version-pr\.outputs\.has-changesets\s*!=\s*'true'/.test(publishJob)) {
      fail("github-release job must skip publication when version-pr reports pending changesets");
    }
    if (!/id:\s*release/.test(publishJob)) {
      fail("github-release publish step must expose id `release` for downstream gating");
    }
    if (
      !/outputs:[\s\S]*action:\s*\$\{\{\s*steps\.release\.outputs\.action\s*\}\}/.test(publishJob)
    ) {
      fail("github-release job must expose the final publication action as a job output");
    }
  }

  const finalizeJob = extractNamedJob(workflow, "finalize-release");
  if (!finalizeJob) {
    fail("release.yml is missing the finalize-release job (draft Releases go public after npm)");
  } else {
    if (!/needs:[\s\S]*\bnpm-publish\b/.test(finalizeJob)) {
      fail("finalize-release job must depend on npm-publish");
    }
    if (!/needs\.npm-publish\.result\s*==\s*'success'/.test(finalizeJob)) {
      fail("finalize-release job must run only after npm-publish succeeds");
    }
    if (!/finalize-atlas-release\.mjs/.test(finalizeJob)) {
      fail("finalize-release job must invoke finalize-atlas-release.mjs");
    }
    if (/id-token:\s*write/.test(finalizeJob)) {
      fail("finalize-release job must not request npm provenance permissions");
    }
  }

  const publisherSource = readFileSync(
    path.join(process.cwd(), "scripts/lib/release-consistency.mjs"),
    "utf8"
  );
  if (!/"--draft"/.test(publisherSource)) {
    fail("GitHub Releases must be created as drafts until npm publication is verified");
  }

  const npmPublishJob = extractNamedJob(workflow, "npm-publish");
  if (!npmPublishJob) {
    fail("release.yml is missing the npm-publish job");
  } else {
    if (!/permissions:[\s\S]*id-token:\s*write/.test(npmPublishJob)) {
      fail("npm-publish job must request id-token: write for npm Trusted Publishing");
    }
    if (!/permissions:[\s\S]*contents:\s*read/.test(npmPublishJob)) {
      fail("npm-publish job must keep contents: read");
    }
    if (/contents:\s*write/.test(npmPublishJob)) {
      fail("npm-publish job must not request contents: write");
    }
    if (/packages:\s*write/.test(npmPublishJob)) {
      fail("npm-publish job must not request packages: write");
    }
    if (/NPM_TOKEN|NODE_AUTH_TOKEN/.test(npmPublishJob)) {
      fail("npm-publish job must not use a long-lived NPM_TOKEN");
    }
    if (!/publish-npm-package\.mjs/.test(npmPublishJob) || !/--oidc/.test(npmPublishJob)) {
      fail("npm-publish job must publish through publish-npm-package.mjs --oidc");
    }
    if (!/npm@11\.5\.1/.test(npmPublishJob)) {
      fail("npm-publish job must install npm@11.5.1 for Trusted Publishing");
    }
    if (!/node-version:\s*22\b/.test(stripYamlComments(npmPublishJob))) {
      fail("npm-publish job must keep consumer Node 22 and upgrade only the npm CLI");
    }
    if (/self-hosted/.test(npmPublishJob)) {
      fail("npm-publish job must use GitHub-hosted runners for npm Trusted Publishing");
    }
    if (
      !/needs:[\s\S]*\bgithub-release\b/.test(npmPublishJob) ||
      !/needs:[\s\S]*\bversion-pr\b/.test(npmPublishJob)
    ) {
      fail("npm-publish job must depend on github-release and version-pr");
    }
    if (!/github\.event_name\s*==\s*'push'/.test(npmPublishJob)) {
      fail("npm-publish job must remain push-gated");
    }
    if (!/needs\.version-pr\.outputs\.has-changesets\s*!=\s*'true'/.test(npmPublishJob)) {
      fail("npm-publish job must skip publication when version-pr reports pending changesets");
    }
    if (!/needs\.github-release\.outputs\.action\s*==\s*'publish'/.test(npmPublishJob)) {
      fail(
        "npm-publish job must run only when github-release reports the final publication action publish"
      );
    }
    if (!/fetch-tags:\s*true/.test(npmPublishJob)) {
      fail("npm-publish job must fetch git tags so HEAD can be the exact canonical vX.Y.Z tag");
    }
    if (!/steps\.npm\.outputs\.action\s*!=\s*'noop'/.test(npmPublishJob)) {
      fail(
        "npm-publish must not require a packed tarball when the exact npm version already exists"
      );
    }
    if (!/success\(\)\s*&&\s*steps\.npm\.outputs\.action\s*==\s*'publish'/.test(npmPublishJob)) {
      fail(
        "npm-publish consumer verification must run only after a successful publish step reports action publish"
      );
    }
    if (/workflow_dispatch/.test(npmPublishJob)) {
      fail("npm-publish job must not run on workflow_dispatch");
    }
    if (!/timeout-minutes:\s*55/.test(npmPublishJob)) {
      fail("npm-publish job must allow time for npm's publish-time malware scan window");
    }
  }

  const rehearsalJob = extractNamedJob(workflow, "rehearsal");
  if (!rehearsalJob) {
    fail("release.yml is missing the rehearsal job");
  } else if (
    !/github\.event_name\s*==\s*'workflow_dispatch'/.test(rehearsalJob) ||
    !/github\.event\.inputs\.verify_version\s*==\s*''/.test(rehearsalJob)
  ) {
    fail("rehearsal job must run only on workflow_dispatch when verify_version is empty");
  }

  const verifyRegistryJob = extractNamedJob(workflow, "verify-registry");
  if (!verifyRegistryJob) {
    fail("release.yml is missing the verify-registry job");
  } else {
    if (
      !/github\.event_name\s*==\s*'workflow_dispatch'/.test(verifyRegistryJob) ||
      !/github\.event\.inputs\.verify_version\s*!=\s*''/.test(verifyRegistryJob)
    ) {
      fail(
        "verify-registry job must run only on workflow_dispatch with an explicit verify_version"
      );
    }
    if (/publish-npm-package|--oidc/.test(verifyRegistryJob)) {
      fail("verify-registry job must not attempt npm publication");
    }
    if (/id-token:\s*write/.test(verifyRegistryJob)) {
      fail("verify-registry job must not request Trusted Publishing credentials");
    }
    if (!/distribution:verify-registry/.test(verifyRegistryJob)) {
      fail("verify-registry job must run distribution:verify-registry against the public registry");
    }
    if (!/ATLAS_VERIFY_VERSION/.test(verifyRegistryJob)) {
      fail("verify-registry job must pass verify_version through ATLAS_VERIFY_VERSION");
    }
    if (/artifacts\/npm|\.tgz/.test(verifyRegistryJob)) {
      fail("verify-registry job must not fall back to a local tarball");
    }
  }

  const publisherPath = path.join(process.cwd(), "scripts/release-publication.mjs");
  if (!existsSync(publisherPath)) {
    fail("Missing scripts/release-publication.mjs");
  } else {
    const publisher = readFileSync(publisherPath, "utf8");
    if (!publisher.includes("PENDING_CHANGESETS")) {
      fail("publisher must keep PENDING_CHANGESETS rejection as a safety backstop");
    }
  }

  const npmPublisherPath = path.join(process.cwd(), "scripts/publish-npm-package.mjs");
  const npmPublicationLibPath = path.join(process.cwd(), "scripts/lib/npm-publication.mjs");
  if (!existsSync(npmPublisherPath) || !existsSync(npmPublicationLibPath)) {
    fail("Missing npm publication scripts");
  } else {
    const npmPublisher = readFileSync(npmPublisherPath, "utf8");
    const npmPublicationLib = readFileSync(npmPublicationLibPath, "utf8");
    if (!npmPublicationLib.includes("stripNpmAuthEnv")) {
      fail("npm publication library must strip long-lived npm tokens before OIDC publish");
    }
    if (!npmPublicationLib.includes("runNpmPublication")) {
      fail("npm publication library must orchestrate query-first publication");
    }
    if (!npmPublicationLib.includes("requireReleaseTag: true")) {
      fail("unpublished npm versions must pack with requireReleaseTag: true");
    }
    if (!npmPublisher.includes("GITHUB_ACTIONS") && !npmPublicationLib.includes("GITHUB_ACTIONS")) {
      fail("npm publisher must refuse OIDC publish outside GitHub Actions");
    }
    if (!npmPublisher.includes("runNpmPublication")) {
      fail("npm publisher must orchestrate through runNpmPublication");
    }
    if (!npmPublicationLib.includes("publishExactTarball")) {
      fail("npm publisher must publish the hashed tarball rather than rebuilding");
    }
    if (!npmPublicationLib.includes("waitForNpmPackageVersion")) {
      fail("npm publication must wait for public registry visibility after npm accepts publish");
    }
    if (!npmPublicationLib.includes("npm accepted publish; waiting for registry availability")) {
      fail("npm publication must not report Published immediately after npm publish exits 0");
    }
  }

  const sbomJob = extractNamedJob(workflow, "sbom");
  if (!sbomJob) {
    fail("release.yml is missing the sbom job");
  } else {
    const uncommentedSbomJob = stripYamlComments(sbomJob);
    if (!/node-version:\s*22\b/.test(uncommentedSbomJob)) {
      fail("SBOM job must keep Node.js 22");
    }
    if (!/package-manager-cache:\s*false/.test(uncommentedSbomJob)) {
      fail(
        "SBOM job must set setup-node package-manager-cache: false because it never runs pnpm install"
      );
    }
    if (/\bpnpm install\b/.test(uncommentedSbomJob)) {
      fail("SBOM job must not run pnpm install");
    }
    if (uncommentedSbomJob.includes("cache: pnpm")) {
      fail(
        "SBOM job must not configure setup-node cache: pnpm unless it installs dependencies (empty cache path fails the post-step)"
      );
    }
  }

  for (const jobId of [
    "rehearsal",
    "version-pr",
    "github-release",
    "npm-publish",
    "verify-registry",
  ]) {
    const job = extractNamedJob(workflow, jobId);
    if (!job) {
      fail(`release.yml is missing the ${jobId} job`);
    } else if (!stripYamlComments(job).includes("cache: pnpm")) {
      fail(`${jobId} job must keep setup-node cache: pnpm because it runs pnpm install`);
    }
  }
}

function checkGovernanceDocLinks() {
  const readme = readFileSync(path.join(process.cwd(), "README.md"), "utf8");
  if (!readme.includes("releases-and-governance.md")) {
    fail("README.md must link to docs/how-we-build/releases-and-governance.md");
  }
}

function checkOssWording() {
  const files = ["README.md", "docs/public/faq.md", "docs/how-we-build/releases-and-governance.md"];

  for (const file of files) {
    const content = readFileSync(path.join(process.cwd(), file), "utf8");
    if (/Atlas is open source(?!\s+under)/i.test(content)) {
      fail(`${file} must not claim unqualified open-source status; qualify with Apache-2.0`);
    }
  }
}

function checkChangesetAccessPolicy() {
  const changesetConfig = readJson(".changeset/config.json");
  if (changesetConfig.access !== "public") {
    fail(
      '.changeset/config.json access must be "public" so @blitzcraftlabs/atlas cannot publish as restricted'
    );
  }

  for (const pkg of ATLAS_WORKSPACE_PACKAGES) {
    const manifestPath = path.join(pkg.relativePath, "package.json");
    const manifest = readJson(manifestPath);
    if (pkg.name === PUBLIC_CLI_PACKAGE_NAME) {
      continue;
    }
    if (manifest.private !== true) {
      fail(`${manifestPath} must remain private so Changesets public access cannot publish it`);
    }
    if (manifest.publishConfig?.access === "public") {
      fail(`${manifestPath} must not declare publishConfig.access public`);
    }
  }

  const changesetsPublish = path.join(
    process.cwd(),
    "node_modules/@changesets/cli/dist/changesets-cli.cjs.js"
  );
  if (!existsSync(changesetsPublish)) {
    fail("Missing @changesets/cli publish implementation for access-policy verification");
    return;
  }
  const publishSource = readFileSync(changesetsPublish, "utf8");
  if (
    !publishSource.includes(
      "publishConfig === null || publishConfig === void 0 ? void 0 : publishConfig.access) || access"
    )
  ) {
    fail(
      "@changesets/cli must continue to prefer package publishConfig.access over the global Changesets access setting"
    );
  }
}

function checkTagFormat(tag) {
  if (!ATLAS_TAG_PATTERN.test(tag)) {
    fail(`Invalid Atlas tag format "${tag}" (expected vX.Y.Z)`);
  }

  if (LEGACY_PACKAGE_TAG_PATTERN.test(tag)) {
    fail(`Tag "${tag}" uses legacy package-style format; use vX.Y.Z`);
  }
}

function main() {
  console.log("Validating Atlas governance…");

  assertFileExists("LICENSE", "license file");
  assertFileExists(CANONICAL_GOVERNANCE_DOC, "governance documentation");
  assertFileExists("CHANGELOG.md", "changelog");
  assertFileExists("docs/migrations/README.md", "migrations index");
  assertFileExists("SECURITY.md", "security policy");
  assertFileExists("docs/security/threat-model.md", "threat model");
  assertFileExists("docs/how-we-build/security.md", "security engineering documentation");

  checkLicenseFile();
  assertLicenseIsApache("package.json");

  for (const pkg of ATLAS_WORKSPACE_PACKAGES) {
    const manifestPath = path.join(pkg.relativePath, "package.json");
    assertLicenseIsApache(manifestPath);
    if (pkg.name === PUBLIC_CLI_PACKAGE_NAME) {
      assertPublicCliPackage(manifestPath);
    } else {
      assertPrivateWorkspace(manifestPath);
    }
  }

  checkVersionAlignment();
  checkChangelog();
  checkPackageScripts();
  checkReleaseWorkflow();
  checkGovernanceDocLinks();
  checkOssWording();
  checkChangesetAccessPolicy();

  const version = readRootVersion();
  checkTagFormat(`v${version}`);

  if (errors.length > 0) {
    console.error("Governance validation failed:\n");
    for (const error of errors) {
      console.error(`  ✗ ${error}`);
    }
    process.exit(1);
  }

  console.log(`✓ Atlas governance checks passed (version ${version})`);
}

main();
