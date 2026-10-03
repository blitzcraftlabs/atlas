import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

export const CLEAN_ROOM_STAGE_PREFIX = "[clean-room]";

export const CLEAN_ROOM_STAGES = Object.freeze({
  packCli: "pack CLI",
  npmPublishDryRun: "npm publish dry-run",
  installCli: "install CLI",
  init: "init",
  installConsumer: "install consumer",
  build: "build",
  doctor: "doctor",
  generate: "generate",
  typecheck: "typecheck",
  context: "context",
  upgrade: "upgrade",
});

export const CLEAN_ROOM_TIMEOUTS_MS = Object.freeze({
  packCli: 5 * 60 * 1000,
  npmPublishDryRun: 2 * 60 * 1000,
  installCli: 3 * 60 * 1000,
  init: 60 * 1000,
  installConsumer: 10 * 60 * 1000,
  build: 10 * 60 * 1000,
  doctor: 3 * 60 * 1000,
  generate: 60 * 1000,
  typecheck: 5 * 60 * 1000,
  context: 60 * 1000,
  upgrade: 10 * 60 * 1000,
});

export const GENERATED_PROJECT_NAME = "test-app";
export const GENERATOR_FEATURE_NAME = "inventory-audit";
export const GENERATOR_PAGE_ROUTE = "ops/health";

export const EXPECTED_GENERATOR_PATHS = Object.freeze([
  `apps/web/src/features/${GENERATOR_FEATURE_NAME}/components/InventoryAuditFeature.tsx`,
  `apps/web/src/features/${GENERATOR_FEATURE_NAME}/index.ts`,
  `apps/web/src/app/${GENERATOR_PAGE_ROUTE}/page.tsx`,
]);

export const EXPECTED_INIT_PATHS = Object.freeze([
  "apps/web/package.json",
  "packages/ui/package.json",
  "packages/consent/package.json",
  "packages/config/package.json",
  "atlas.config.json",
  "package.json",
  "pnpm-workspace.yaml",
  "AGENTS.md",
  "docs/how-we-build/agents.md",
  "docs/how-we-build/consumer-tooling.md",
  "docs/how-we-build/reference-patterns.md",
  ".github/workflows/ci.yml",
  "scripts/ensure-pnpm.js",
  "Dockerfile",
  ".dockerignore",
]);

export const FORBIDDEN_GENERATED_PATHS = Object.freeze([
  "apps/reference",
  "packages/cli",
  "packages/project",
  "releases",
  "packages/ui/.storybook",
  "packages/ui/visual-tests",
  "docker-compose.yml",
  "coverage-policy.json",
  ".husky",
]);

export const EXPECTED_WORKSPACE_PACKAGE_NAMES = Object.freeze([
  "@atlas/web",
  "@atlas/ui",
  "@atlas/consent",
  "@atlas/config",
]);

/** Documented non-secret values from apps/web/.env.example and docs/how-we-build/env.md. */
export const CONSUMER_BUILD_ENV = Object.freeze({
  NODE_ENV: "production",
  NEXT_PUBLIC_API_URL: "/api",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://user:password@localhost:5432/atlas",
  LOG_LEVEL: "info",
});

// Substring markers for PATH entries that can alias the source CLI even when
// they are not realpath-inside the checkout. Do not match `node_modules/.bin`
// globally — GitHub Actions pnpm lives at `/home/runner/setup-pnpm/node_modules/.bin`.
const REPO_BIN_MARKERS = Object.freeze(["packages/cli/dist"]);

const STRIPPED_ENV_KEYS = Object.freeze([
  "NODE_PATH",
  "ATLAS_REFERENCE_MODE",
  "SKIP_ENV_VALIDATION",
  "ATLAS_CI_RUNNER_PROFILE",
  "ATLAS_CI_USE_SELF_HOSTED",
  "CI_CHECKOUT_DIR",
  "CI_CHECKOUT_LINK",
  "CI_FIXED_WORKSPACE",
  "npm_config_local_prefix",
  "npm_package_json",
  "npm_package_name",
  "INIT_CWD",
  "OLDPWD",
  "PWD",
  "PROJECT_CWD",
  "npm_config_modules_dir",
]);

