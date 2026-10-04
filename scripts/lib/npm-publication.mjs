/**
 * Fail-closed npm publication invariants for `@blitzcraftlabs/atlas`.
 *
 * Pack once, validate that exact tarball, then publish or hand the same file
 * to a maintainer. Never rebuild between validation and publication.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { loadPublishedCatalogVerifier } from "../../packages/cli/scripts/load-published-catalog-verifier.mjs";
import {
  ATLAS_TAG_PATTERN,
  ATLAS_WORKSPACE_PACKAGES,
  PUBLIC_CLI_PACKAGE_NAME,
  PUBLIC_CLI_RELATIVE_PATH,
  PUBLIC_CLI_WORKSPACE_BUILD_ARGS,
  readJson,
  readRootVersion,
} from "../atlas-workspaces.mjs";
import { parseSemver } from "../semver-utils.mjs";
import {
  assertPublicCliManifest,
  collectPackedFileIssues,
  collectRuntimeWorkspaceProtocolLeaks,
} from "./npm-publish-dry-run.mjs";

export const NPM_REGISTRY_URL = "https://registry.npmjs.org";
export const NPM_ARTIFACT_RELATIVE_DIR = path.join("artifacts", "npm");
export const NPM_TRUSTED_PUBLISHING_MIN_NPM = "11.5.1";
export const NPM_TRUSTED_PUBLISHING_MIN_NODE = "22.14.0";
export const NPM_PUBLISH_ARGS = Object.freeze(["--access", "public", "--ignore-scripts"]);
export const NPM_OIDC_PUBLISH_ARGS = Object.freeze([...NPM_PUBLISH_ARGS, "--provenance"]);
/** Wall-clock bound for npm's publish-time malware scan before the version document is public. */
export const NPM_REGISTRY_AVAILABILITY_TIMEOUT_MS = 15 * 60 * 1000;
/** Poll interval for public version-document queries. Must not busy-loop. */
export const NPM_REGISTRY_AVAILABILITY_POLL_INTERVAL_MS = 12_000;
const REDACTED_SECRET = "[redacted]";

export const NPM_PUBLICATION_ACTIONS = Object.freeze({
  publish: "publish",
  noop: "noop",
  bootstrapRequired: "bootstrap-required",
});

const AUTH_ENV_KEYS = Object.freeze([
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
  "NPM_CONFIG_TOKEN",
  "npm_config_token",
  "_authToken",
]);

const AUTH_ENV_SUFFIXES = Object.freeze([":_authToken", ":_auth", ":_password"]);

/**
 * @param {string} version
 */
export function expectedGitTag(version) {
  return `v${version}`;
}

/**
 * @param {{
 *   expectedTag: string;
 *   headSha?: string | null;
 *   exactTag?: string | null;
 *   taggedSha?: string | null;
 *   porcelain?: string;
 * }} checkout
 * @returns {string[]}
 */
export function collectCanonicalReleaseCheckoutIssues(checkout) {
  const issues = [];
  const porcelain = checkout.porcelain?.trim() ?? "";
  if (porcelain.length > 0) {
    issues.push("working tree is dirty; pack the canonical release tag, not a local worktree");
  }
  if (!checkout.headSha) {
    issues.push("unable to resolve git HEAD");
  }
  if (!checkout.exactTag) {
    issues.push(`HEAD is not the exact git tag ${checkout.expectedTag}`);
  } else if (checkout.exactTag !== checkout.expectedTag) {
    issues.push(`exact tag is ${checkout.exactTag}, expected ${checkout.expectedTag}`);
  }
  if (checkout.headSha && checkout.taggedSha && checkout.headSha !== checkout.taggedSha) {
    issues.push(
      `HEAD ${checkout.headSha} does not match ${checkout.expectedTag} commit ${checkout.taggedSha}`
    );
  }
  return issues;
}

/**
 * @param {string} repoRoot
 * @param {string} expectedTag
 */