const PATH_KEYS = new Set(["PATH", "Path", "PATHEXT"]);

const MANIFEST_DEPENDENCY_SECTIONS = Object.freeze([
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
]);

const MAX_CAPTURED_OUTPUT_CHARS = 80_000;

/**
 * @param {string} fromDirectory
 * @returns {string}
 */
export function resolveAtlasRepoRoot(fromDirectory) {
  let current = path.resolve(fromDirectory);
  for (let i = 0; i < 32; i += 1) {
    if (
      existsSync(path.join(current, "atlas.config.json")) &&
      existsSync(path.join(current, "packages", "cli", "package.json"))
    ) {
      return realpathSync(current);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error(`Unable to resolve the Atlas repository root from ${fromDirectory}`);
}

/**
 * @param {string} parent
 * @param {string} child
 * @returns {boolean}
 */
export function isInsideDirectory(parent, child) {
  const parentReal = realpathIfExists(parent);
  const childReal = realpathIfExists(child);
  if (!parentReal || !childReal) {
    return false;
  }
  return childReal === parentReal || childReal.startsWith(`${parentReal}${path.sep}`);
}

/**
 * @param {string} candidate
 * @returns {string | null}
 */
export function realpathIfExists(candidate) {
  try {
    return realpathSync(candidate);
  } catch {
    return existsSync(candidate) ? path.resolve(candidate) : null;
  }
}

/**
 * @param {string} repoRoot
 * @param {string} candidate
 * @param {string} label
 */
export function assertOutsideRepo(repoRoot, candidate, label) {
  if (isInsideDirectory(repoRoot, candidate)) {
    throw new Error(`${label} must be outside the Atlas checkout: ${candidate}`);
  }
}

const DECLARED_PNPM_PATTERN = /^pnpm@(\d+\.\d+\.\d+)$/;

/**
 * @param {unknown} packageManager
 * @returns {string}
 */
export function parseDeclaredPnpmVersion(packageManager) {
  if (typeof packageManager !== "string" || packageManager.length === 0) {
    throw new Error("Generated package.json is missing packageManager");
  }
  const match = DECLARED_PNPM_PATTERN.exec(packageManager);
  if (!match || match[1] === undefined) {
    throw new Error(`Generated packageManager must be pnpm@x.y.z, got ${String(packageManager)}`);
  }
  return match[1];
}

/**
 * Prefer Corepack so generated-project install/build use the declared
 * `packageManager` rather than whichever pnpm happens to be on PATH.
 *
 * @param {{
 *   generatedRoot: string;
 *   env?: NodeJS.ProcessEnv;
 *   resolveCommand?: typeof resolveCommandPath;
 *   run?: typeof runCommand;
 * }} options
 * @returns {{
 *   command: string;
 *   prefixArgs: string[];
 *   version: string;
 *   source: "corepack" | "ambient";
 * }}
 */
export function resolveGeneratedProjectPnpm(options) {
  const manifest = readJson(path.join(options.generatedRoot, "package.json"));
  const version = parseDeclaredPnpmVersion(manifest.packageManager);
  const env = options.env ?? process.env;
  const resolve = options.resolveCommand ?? resolveCommandPath;
  const run = options.run ?? runCommand;

  try {
    const corepack = resolve("corepack", env);
    return {
      command: corepack,
      prefixArgs: [`pnpm@${version}`],
      version,
      source: "corepack",
    };
  } catch {
    const pnpm = resolve("pnpm", env);
    const probe = run(pnpm, ["--version"], {
      cwd: options.generatedRoot,
      env,
      timeout: 15_000,
    });
    const actual = probe.stdout.trim();
    if (probe.status !== 0 || probe.timedOut || actual !== version) {
      throw new Error(
        `Generated project declares pnpm@${version}, but Corepack is unavailable and ambient pnpm is ${actual || "unavailable"}`
      );
    }
    return {
      command: pnpm,
      prefixArgs: [],
      version,
      source: "ambient",
    };
  }
}

/**
 * @param {{ command: string; prefixArgs: string[] }} pnpm
 * @param {string[]} args
 * @returns {string[]}
 */
export function generatedProjectPnpmArgs(pnpm, args) {
  return [...pnpm.prefixArgs, ...args];
}

/**
 * @param {string} command
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveCommandPath(command, env = process.env) {
  if (path.isAbsolute(command) && existsSync(command)) {
    return command;
  }

  const pathValue = env.PATH ?? env.Path ?? "";
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) {
      continue;
    }
    const candidate = path.join(directory, command);
    if (existsSync(candidate) && !statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  throw new Error(`Unable to resolve ${command} on PATH`);
}

/**
 * @param {string} pathValue
 * @param {string} repoRoot
 * @returns {string}
 */
export function filterPathForCleanRoom(pathValue, repoRoot) {
  const repoReal = realpathIfExists(repoRoot) ?? path.resolve(repoRoot);
  return pathValue
    .split(path.delimiter)
    .filter((entry) => {
      if (!entry) {
        return false;
      }
      const resolved = path.resolve(entry);
      if (isInsideDirectory(repoReal, resolved)) {
        return false;
      }
      const normalized = resolved.split(path.sep).join("/");
      return !REPO_BIN_MARKERS.some((marker) => normalized.includes(marker));
    })
    .join(path.delimiter);
}

/**
 * @param {{
 *   repoRoot: string;
 *   cwd: string;
 *   sourceEnv?: NodeJS.ProcessEnv;
 *   extra?: NodeJS.ProcessEnv;
 * }} options
 * @returns {NodeJS.ProcessEnv}
 */
export function sanitizeCleanRoomEnv(options) {
  const sourceEnv = options.sourceEnv ?? process.env;
  const repoRoot = options.repoRoot;
  /** @type {NodeJS.ProcessEnv} */
  const next = { ...sourceEnv, NO_COLOR: "1", FORCE_COLOR: "0" };

  for (const key of STRIPPED_ENV_KEYS) {
    delete next[key];
  }

  for (const key of Object.keys(next)) {
    if (key.startsWith("npm_package_") || key.startsWith("npm_lifecycle_")) {
      delete next[key];
      continue;
    }
    if (key.startsWith("ATLAS_") && key !== "ATLAS_KEEP_CLEAN_ROOM") {
      delete next[key];
      continue;
    }
    const value = next[key];
    if (typeof value === "string" && !PATH_KEYS.has(key) && valueIncludesRepo(value, repoRoot)) {
      delete next[key];
    }
  }

  next.PATH = filterPathForCleanRoom(sourceEnv.PATH ?? sourceEnv.Path ?? "", repoRoot);
  next.PWD = options.cwd;
  next.INIT_CWD = options.cwd;

  for (const [key, value] of Object.entries(options.extra ?? {})) {
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }

  return next;
}

/**
 * @param {string} value
 * @param {string} repoRoot
 * @returns {boolean}
 */
export function valueIncludesRepo(value, repoRoot) {
  const repoReal = realpathIfExists(repoRoot) ?? path.resolve(repoRoot);
  return value === repoReal || value.includes(`${repoReal}${path.sep}`) || value.includes(repoReal);
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{
 *   cwd: string;
 *   env?: NodeJS.ProcessEnv;
 *   timeout?: number;
 * }} options
 */
export function runCommand(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: options.timeout,
    maxBuffer: 20 * 1024 * 1024,
  });

  const timedOut = Boolean(
    result.error && "code" in result.error && result.error.code === "ETIMEDOUT"
  );
  const stdout = bufferToString(result.stdout);
  const stderr = bufferToString(result.stderr);
  const errorMessage = result.error && !timedOut ? result.error.message : "";

  return {
    command,
    args,
    cwd: options.cwd,
    status: timedOut ? null : (result.status ?? (result.error ? 1 : 0)),
    stdout,
    stderr: errorMessage ? `${stderr}${stderr ? "\n" : ""}${errorMessage}` : stderr,
    timedOut,
    signal: result.signal ?? null,
  };
}

/**
 * @param {string | Buffer | null | undefined} value
 * @returns {string}
 */
function bufferToString(value) {
  if (value == null) {
    return "";
  }
  return typeof value === "string" ? value : value.toString("utf8");
}

/**
 * @param {{
 *   stage: string;
 *   command: string;
 *   args: string[];
 *   cwd: string;
 *   status: number | null;
 *   stdout: string;
 *   stderr: string;
 *   timedOut?: boolean;
 *   signal?: string | null;
 * }} result
 * @returns {string}
 */
export function formatStageFailure(result) {
  const statusLabel = result.timedOut
    ? "timed out"
    : result.status === null
      ? `killed${result.signal ? ` (${result.signal})` : ""}`
      : String(result.status);
  const renderedCommand = [result.command, ...result.args].join(" ");
  return [
    `${CLEAN_ROOM_STAGE_PREFIX} FAILED ${result.stage}`,
    `command: ${renderedCommand}`,
    `cwd: ${result.cwd}`,
    `exit status: ${statusLabel}`,
    "stdout:",
    truncateOutput(result.stdout),
    "stderr:",
    truncateOutput(result.stderr),
  ].join("\n");
}

/**
 * @param {string} output
 * @returns {string}
 */
export function truncateOutput(output) {
  if (!output) {
    return "(empty)";
  }
  if (output.length <= MAX_CAPTURED_OUTPUT_CHARS) {
    return output;
  }
  return `${output.slice(-MAX_CAPTURED_OUTPUT_CHARS)}\n… truncated to the last ${MAX_CAPTURED_OUTPUT_CHARS} characters`;
}