export function readCanonicalReleaseCheckout(repoRoot, expectedTag) {
  assertSafeNpmIdentity({
    packageName: PUBLIC_CLI_PACKAGE_NAME,
    tag: expectedTag,
    version: expectedTag.slice(1),
  });
  const head = runProcess("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
  const exact = runProcess("git", ["describe", "--tags", "--exact-match"], { cwd: repoRoot });
  const tagged = runProcess("git", ["rev-parse", `${expectedTag}^{commit}`], { cwd: repoRoot });
  const status = runProcess("git", ["status", "--porcelain"], { cwd: repoRoot });
  return {
    expectedTag,
    headSha: head.status === 0 ? head.stdout.trim() : null,
    exactTag: exact.status === 0 ? exact.stdout.trim() : null,
    taggedSha: tagged.status === 0 ? tagged.stdout.trim() : null,
    porcelain: status.status === 0 ? status.stdout : status.stderr,
  };
}

/**
 * @param {string} repoRoot
 * @param {string} expectedTag
 */
export function assertCanonicalReleaseCheckout(repoRoot, expectedTag) {
  const checkout = readCanonicalReleaseCheckout(repoRoot, expectedTag);
  const issues = collectCanonicalReleaseCheckoutIssues(checkout);
  if (issues.length > 0) {
    throw new Error(
      `Refusing to pack a non-canonical checkout for ${expectedTag}:\n${issues.join("\n")}`
    );
  }
  return checkout;
}

/**
 * @param {string} packageName
 * @param {string} version
 */
export function canonicalTarballFileName(packageName, version) {
  assertSafeNpmIdentity({ packageName, version });
  return `${packageName.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
}

/**
 * @param {{ packageName?: unknown; version?: unknown; tag?: unknown }} value
 */
export function assertSafeNpmIdentity(value) {
  const packageName = value.packageName;
  if (packageName !== PUBLIC_CLI_PACKAGE_NAME) {
    throw new Error(
      `Refusing unsafe package identity ${String(packageName)}; only ${PUBLIC_CLI_PACKAGE_NAME} may be published`
    );
  }

  const version = value.version;
  if (typeof version !== "string" || parseSemver(version) === null) {
    throw new Error(`Refusing unsafe npm version ${JSON.stringify(version)}`);
  }

  if (value.tag !== undefined) {
    if (typeof value.tag !== "string" || !ATLAS_TAG_PATTERN.test(value.tag)) {
      throw new Error(`Refusing unsafe git tag ${JSON.stringify(value.tag)}`);
    }
    if (value.tag !== expectedGitTag(version)) {
      throw new Error(`Git tag ${value.tag} does not match version ${version}`);
    }
  }
}

/**
 * @param {string} repoRoot
 */
export function assertPrivateInternalWorkspaces(repoRoot) {
  /** @type {string[]} */
  const issues = [];
  for (const pkg of ATLAS_WORKSPACE_PACKAGES) {
    const manifest = readJson(path.join(pkg.relativePath, "package.json"), repoRoot);
    if (pkg.name === PUBLIC_CLI_PACKAGE_NAME) {
      if (manifest.private === true) {
        issues.push(`${pkg.relativePath} must not be private`);
      }
      continue;
    }
    if (manifest.private !== true) {
      issues.push(`${pkg.name} must remain private`);
    }
    if (manifest.publishConfig?.access === "public") {
      issues.push(`${pkg.name} must not declare publishConfig.access public`);
    }
  }
  if (issues.length > 0) {
    throw new Error(`Internal workspaces are not publication-safe:\n${issues.join("\n")}`);
  }
}

/**
 * @param {string} repoRoot
 */
export function readPublicationIdentity(repoRoot) {
  const rootVersion = readRootVersion(repoRoot);
  const cliManifest = readJson(path.join(PUBLIC_CLI_RELATIVE_PATH, "package.json"), repoRoot);
  const cliVersion = typeof cliManifest.version === "string" ? cliManifest.version : "";
  const identity = {
    packageName: PUBLIC_CLI_PACKAGE_NAME,
    version: cliVersion,
    rootVersion,
    cliVersion,
    tag: expectedGitTag(cliVersion),
  };
  assertSafeNpmIdentity(identity);
  return identity;
}

/**
 * @param {{
 *   packageName: string;
 *   version: string;
 *   rootVersion: string;
 *   cliVersion: string;
 *   tag: string;
 *   catalogCurrent?: string | null;
 *   packedName?: string | null;
 *   packedVersion?: string | null;
 *   requestedVersion?: string | null;
 * }} identity
 * @returns {string[]}
 */
export function collectPublicationIdentityIssues(identity) {
  const issues = [];
  if (identity.packageName !== PUBLIC_CLI_PACKAGE_NAME) {
    issues.push(`package name is ${identity.packageName}, expected ${PUBLIC_CLI_PACKAGE_NAME}`);
  }
  if (identity.version !== identity.rootVersion) {
    issues.push(
      `CLI version ${identity.version} does not match root version ${identity.rootVersion}`
    );
  }
  if (identity.version !== identity.cliVersion) {
    issues.push(`CLI version fields disagree (${identity.version} vs ${identity.cliVersion})`);
  }
  if (identity.tag !== expectedGitTag(identity.version)) {
    issues.push(`expected git tag is ${identity.tag}, wanted ${expectedGitTag(identity.version)}`);
  }
  if (identity.catalogCurrent && identity.catalogCurrent !== identity.version) {
    issues.push(
      `release catalog current ${identity.catalogCurrent} does not match ${identity.version}`
    );
  }
  if (identity.packedName && identity.packedName !== PUBLIC_CLI_PACKAGE_NAME) {
    issues.push(
      `packed package name is ${identity.packedName}, expected ${PUBLIC_CLI_PACKAGE_NAME}`
    );
  }
  if (identity.packedVersion && identity.packedVersion !== identity.version) {
    issues.push(
      `packed version ${identity.packedVersion} does not match identity ${identity.version}`
    );
  }
  if (identity.requestedVersion && identity.requestedVersion !== identity.version) {
    issues.push(
      `requested npm version ${identity.requestedVersion} does not match identity ${identity.version}`
    );
  }
  return issues;
}

/**
 * @param {Parameters<typeof collectPublicationIdentityIssues>[0]} identity
 */
export function assertPublicationIdentity(identity) {
  assertSafeNpmIdentity(identity);
  const issues = collectPublicationIdentityIssues(identity);
  if (issues.length > 0) {
    throw new Error(`npm publication identity mismatch:\n${issues.join("\n")}`);
  }
}

/**
 * @param {string} left
 * @param {string} right
 */
export function compareDotVersions(left, right) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
    if (!match) {
      throw new Error(`Invalid dotted version ${JSON.stringify(value)}`);
    }
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }
  return 0;
}

/**
 * @param {string} actual
 * @param {string} minimum
 */
export function isVersionAtLeast(actual, minimum) {
  return compareDotVersions(actual, minimum) >= 0;
}

/**
 * @param {{ nodeVersion?: string; npmVersion?: string }} versions
 */
export function collectTrustedPublishingToolchainIssues(versions) {
  const issues = [];
  const nodeVersion = versions.nodeVersion ?? "";
  const npmVersion = versions.npmVersion ?? "";
  if (!isVersionAtLeast(nodeVersion, NPM_TRUSTED_PUBLISHING_MIN_NODE)) {
    issues.push(
      `Node ${nodeVersion || "(missing)"} is below Trusted Publishing minimum ${NPM_TRUSTED_PUBLISHING_MIN_NODE}`
    );
  }
  if (!isVersionAtLeast(npmVersion, NPM_TRUSTED_PUBLISHING_MIN_NPM)) {
    issues.push(
      `npm ${npmVersion || "(missing)"} is below Trusted Publishing minimum ${NPM_TRUSTED_PUBLISHING_MIN_NPM}`
    );
  }
  return issues;
}

/**
 * @param {NodeJS.ProcessEnv} [sourceEnv]
 * @returns {NodeJS.ProcessEnv}
 */
export function stripNpmAuthEnv(sourceEnv = process.env) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...sourceEnv };
  for (const key of Object.keys(env)) {
    if (AUTH_ENV_KEYS.includes(key)) {
      delete env[key];
      continue;
    }
    if (AUTH_ENV_SUFFIXES.some((suffix) => key.endsWith(suffix))) {
      delete env[key];
    }
  }
  return env;
}

/**
 * Redact credential-shaped tokens from npm CLI output before logging.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function redactNpmProcessOutput(text) {
  if (typeof text !== "string" || text.length === 0) {
    return "";
  }
  return text
    .replace(/npm_[A-Za-z0-9._-]{8,}/g, REDACTED_SECRET)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED_SECRET)
    .replace(/Bearer\s+\S+/gi, `Bearer ${REDACTED_SECRET}`)
    .replace(
      /((?:NPM_TOKEN|NODE_AUTH_TOKEN|_authToken|_auth|_password)["'\s:=]+)[^\s'"]+/gi,
      `$1${REDACTED_SECRET}`
    );
}

/**
 * @param {{ stdout?: unknown; stderr?: unknown } | null | undefined} result
 * @returns {string}
 */
export function formatNpmPublishProcessOutput(result) {
  if (!result || typeof result !== "object") {
    return "";
  }
  const stdout = redactNpmProcessOutput(result.stdout).trimEnd();
  const stderr = redactNpmProcessOutput(result.stderr).trimEnd();
  const parts = [];
  if (stdout) {
    parts.push(`npm publish stdout:\n${stdout}`);
  }
  if (stderr) {
    parts.push(`npm publish stderr:\n${stderr}`);
  }
  return parts.join("\n");
}

/**
 * @param {number} ms
 */
function sleepMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * @param {string} tarballPath
 */
export function hashFileSha256(tarballPath) {
  return createHash("sha256").update(readFileSync(tarballPath)).digest("hex");
}

/**
 * @param {string} tarballPath
 */
export function buildManualPublishCommand(tarballPath) {
  if (!tarballPath.endsWith(".tgz") || tarballPath.includes("\0")) {
    throw new Error(`Refusing unsafe tarball path ${JSON.stringify(tarballPath)}`);
  }
  return ["npm", "publish", tarballPath, ...NPM_PUBLISH_ARGS].join(" ");
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd: string; env?: NodeJS.ProcessEnv; timeout?: number }} options
 */
export function runProcess(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: options.timeout ?? 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  const timedOut = Boolean(
    result.error && "code" in result.error && result.error.code === "ETIMEDOUT"
  );
  return {
    status: timedOut ? null : (result.status ?? (result.error ? 1 : 0)),
    stdout:
      typeof result.stdout === "string" ? result.stdout : (result.stdout?.toString("utf8") ?? ""),
    stderr:
      typeof result.stderr === "string" ? result.stderr : (result.stderr?.toString("utf8") ?? ""),
    timedOut,
    error: result.error instanceof Error ? result.error.message : "",
  };
}

/**
 * @param {string} tarballPath
 * @returns {string[]}
 */
export function listTarballEntries(tarballPath) {
  const result = runProcess("tar", ["-tzf", tarballPath], {
    cwd: path.dirname(tarballPath),
    timeout: 30_000,
  });
  if (result.status !== 0 || result.timedOut) {
    throw new Error(
      `Unable to list tarball ${tarballPath}: ${result.stderr || result.error || result.stdout}`
    );
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * @param {string} tarballPath
 * @param {string} entry
 */
export function readTarballFile(tarballPath, entry) {
  if (entry.includes("\0") || entry.startsWith("-")) {
    throw new Error(`Refusing unsafe tarball entry ${JSON.stringify(entry)}`);
  }
  const result = runProcess("tar", ["-xOf", tarballPath, entry], {
    cwd: path.dirname(tarballPath),
    timeout: 30_000,
  });
  if (result.status !== 0 || result.timedOut) {
    throw new Error(
      `Unable to read ${entry} from ${tarballPath}: ${result.stderr || result.error || result.stdout}`
    );
  }
  return result.stdout;
}

/**
 * @param {string} tarballPath
 * @param {{
 *   version: string;
 *   packageName?: string;
 * }} expected
 */
export function validatePackedTarball(tarballPath, expected) {
  assertSafeNpmIdentity({
    packageName: expected.packageName ?? PUBLIC_CLI_PACKAGE_NAME,
    version: expected.version,
  });
  if (!existsSync(tarballPath)) {
    throw new Error(`Packed tarball is missing: ${tarballPath}`);
  }
  if (!tarballPath.endsWith(".tgz")) {
    throw new Error(`Refusing non-tarball publication artifact: ${tarballPath}`);
  }

  const entries = listTarballEntries(tarballPath);
  const packedFileIssues = collectPackedFileIssues(entries);
  const manifest = JSON.parse(readTarballFile(tarballPath, "package/package.json"));
  packedFileIssues.push(...assertPublicCliManifest(manifest));
  packedFileIssues.push(
    ...collectRuntimeWorkspaceProtocolLeaks(manifest).map(
      (leak) => `packed runtime workspace dependency ${leak}`
    )
  );

  if (manifest.name !== PUBLIC_CLI_PACKAGE_NAME) {
    packedFileIssues.push(
      `packed name is ${String(manifest.name)}, expected ${PUBLIC_CLI_PACKAGE_NAME}`
    );
  }
  if (manifest.version !== expected.version) {
    packedFileIssues.push(
      `packed version is ${String(manifest.version)}, expected ${expected.version}`
    );
  }

  const catalog = JSON.parse(readTarballFile(tarballPath, "package/assets/releases/catalog.json"));
  if (catalog.current !== expected.version) {
    packedFileIssues.push(
      `packed catalog current is ${String(catalog.current)}, expected ${expected.version}`
    );
  }

  const cliJs = readTarballFile(tarballPath, "package/dist/cli.js");
  if (!cliJs.startsWith("#!/usr/bin/env node\n")) {
    packedFileIssues.push("packed dist/cli.js is missing the Node shebang");
  }

  const bootstrap = JSON.parse(
    readTarballFile(tarballPath, "package/assets/bootstrap/manifest.json")
  );
  if (bootstrap.atlasVersion !== expected.version) {
    packedFileIssues.push(
      `packed bootstrap atlasVersion is ${String(bootstrap.atlasVersion)}, expected ${expected.version}`
    );
  }

  if (packedFileIssues.length > 0) {
    throw new Error(`Packed tarball is not publication-safe:\n${packedFileIssues.join("\n")}`);
  }

  return {
    entries,
    manifest,
    catalog,
    sha256: hashFileSha256(tarballPath),
    bytes: statSync(tarballPath).size,
  };
}

function queryPublishedCliVersions(cwd) {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(pnpm, ["view", PUBLIC_CLI_PACKAGE_NAME, "versions", "--json"], {
    cwd,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(
      `Refusing to pack an upgrade catalog without verified published ${PUBLIC_CLI_PACKAGE_NAME} versions.\n${result.stderr || result.stdout || "pnpm view failed"}`
    );
  }
  const parsed = JSON.parse(result.stdout);
  if (!Array.isArray(parsed) || parsed.some((version) => typeof version !== "string")) {
    throw new Error("pnpm view versions did not return a string array");
  }
  return parsed;
}

/**
 * Prove the packed catalog matches npm-published predecessors.
 *
 * Loads the TypeScript catalog rules through a maintainer esbuild bundle.
 * Internal upgrade modules are not independently require-able CLI build outputs.
 *
 * @param {string} packageRoot
 * @param {{ current: string; supportedVersions: string[] }} catalog
 * @param {string[]} publishedVersions
 */
export function assertPackedPublishedUpgradeCatalog(packageRoot, catalog, publishedVersions) {
  const verifier = loadPublishedCatalogVerifier();
  const snapshots = verifier.listProductionSnapshotVersions(
    verifier.sourceProductionReleasesRoot(packageRoot)
  );
  verifier.assertUpgradeCatalogMatchesPublishedIdentity({
    catalog,
    snapshotVersions: snapshots,
    publishedVersions,
  });
}

/**
 * @param {{
 *   repoRoot: string;
 *   destinationDir?: string;
 *   skipBuild?: boolean;
 *   requireReleaseTag?: boolean;
 *   pnpmCommand?: string;
 *   env?: NodeJS.ProcessEnv;
 *   verifyPublishedCatalog?: boolean;
 *   publishedVersions?: string[];
 * }} options
 */
export function packExactPublicCliTarball(options) {
  const repoRoot = options.repoRoot;
  assertPrivateInternalWorkspaces(repoRoot);
  const identity = readPublicationIdentity(repoRoot);
  assertPublicationIdentity(identity);
  const checkout = options.requireReleaseTag
    ? assertCanonicalReleaseCheckout(repoRoot, identity.tag)
    : null;

  const env = {
    ...stripNpmAuthEnv(options.env ?? process.env),
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    npm_config_funding: "false",
    npm_config_audit: "false",
    npm_config_update_notifier: "false",
  };
  const pnpmCommand = options.pnpmCommand ?? "pnpm";
  const packageRoot = path.join(repoRoot, PUBLIC_CLI_RELATIVE_PATH);
  const destinationDir = options.destinationDir ?? path.join(repoRoot, NPM_ARTIFACT_RELATIVE_DIR);
  mkdirSync(destinationDir, { recursive: true });

  if (!options.skipBuild) {
    const build = runProcess(pnpmCommand, PUBLIC_CLI_WORKSPACE_BUILD_ARGS, {
      cwd: repoRoot,
      env,
      timeout: 5 * 60 * 1000,
    });
    if (build.status !== 0 || build.timedOut) {
      throw new Error(
        `CLI build failed (${build.timedOut ? "timed out" : build.status})\nstdout:\n${build.stdout}\nstderr:\n${build.stderr}`
      );
    }
  }

  const rebuiltIdentity = readPublicationIdentity(repoRoot);
  assertPublicationIdentity(rebuiltIdentity);

  const stagingDir = path.join(destinationDir, ".pack-staging");
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  try {
    const pack = runProcess(pnpmCommand, ["pack", "--pack-destination", stagingDir], {
      cwd: packageRoot,
      env,
      timeout: 3 * 60 * 1000,
    });
    if (pack.status !== 0 || pack.timedOut) {
      throw new Error(
        `pnpm pack failed (${pack.timedOut ? "timed out" : pack.status})\nstdout:\n${pack.stdout}\nstderr:\n${pack.stderr}`
      );
    }

    const names = readdirSync(stagingDir).filter((name) => name.endsWith(".tgz"));
    if (names.length !== 1 || names[0] === undefined) {
      throw new Error(
        `Expected exactly one packed tarball, found: ${names.join(", ") || "(none)"}`
      );
    }

    const stagedPath = path.join(stagingDir, names[0]);
    const canonicalName = canonicalTarballFileName(
      PUBLIC_CLI_PACKAGE_NAME,
      rebuiltIdentity.version
    );
    if (names[0] !== canonicalName) {
      throw new Error(`Packed filename is ${names[0]}, expected ${canonicalName}`);
    }

    const packed = validatePackedTarball(stagedPath, rebuiltIdentity);
    if (options.verifyPublishedCatalog !== false) {
      assertPackedPublishedUpgradeCatalog(
        packageRoot,
        packed.catalog,
        options.publishedVersions ?? queryPublishedCliVersions(repoRoot)
      );
    }
    assertPublicationIdentity({
      ...rebuiltIdentity,
      catalogCurrent: packed.catalog.current,
      packedName: packed.manifest.name,
      packedVersion: packed.manifest.version,
    });
    const finalPath = path.join(destinationDir, canonicalName);
    copyFileSync(stagedPath, finalPath);
    const copiedHash = hashFileSha256(finalPath);
    if (copiedHash !== packed.sha256) {
      throw new Error("Packed tarball hash changed while copying to the publication directory");
    }

    return {
      identity: rebuiltIdentity,
      checkout,
      tarballPath: finalPath,
      tarballName: canonicalName,
      sha256: copiedHash,
      bytes: packed.bytes,
      entries: packed.entries,
      manifest: packed.manifest,
      catalog: packed.catalog,
    };
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}

const NPM_REGISTRY_FETCH_HEADERS = Object.freeze({
  accept: "application/json",
  "cache-control": "no-cache",
  pragma: "no-cache",
});

/**
 * @param {string} packageName
 * @param {string} [version]
 */
export function npmRegistryDocumentUrl(packageName, version) {
  const encodedName = packageName.replace("/", "%2F");
  if (version === undefined) {
    return `${NPM_REGISTRY_URL}/${encodedName}`;
  }
  return `${NPM_REGISTRY_URL}/${encodedName}/${version}`;
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {number} timeoutMs
 */
async function fetchNpmRegistryJson(fetchImpl, url, timeoutMs) {
  return fetchImpl(url, {
    method: "GET",
    headers: NPM_REGISTRY_FETCH_HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/**
 * Query the version-specific npm document first so a stale package metadata
 * cache cannot hide a version that was just published. Fall back to the
 * package document only to distinguish a missing package from a missing version.
 *
 * @param {{
 *   packageName?: string;
 *   version: string;
 *   fetchImpl?: typeof fetch;
 *   registryUrl?: string;
 *   timeoutMs?: number;
 * }} options
 */
export async function queryNpmPackageVersion(options) {
  const packageName = options.packageName ?? PUBLIC_CLI_PACKAGE_NAME;
  assertSafeNpmIdentity({ packageName, version: options.version });
  const registryUrl = options.registryUrl ?? NPM_REGISTRY_URL;
  if (registryUrl !== NPM_REGISTRY_URL) {
    throw new Error(`Refusing non-npm registry ${registryUrl}`);
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available to query the npm registry");
  }

  const timeoutMs = options.timeoutMs ?? 15_000;
  const versionUrl = npmRegistryDocumentUrl(packageName, options.version);
  const packageUrl = npmRegistryDocumentUrl(packageName);

  let versionResponse;
  try {
    versionResponse = await fetchNpmRegistryJson(fetchImpl, versionUrl, timeoutMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to query npm registry for ${packageName}: ${message}`);
  }

  if (versionResponse.ok) {
    const document = await versionResponse.json();
    if (
      !document ||
      typeof document !== "object" ||
      document.version !== options.version ||
      (typeof document.name === "string" && document.name !== packageName)
    ) {
      throw new Error(`npm version document for ${packageName}@${options.version} is malformed`);
    }
    return {
      packageName,
      version: options.version,
      packageExists: true,
      versionExists: true,
      status: "version-exists",
      versions: [options.version],
    };
  }

  if (versionResponse.status !== 404) {
    throw new Error(
      `npm registry query for ${packageName}@${options.version} failed with HTTP ${versionResponse.status}`
    );
  }

  let packageResponse;
  try {
    packageResponse = await fetchNpmRegistryJson(fetchImpl, packageUrl, timeoutMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to query npm registry for ${packageName}: ${message}`);
  }

  if (packageResponse.status === 404) {
    return {
      packageName,
      version: options.version,
      packageExists: false,
      versionExists: false,
      status: "missing-package",
    };
  }

  if (!packageResponse.ok) {
    throw new Error(
      `npm registry query for ${packageName} failed with HTTP ${packageResponse.status}`
    );
  }

  const document = await packageResponse.json();
  const versions =
    document &&
    typeof document === "object" &&
    document.versions &&
    typeof document.versions === "object"
      ? Object.keys(document.versions)
      : null;
  if (!versions) {
    throw new Error(`npm registry document for ${packageName} is missing versions`);
  }

  const versionExists = versions.includes(options.version);
  return {
    packageName,
    version: options.version,
    packageExists: true,
    versionExists,
    status: versionExists ? "version-exists" : "version-missing",
    versions,
  };
}

/**
 * @param {{
 *   packageName: string;
 *   version: string;
 *   timeoutMs: number;
 *   lastStatus?: string | null;
 *   lastError?: Error | null;
 * }} details
 */
export function formatRegistryAvailabilityTimeoutError(details) {
  const last =
    details.lastError instanceof Error
      ? `last registry query failed (${details.lastError.message})`
      : `last registry status was ${details.lastStatus ?? "unknown"}`;
  return (
    `npm accepted publish of ${details.packageName}@${details.version}, but public registry ` +
    `availability was not confirmed before timeout (${details.timeoutMs}ms). ${last}. ` +
    "npm publish exit 0 means the registry accepted the package; it does not prove the version " +
    "document is publicly queryable."
  );
}

/**
 * Poll the public npm version document until it exists. `version-missing` is the
 * expected delayed-visibility state. Transport and HTTP failures are retried as
 * distinct query errors and are never rewritten as "missing".
 *
 * @param {{
 *   packageName?: string;
 *   version: string;
 *   queryRegistry?: typeof queryNpmPackageVersion;
 *   timeoutMs?: number;
 *   pollIntervalMs?: number;
 *   sleep?: (ms: number) => Promise<void>;
 *   now?: () => number;
 *   stdout?: { write(chunk: string): unknown };
 * }} options
 */
export async function waitForNpmPackageVersion(options) {
  const packageName = options.packageName ?? PUBLIC_CLI_PACKAGE_NAME;
  assertSafeNpmIdentity({ packageName, version: options.version });
  const queryRegistry = options.queryRegistry ?? queryNpmPackageVersion;
  const timeoutMs = options.timeoutMs ?? NPM_REGISTRY_AVAILABILITY_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? NPM_REGISTRY_AVAILABILITY_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? sleepMs;
  const now = options.now ?? Date.now;
  const stdout = options.stdout ?? process.stdout;

  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error(`Invalid registry availability timeout ${JSON.stringify(timeoutMs)}`);
  }
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1) {
    throw new Error(
      `Registry availability poll interval must be a positive number of milliseconds, got ${JSON.stringify(pollIntervalMs)}`
    );
  }

  const deadline = now() + timeoutMs;
  let attempt = 0;
  /** @type {string | null} */
  let lastStatus = null;
  /** @type {Error | null} */
  let lastError = null;

  while (true) {
    attempt += 1;
    try {
      const result = await queryRegistry({ packageName, version: options.version });
      if (result.status === "version-exists") {
        return result;
      }
      if (result.status === "version-missing" || result.status === "missing-package") {
        lastStatus = result.status;
        lastError = null;
      } else {
        lastStatus = result.status ?? "unknown";
        lastError = new Error(`Unexpected npm registry status ${lastStatus}`);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      lastStatus = "query-error";
    }

    const remaining = deadline - now();
    if (remaining <= 0) {
      break;
    }

    const waitMs = Math.min(pollIntervalMs, remaining);
    const last =
      lastError instanceof Error ? `query error: ${lastError.message}` : (lastStatus ?? "unknown");
    stdout.write(
      `waiting for npm ${packageName}@${options.version} to become queryable (attempt ${attempt}, ${last})\n`
    );
    await sleep(waitMs);
  }

  throw new Error(
    formatRegistryAvailabilityTimeoutError({
      packageName,
      version: options.version,
      timeoutMs,
      lastStatus,
      lastError,
    })
  );
}

/**
 * @param {{
 *   packageExists: boolean;
 *   versionExists: boolean;
 * }} state
 */
export function decideNpmPublicationAction(state) {
  if (state.versionExists) {
    return {
      action: NPM_PUBLICATION_ACTIONS.noop,
      reason: "exact npm version already exists; refusing to overwrite",
    };
  }
  if (!state.packageExists) {
    return {
      action: NPM_PUBLICATION_ACTIONS.bootstrapRequired,
      reason:
        "package does not exist on npm; first publication must be a human-authenticated publish of the validated tarball",
    };
  }
  return {
    action: NPM_PUBLICATION_ACTIONS.publish,
    reason: "package exists and this exact version is unpublished",
  };
}

/**
 * Query npm first. Pack/publish only when the version is missing, and only
 * from the exact canonical `vX.Y.Z` tag. Already-published versions no-op
 * without rebuilding a historical artifact from later `main`.
 *
 * @param {{
 *   repoRoot: string;
 *   skipBuild?: boolean;
 *   dryRun?: boolean;
 *   oidc?: boolean;
 *   githubActions?: boolean;
 *   nodeVersion?: string;
 *   npmVersion?: string;
 *   queryRegistry?: typeof queryNpmPackageVersion;
 *   packTarball?: typeof packExactPublicCliTarball;
 *   publishTarball?: typeof publishExactTarball;
 *   hashFile?: typeof hashFileSha256;
 *   readIdentity?: typeof readPublicationIdentity;
 *   assertPrivateWorkspaces?: typeof assertPrivateInternalWorkspaces;
 *   assertCheckout?: typeof assertCanonicalReleaseCheckout;
 *   writeManifest?: typeof writePublishManifest;
 *   appendOutput?: typeof appendGithubOutput;
 *   waitForRegistry?: typeof waitForNpmPackageVersion;
 *   registryAvailabilityTimeoutMs?: number;
 *   registryAvailabilityPollIntervalMs?: number;
 *   sleep?: (ms: number) => Promise<void>;
 *   now?: () => number;
 *   stdout?: { write(chunk: string): unknown };
 * }} options
 */
export async function runNpmPublication(options) {
  const repoRoot = options.repoRoot;
  const skipBuild = options.skipBuild === true;
  const dryRun = options.dryRun !== false;
  const oidc = options.oidc === true;
  const githubActions = options.githubActions ?? process.env.GITHUB_ACTIONS === "true";
  const readIdentity = options.readIdentity ?? readPublicationIdentity;
  const assertPrivateWorkspaces =
    options.assertPrivateWorkspaces ?? assertPrivateInternalWorkspaces;
  const queryRegistry = options.queryRegistry ?? queryNpmPackageVersion;
  const assertCheckout = options.assertCheckout ?? assertCanonicalReleaseCheckout;
  const packTarball = options.packTarball ?? packExactPublicCliTarball;
  const publishTarball = options.publishTarball ?? publishExactTarball;
  const waitForRegistry = options.waitForRegistry ?? waitForNpmPackageVersion;
  const hashFile = options.hashFile ?? hashFileSha256;
  const writeManifest = options.writeManifest ?? writePublishManifest;
  const appendOutput = options.appendOutput ?? appendGithubOutput;
  const stdout = options.stdout ?? process.stdout;

  assertPrivateWorkspaces(repoRoot);
  const identity = readIdentity(repoRoot);
  assertPublicationIdentity(identity);

  const registry = await queryRegistry({ version: identity.version });
  const decision = decideNpmPublicationAction({
    packageExists: registry.packageExists,
    versionExists: registry.versionExists,
  });

  if (decision.action === NPM_PUBLICATION_ACTIONS.noop) {
    appendOutput("action", decision.action);
    appendOutput("version", identity.version);
    appendOutput("tarball", "");
    appendOutput("sha256", "");
    stdout.write(
      [
        `npm publication decision: ${decision.action}`,
        `  Package: ${PUBLIC_CLI_PACKAGE_NAME}@${identity.version}`,
        `  Tag: ${identity.tag}`,
        `  Registry: ${registry.status}`,
        `  Reason: ${decision.reason}`,
        "",
        "✓ Exact npm version already published; no registry mutation and no rebuild",
        "",
      ].join("\n")
    );
    return {
      action: decision.action,
      reason: decision.reason,
      identity,
      registry,
      packed: null,
    };
  }

  const checkout = assertCheckout(repoRoot, identity.tag);
  const packed = packTarball({
    repoRoot,
    skipBuild,
    requireReleaseTag: true,
  });
  if (packed.identity.version !== identity.version || packed.identity.tag !== identity.tag) {
    throw new Error(
      `Packed identity ${packed.identity.packageName}@${packed.identity.version} does not match ${identity.packageName}@${identity.version}`
    );
  }

  const frozenHash = hashFile(packed.tarballPath);
  if (frozenHash !== packed.sha256) {
    throw new Error("Packed tarball changed after validation");
  }

  const manifestPath = packed.tarballPath.replace(/\.tgz$/, ".publish.json");
  writeManifest(manifestPath, {
    packageName: packed.identity.packageName,
    version: packed.identity.version,
    tag: packed.identity.tag,
    commitSha: packed.checkout?.headSha ?? checkout.headSha ?? null,
    tarball: packed.tarballName,
    tarballPath: packed.tarballPath,
    sha256: packed.sha256,
    bytes: packed.bytes,
    action: decision.action,
    reason: decision.reason,
    registry: registry.status,
    mode: dryRun ? "dry-run" : "oidc",
  });

  appendOutput("action", decision.action);
  appendOutput("version", packed.identity.version);
  appendOutput("tarball", packed.tarballPath);
  appendOutput("sha256", packed.sha256);

  stdout.write(
    [
      `npm publication decision: ${decision.action}`,
      `  Package: ${PUBLIC_CLI_PACKAGE_NAME}@${packed.identity.version}`,
      `  Tag: ${packed.identity.tag}`,
      `  Commit: ${packed.checkout?.headSha ?? checkout.headSha ?? "(unknown)"}`,
      `  Tarball: ${packed.tarballPath}`,
      `  SHA-256: ${packed.sha256}`,
      `  Registry: ${registry.status}`,
      `  Reason: ${decision.reason}`,
      "",
    ].join("\n")
  );

  if (decision.action === NPM_PUBLICATION_ACTIONS.bootstrapRequired) {
    stdout.write(
      [
        "✓ First publication bootstrap is required.",
        "  From the canonical tag checkout, run `pnpm distribution:prepare-publish --require-release-tag`",
        "  and publish the printed tarball with a human-authenticated `npm publish` of that exact file.",
        "  Do not rebuild. Do not publish from packages/cli.",
        "",
      ].join("\n")
    );
    return {
      action: decision.action,
      reason: decision.reason,
      identity: packed.identity,
      registry,
      packed,
    };
  }

  if (dryRun || !oidc) {
    stdout.write("✓ Publication prerequisites satisfied (dry-run; no npm mutation)\n");
    return {
      action: decision.action,
      reason: decision.reason,
      identity: packed.identity,
      registry,
      packed,
    };
  }

  if (!githubActions) {
    throw new Error("Refusing OIDC npm publish outside GitHub Actions");
  }

  const toolchainIssues = collectTrustedPublishingToolchainIssues({
    nodeVersion: options.nodeVersion ?? process.versions.node,
    npmVersion: options.npmVersion,
  });
  if (toolchainIssues.length > 0) {
    throw new Error(
      `Trusted Publishing toolchain is insufficient (need npm >= ${NPM_TRUSTED_PUBLISHING_MIN_NPM}):\n${toolchainIssues.join("\n")}`
    );
  }

  if (hashFile(packed.tarballPath) !== packed.sha256) {
    throw new Error("Tarball was substituted after the registry existence check");
  }

  const publishResult = publishTarball({
    tarballPath: packed.tarballPath,
    expectedSha256: packed.sha256,
    cwd: repoRoot,
    provenance: true,
  });
  const publishOutput = formatNpmPublishProcessOutput(publishResult);
  if (publishOutput) {
    stdout.write(`${publishOutput}\n`);
  }
  stdout.write("npm accepted publish; waiting for registry availability.\n");
  const visible = await waitForRegistry({
    packageName: packed.identity.packageName,
    version: packed.identity.version,
    queryRegistry,
    timeoutMs: options.registryAvailabilityTimeoutMs,
    pollIntervalMs: options.registryAvailabilityPollIntervalMs,
    sleep: options.sleep,
    now: options.now,
    stdout,
  });
  stdout.write(
    `✓ Published ${PUBLIC_CLI_PACKAGE_NAME}@${packed.identity.version} (registry queryable)\n`
  );
  return {
    action: decision.action,
    reason: decision.reason,
    identity: packed.identity,
    registry,
    packed,
    visible,
  };
}

/**
 * @param {{
 *   tarballPath: string;
 *   expectedSha256: string;
 *   cwd: string;
 *   npmCommand?: string;
 *   env?: NodeJS.ProcessEnv;
 *   provenance?: boolean;
 * }} options
 */
export function publishExactTarball(options) {
  if (!options.tarballPath.endsWith(".tgz")) {
    throw new Error(`Refusing to publish non-tarball path ${options.tarballPath}`);
  }
  const actualHash = hashFileSha256(options.tarballPath);
  if (actualHash !== options.expectedSha256) {
    throw new Error(
      `Refusing to publish a substituted tarball (expected sha256 ${options.expectedSha256}, found ${actualHash})`
    );
  }

  const env = stripNpmAuthEnv(options.env ?? process.env);
  const args = [
    "publish",
    options.tarballPath,
    ...(options.provenance ? NPM_OIDC_PUBLISH_ARGS : NPM_PUBLISH_ARGS),
    "--registry",
    NPM_REGISTRY_URL,
  ];
  const result = runProcess(options.npmCommand ?? "npm", args, {
    cwd: options.cwd,
    env,
    timeout: 3 * 60 * 1000,
  });
  if (result.status !== 0 || result.timedOut) {
    throw new Error(
      `npm publish failed (${result.timedOut ? "timed out" : result.status})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return result;
}

/**
 * @param {string} filePath
 * @param {Record<string, unknown>} manifest
 */
export function writePublishManifest(filePath, manifest) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * @param {string} name
 * @param {string} value
 * @param {{ outputFile?: string | null }} [options]
 */
export function appendGithubOutput(name, value, options = {}) {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
    throw new Error(`Refusing unsafe GitHub output name ${JSON.stringify(name)}`);
  }
  if (value.includes("\n") || value.includes("\r") || value.includes("\0")) {
    throw new Error(`Refusing unsafe GitHub output value for ${name}`);
  }
  const outputFile = options.outputFile ?? process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    return;
  }
  writeFileSync(outputFile, `${name}=${value}\n`, { flag: "a" });
}