/**
 * @param {string} stage
 * @param {string} command
 * @param {string[]} args
 * @param {{
 *   cwd: string;
 *   env?: NodeJS.ProcessEnv;
 *   timeout?: number;
 * }} options
 */
export function runStage(stage, command, args, options) {
  process.stdout.write(`${CLEAN_ROOM_STAGE_PREFIX} ${stage}\n`);
  const result = runCommand(command, args, options);
  if (result.status !== 0 || result.timedOut) {
    throw new Error(formatStageFailure({ ...result, stage }));
  }
  return result;
}

/**
 * @param {string} packDestination
 * @returns {string}
 */
export function findPackedTarball(packDestination) {
  const names = readdirSync(packDestination).filter((name) => name.endsWith(".tgz"));
  if (names.length !== 1 || names[0] === undefined) {
    throw new Error(
      `Expected exactly one CLI tarball in ${packDestination}, found: ${names.join(", ") || "(none)"}`
    );
  }
  return path.join(packDestination, names[0]);
}

/**
 * @param {string} repoRoot
 */
export function createCleanRoomLayout(repoRoot) {
  const root = mkdtempSync(path.join(os.tmpdir(), "atlas-clean-room-"));
  const harness = path.join(root, "harness");
  const artifacts = path.join(root, "artifacts");
  mkdirSync(harness, { recursive: true });
  mkdirSync(artifacts, { recursive: true });
  assertOutsideRepo(repoRoot, root, "Clean-room root");
  assertOutsideRepo(repoRoot, harness, "Clean-room harness");
  writeFileSync(
    path.join(harness, "package.json"),
    `${JSON.stringify(
      {
        name: "atlas-distribution-clean-room-harness",
        private: true,
        version: "0.0.0",
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return {
    root,
    harness,
    artifacts,
    generatedRoot: path.join(root, GENERATED_PROJECT_NAME),
  };
}

/**
 * @param {string} generatedRoot
 * @returns {string[]}
 */
export function listGeneratedWorkspaceManifests(generatedRoot) {
  const manifests = [path.join(generatedRoot, "package.json")];
  for (const group of ["apps", "packages"]) {
    const groupRoot = path.join(generatedRoot, group);
    if (!existsSync(groupRoot)) {
      continue;
    }
    for (const entry of readdirSync(groupRoot)) {
      const manifest = path.join(groupRoot, entry, "package.json");
      if (existsSync(manifest)) {
        manifests.push(manifest);
      }
    }
  }
  return manifests;
}

/**
 * @param {string} generatedRoot
 */
export function collectGeneratedWorkspaceMembers(generatedRoot) {
  /** @type {Map<string, string>} */
  const members = new Map();
  for (const manifestPath of listGeneratedWorkspaceManifests(generatedRoot)) {
    const manifest = readJson(manifestPath);
    if (typeof manifest.name !== "string" || manifest.name.length === 0) {
      throw new Error(`Generated workspace manifest is missing a name: ${manifestPath}`);
    }
    members.set(manifest.name, path.dirname(manifestPath));
  }
  return members;
}

/**
 * @param {string} generatedRoot
 * @returns {string[]}
 */
export function collectWorkspaceResolutionIssues(generatedRoot) {
  const issues = [];
  const members = collectGeneratedWorkspaceMembers(generatedRoot);

  for (const [_packageName, packageRoot] of members) {
    const manifest = readJson(path.join(packageRoot, "package.json"));
    const relativePackage =
      path.relative(generatedRoot, packageRoot).split(path.sep).join("/") || ".";
    for (const section of MANIFEST_DEPENDENCY_SECTIONS) {
      const deps = manifest[section];
      if (deps === undefined || deps === null || typeof deps !== "object") {
        continue;
      }
      for (const [depName, range] of Object.entries(deps)) {
        if (typeof range !== "string" || !range.startsWith("workspace:")) {
          continue;
        }
        const resolved = path.join(packageRoot, "node_modules", ...depName.split("/"));
        if (!existsSync(resolved)) {
          issues.push(
            `${relativePackage} ${section} ${depName} did not resolve under that package's node_modules after install`
          );
          continue;
        }
        if (!isInsideDirectory(generatedRoot, resolved)) {
          issues.push(
            `${relativePackage} ${section} ${depName} resolved outside the generated project: ${resolved}`
          );
        }
      }
    }
  }

  return issues;
}

/**
 * @param {string} generatedRoot
 * @returns {string[]}
 */
export function auditGeneratedWorkspace(generatedRoot) {
  const issues = [];
  const members = collectGeneratedWorkspaceMembers(generatedRoot);
  const memberNames = new Set(members.keys());

  for (const expected of EXPECTED_WORKSPACE_PACKAGE_NAMES) {
    if (!memberNames.has(expected)) {
      issues.push(`missing expected workspace package ${expected}`);
    }
  }

  for (const [name, packageRoot] of members) {
    if (!isInsideDirectory(generatedRoot, packageRoot)) {
      issues.push(
        `workspace package ${name} resolves outside the generated project: ${packageRoot}`
      );
    }
  }

  for (const manifestPath of listGeneratedWorkspaceManifests(generatedRoot)) {
    const manifest = readJson(manifestPath);
    const relativeManifest = path.relative(generatedRoot, manifestPath).split(path.sep).join("/");
    for (const section of MANIFEST_DEPENDENCY_SECTIONS) {
      const deps = manifest[section];
      if (deps === undefined || deps === null || typeof deps !== "object") {
        continue;
      }
      for (const [depName, range] of Object.entries(deps)) {
        if (typeof range !== "string") {
          continue;
        }
        if (range.startsWith("workspace:")) {
          if (!memberNames.has(depName)) {
            issues.push(
              `${relativeManifest} ${section} ${depName}: ${range} is not a generated workspace member`
            );
          }
        }
        if (range.startsWith("file:") || range.startsWith("link:")) {
          const linked = path.resolve(
            path.dirname(manifestPath),
            range.replace(/^(file:|link:)/, "")
          );
          if (!isInsideDirectory(generatedRoot, linked)) {
            issues.push(
              `${relativeManifest} ${section} ${depName}: ${range} points outside the generated project`
            );
          }
        }
        if (depName.startsWith("@atlas/") && !memberNames.has(depName)) {
          issues.push(
            `${relativeManifest} ${section} ${depName}: unpublished Atlas package is absent from the generated workspace`
          );
        }
      }
    }
  }

  return issues;
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown>}
 */
export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

/**
 * @param {string} stdout
 * @param {string} command
 */
export function parseJsonEnvelope(stdout, command) {
  const text = stdout.trim();
  if (!text) {
    throw new Error(`${command} produced empty stdout`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new Error(
      `${command} did not emit valid JSON: ${message}\nstdout:\n${truncateOutput(stdout)}`
    );
  }
}

/**
 * @param {unknown} value
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function collectRepoPathLeaks(value, repoRoot) {
  const repoReal = realpathIfExists(repoRoot) ?? path.resolve(repoRoot);
  /** @type {string[]} */
  const leaks = [];
  walkStrings(value, (text, trail) => {
    if (text === repoReal || text.includes(repoReal)) {
      leaks.push(`${trail}: ${text}`);
    }
  });
  return leaks;
}

/**
 * @param {unknown} value
 * @param {(text: string, trail: string) => void} visit
 * @param {string} [trail]
 */
export function walkStrings(value, visit, trail = "$") {
  if (typeof value === "string") {
    visit(value, trail);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      walkStrings(entry, visit, `${trail}[${index}]`);
    });
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      walkStrings(entry, visit, `${trail}.${key}`);
    }
  }
}

/**
 * @param {unknown} report
 * @param {string} generatedRoot
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function collectDoctorPathLeaks(report, generatedRoot, repoRoot) {
  const leaks = collectRepoPathLeaks(report, repoRoot);
  walkStrings(report, (text, trail) => {
    if (!trail.endsWith(".path") && !trail.includes(".filePath")) {
      return;
    }
    if (
      path.isAbsolute(text) &&
      isInsideDirectory(repoRoot, text) &&
      !isInsideDirectory(generatedRoot, text)
    ) {
      leaks.push(`${trail}: ${text}`);
    }
  });
  return [...new Set(leaks)];
}

/**
 * @param {string} generatedRoot
 */
export function readGeneratedBaseline(generatedRoot) {
  const contract = readJson(path.join(generatedRoot, "atlas.config.json"));
  const atlasVersion = contract?.platform?.baseline?.atlasVersion;
  if (typeof atlasVersion !== "string" || atlasVersion.length === 0) {
    throw new Error("Generated atlas.config.json is missing platform.baseline.atlasVersion");
  }
  return atlasVersion;
}

/**
 * @param {string} generatedRoot
 */
export function assertGeneratedProjectShape(generatedRoot, repoRoot) {
  for (const relativePath of EXPECTED_INIT_PATHS) {
    const absolutePath = path.join(generatedRoot, relativePath);
    if (!existsSync(absolutePath)) {
      throw new Error(`Generated project is missing ${relativePath}`);
    }
    if (
      isInsideDirectory(repoRoot, absolutePath) &&
      !isInsideDirectory(generatedRoot, absolutePath)
    ) {
      throw new Error(`Generated path ${relativePath} resolved into the Atlas checkout`);
    }
  }

  for (const relativePath of FORBIDDEN_GENERATED_PATHS) {
    if (existsSync(path.join(generatedRoot, relativePath))) {
      throw new Error(`Generated project must not include ${relativePath}`);
    }
  }

  const manifest = readJson(path.join(generatedRoot, "package.json"));
  if (manifest.name !== GENERATED_PROJECT_NAME) {
    throw new Error(
      `Generated package name is ${String(manifest.name)}, expected ${GENERATED_PROJECT_NAME}`
    );
  }
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error("Generated package.json is missing version");
  }
  return manifest;
}

/**
 * @param {string} generatedRoot
 */
export function assertGeneratorOutput(generatedRoot) {
  for (const relativePath of EXPECTED_GENERATOR_PATHS) {
    const absolutePath = path.join(generatedRoot, relativePath);
    if (!existsSync(absolutePath)) {
      throw new Error(`Generator did not create ${relativePath}`);
    }
    if (!isInsideDirectory(generatedRoot, absolutePath)) {
      throw new Error(`Generated path ${relativePath} is not inside the generated project`);
    }
  }
}

/**
 * @param {unknown} doctorEnvelope
 * @param {{
 *   atlasVersion: string;
 *   appVersion: string;
 *   generatedRoot: string;
 *   repoRoot: string;
 *   requireIndependentAppVersion?: boolean;
 * }} expectations
 */
export function assertDoctorReport(doctorEnvelope, expectations) {
  const issues = [];
  if (doctorEnvelope?.ok !== true) {
    issues.push("Doctor JSON envelope is not ok");
  }
  const report = doctorEnvelope?.result ?? {};
  if (report.atlasVersion !== expectations.atlasVersion) {
    issues.push(
      `Doctor atlasVersion is ${String(report.atlasVersion)}, expected ${expectations.atlasVersion}`
    );
  }
  if (report.status === "failed") {
    issues.push(`Doctor status is failed`);
  }

  const diagnostics = Array.isArray(report.diagnostics) ? report.diagnostics : [];
  if (diagnostics.some((diagnostic) => diagnostic?.code === "ATLAS_VERSION_MISMATCH")) {
    issues.push("Doctor reported ATLAS_VERSION_MISMATCH");
  }

  const checks = Array.isArray(report.checks) ? report.checks : [];
  for (const checkId of [
    "project-contract",
    "workspace-structure",
    "dependency-declarations",
    "atlas-version",
  ]) {
    const check = checks.find((entry) => entry?.id === checkId);
    if (!check) {
      issues.push(`Doctor is missing ${checkId} check`);
      continue;
    }
    if (check.status !== "pass") {
      issues.push(`Doctor check ${checkId} status is ${String(check.status)}`);
    }
  }

  if (
    expectations.requireIndependentAppVersion !== false &&
    expectations.appVersion === expectations.atlasVersion
  ) {
    issues.push("Generated app package version must stay independent of the Atlas baseline");
  }

  issues.push(...collectDoctorPathLeaks(report, expectations.generatedRoot, expectations.repoRoot));
  return issues;
}

/**
 * @param {unknown} contextEnvelope
 * @param {{
 *   atlasVersion: string;
 *   generatedRoot: string;
 *   repoRoot: string;
 * }} expectations
 */
export function assertContextReport(contextEnvelope, expectations) {
  const issues = [];
  if (contextEnvelope?.ok !== true) {
    issues.push("Context JSON envelope is not ok");
  }
  const report = contextEnvelope?.result ?? {};
  if (report.atlasVersion !== expectations.atlasVersion) {
    issues.push(
      `Context atlasVersion is ${String(report.atlasVersion)}, expected ${expectations.atlasVersion}`
    );
  }

  if (report.workspaceKind !== "consumer") {
    issues.push(`Context workspaceKind is ${String(report.workspaceKind)}, expected consumer`);
  }
  if (report?.invocation?.cli !== "pnpm atlas") {
    issues.push(
      `Consumer context invocation.cli must be the pinned local CLI, got ${String(report?.invocation?.cli)}`
    );
  }
  if (!Array.isArray(report?.commands?.enable?.capabilityIds) || !report.commands.enable.capabilityIds.includes("storybook")) {
    issues.push("Consumer context must advertise atlas enable capability ids");
  }

  const applications = report?.project?.applications;
  if (!Array.isArray(applications) || !applications.includes("apps/web")) {
    issues.push("Context applications must include apps/web");
  }

  const serialized = JSON.stringify(report);
  if (
    serialized.includes(
      realpathIfExists(expectations.repoRoot) ?? path.resolve(expectations.repoRoot)
    )
  ) {
    issues.push("Context JSON contains the canonical Atlas repository realpath");
  }

  const recommended = report?.validation?.recommended ?? [];
  if (!Array.isArray(recommended) || recommended.length === 0) {
    issues.push("Context validation.recommended is missing");
  }
  if (
    recommended.some(
      (entry) =>
        typeof entry?.command === "string" &&
        (entry.command.includes("@atlas/reference") || entry.id === "governance-check")
    )
  ) {
    issues.push("Consumer context advertises Atlas-maintainer-only validation commands");
  }
  if (
    recommended.some(
      (entry) =>
        typeof entry?.command === "string" &&
        entry.command.includes("pnpm dlx @blitzcraftlabs/atlas@")
    )
  ) {
    issues.push("Consumer context still teaches versioned pnpm dlx for ordinary Atlas commands");
  }

  issues.push(...collectRepoPathLeaks(report, expectations.repoRoot));
  return issues;
}

/**
 * @param {string} directory
 */
export function removeDirectory(directory) {
  rmSync(directory, { recursive: true, force: true });
}

/**
 * @param {{ argv?: string[]; env?: NodeJS.ProcessEnv }} [options]
 * @returns {boolean}
 */
export function isExplicitKeepRequested(options = {}) {
  const argv = options.argv ?? [];
  const env = options.env ?? process.env;
  return argv.includes("--keep") || env.ATLAS_KEEP_CLEAN_ROOM === "1";
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function isCiEnvironment(env = process.env) {
  return env.CI === "true";
}

/**
 * Explicit keep always preserves. CI without keep always cleans.
 * Local runs without keep preserve only on failure.
 *
 * @param {{
 *   explicitKeep: boolean;
 *   isCi: boolean;
 *   failed: boolean;
 * }} options
 * @returns {boolean}
 */
export function shouldKeepCleanRoom(options) {
  if (options.explicitKeep) {
    return true;
  }
  if (options.isCi) {
    return false;
  }
  return Boolean(options.failed);
}

/**
 * Apply temp-directory retention. Call this from the success and failure
 * paths; do not rely on process-exit handlers.
 *
 * @param {{
 *   root: string;
 *   explicitKeep: boolean;
 *   isCi: boolean;
 *   failed: boolean;
 *   remove?: (directory: string) => void;
 *   write?: (message: string) => void;
 * }} options
 * @returns {{ kept: boolean; cleanupError: Error | null }}
 */
export function finalizeCleanRoom(options) {
  const write = options.write ?? ((message) => process.stdout.write(message));
  const remove = options.remove ?? removeDirectory;

  if (
    shouldKeepCleanRoom({
      explicitKeep: options.explicitKeep,
      isCi: options.isCi,
      failed: options.failed,
    })
  ) {
    write(`${CLEAN_ROOM_STAGE_PREFIX} preserved ${options.root}\n`);
    return { kept: true, cleanupError: null };
  }

  try {
    remove(options.root);
    write(`${CLEAN_ROOM_STAGE_PREFIX} cleaned ${options.root}\n`);
    return { kept: false, cleanupError: null };
  } catch (error) {
    const cleanupError = error instanceof Error ? error : new Error(String(error));
    return { kept: false, cleanupError };
  }
}
