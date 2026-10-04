#!/usr/bin/env node
import {
  existsSync,
  realpathSync,
  statSync,
  readFileSync,
  writeFileSync,
  cpSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PUBLIC_CLI_PACKAGE_NAME, PUBLIC_CLI_WORKSPACE_BUILD_ARGS } from "./atlas-workspaces.mjs";
import {
  CLEAN_ROOM_STAGE_PREFIX,
  CLEAN_ROOM_STAGES,
  CLEAN_ROOM_TIMEOUTS_MS,
  CONSUMER_BUILD_ENV,
  GENERATED_PROJECT_NAME,
  GENERATOR_FEATURE_NAME,
  GENERATOR_PAGE_ROUTE,
  assertContextReport,
  assertDoctorReport,
  assertGeneratedProjectShape,
  assertGeneratorOutput,
  assertOutsideRepo,
  auditGeneratedWorkspace,
  collectWorkspaceResolutionIssues,
  createCleanRoomLayout,
  finalizeCleanRoom,
  findPackedTarball,
  formatStageFailure,
  generatedProjectPnpmArgs,
  isCiEnvironment,
  isExplicitKeepRequested,
  isInsideDirectory,
  parseJsonEnvelope,
  readGeneratedBaseline,
  resolveAtlasRepoRoot,
  resolveCommandPath,
  resolveGeneratedProjectPnpm,
  runCommand,
  runStage,
  sanitizeCleanRoomEnv,
} from "./lib/distribution-clean-room.mjs";
import {
  proveInstalledCrossVersionUpgrade,
  selectPreviousSupportedVersion,
} from "./lib/distribution-upgrade-proof.mjs";
import { verifyNpmPublishDryRun } from "./lib/npm-publish-dry-run.mjs";
import { startLocalPackageRegistryProcess } from "./lib/local-package-registry.mjs";

const scriptPath = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const options = {
    keep: isExplicitKeepRequested({ argv, env: process.env }),
    help: false,
  };

  for (const arg of argv) {
    if (arg === "--keep") {
      options.keep = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function writeHelp() {
  process.stdout.write(`Usage: pnpm distribution:verify [--keep]

Prove that a packed @blitzcraftlabs/atlas tarball bootstraps a self-contained Atlas project
outside this repository.

--keep (or ATLAS_KEEP_CLEAN_ROOM=1) preserves the temporary directory on
success and failure. Without it, local failures keep the directory for
debugging; CI (CI=true) always removes it.

This is a maintainer distribution check. It does not publish to npm.
`);
}

function installedAtlasBinary(harness) {
  return path.join(harness, "node_modules", ".bin", "atlas");
}

function installedCliPackage(harness) {
  return path.join(harness, "node_modules", "@blitzcraftlabs", "atlas");
}

function assertExecutable(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`${label} is missing: ${filePath}`);
  }
  if ((statSync(filePath).mode & 0o111) === 0) {
    throw new Error(`${label} is not executable: ${filePath}`);
  }
}

function consumerAtlasBin(generatedRoot) {
  return path.join(generatedRoot, "node_modules", ".bin", "atlas");
}

function installHandoffPredecessor(generatedRoot, version) {
  const source = path.join(generatedRoot, "node_modules", "@blitzcraftlabs", "atlas");
  const copyRoot = path.join(generatedRoot, ".atlas-handoff-predecessor");
  rmSync(copyRoot, { recursive: true, force: true });
  cpSync(source, copyRoot, { recursive: true, dereference: true });
  const manifestPath = path.join(copyRoot, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.version = version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const bin = consumerAtlasBin(generatedRoot);
  rmSync(bin, { force: true });
  symlinkSync(path.join(copyRoot, "dist", "cli.js"), bin);
}

function restoreConsumerAtlasBin(generatedRoot) {
  const bin = consumerAtlasBin(generatedRoot);
  rmSync(bin, { force: true });
  symlinkSync(
    path.join(generatedRoot, "node_modules", "@blitzcraftlabs", "atlas", "dist", "cli.js"),
    bin
  );
}

function extractJsonStdout(stdout) {
  const line = stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("{") && entry.endsWith("}"));
  if (!line) {
    return stdout;
  }
  return line;
}

function rewriteInstalledCliVersion(generatedRoot, version) {
  const manifestPath = path.join(
    generatedRoot,
    "node_modules",
    "@blitzcraftlabs",
    "atlas",
    "package.json"
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.version = version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function proveInstalledUpgradeBoundary(options) {
  process.stdout.write(`${CLEAN_ROOM_STAGE_PREFIX} ${CLEAN_ROOM_STAGES.upgrade}\n`);
  const {
    atlas,
    generatedRoot,
    cliInstalled,
    repoRoot,
    harness,
    consumerPnpm,
    consumerToolingEnv,
  } = options;

  if (existsSync(path.join(generatedRoot, "releases"))) {
    throw new Error("Generated consumer must not contain a releases/ tree");
  }

  const releaseResolver = path.join(cliInstalled, "dist", "release-assets.js");
  if (!existsSync(releaseResolver)) {
    throw new Error(`Installed CLI is missing dist/release-assets.js at ${releaseResolver}`);
  }

  const lookup = runCommand(
    process.execPath,
    [
      "-e",
      `
const resolver = require(${JSON.stringify(releaseResolver)});
const root = resolver.findReleaseAssetRoot();
const catalog = resolver.readPackagedReleaseCatalog(root);
process.stdout.write(JSON.stringify({ root, catalog }));
`,
    ],
    {
      cwd: generatedRoot,
      env: sanitizeCleanRoomEnv({ repoRoot, cwd: generatedRoot }),
      timeout: CLEAN_ROOM_TIMEOUTS_MS.upgrade,
    }
  );
  if (lookup.status !== 0) {
    throw new Error(
      `Installed release catalog lookup failed\nstdout:\n${lookup.stdout}\nstderr:\n${lookup.stderr}`
    );
  }

  const resolved = JSON.parse(lookup.stdout);
  const installedRoot = realpathSync(cliInstalled);
  const catalogRoot = realpathSync(resolved.root);
  if (!catalogRoot.startsWith(installedRoot)) {
    throw new Error("Installed CLI resolved release assets outside its package root");
  }
  assertOutsideRepo(repoRoot, catalogRoot, "Packaged release assets");
  if (
    resolved.catalog.supportedVersions.includes("0.1.0") ||
    resolved.catalog.supportedVersions.includes("0.2.0")
  ) {
    throw new Error("Packaged production catalog must not include rehearsal 0.1.0/0.2.0");
  }

  const unsupported = runCommand(
    atlas,
    ["upgrade", "--to", "9.9.9", "--dry-run", "--json", "--cwd", generatedRoot],
    {
      cwd: harness,
      env: sanitizeCleanRoomEnv({ repoRoot, cwd: harness }),
      timeout: CLEAN_ROOM_TIMEOUTS_MS.upgrade,
    }
  );
  const unsupportedOutput = `${unsupported.stdout}\n${unsupported.stderr}`;
  if (unsupported.status === 0) {
    throw new Error("atlas upgrade --to 9.9.9 must fail closed for an unsupported target");
  }
  if (
    !/Unsupported target Atlas release 9\.9\.9/.test(unsupportedOutput) &&
    !/No matching version found for @blitzcraftlabs\/atlas@9\.9\.9/.test(unsupportedOutput)
  ) {
    throw new Error(`Unsupported-target upgrade did not fail clearly:\n${unsupportedOutput}`);
  }

  const catalog = resolved.catalog;
  const previous = selectPreviousSupportedVersion(catalog);
  if (!previous) {
    process.stdout.write(
      `${CLEAN_ROOM_STAGE_PREFIX} ${CLEAN_ROOM_STAGES.upgrade} deferred cross-version proof until the Version PR generates the next production snapshot (catalog current ${catalog.current})\n`
    );
    return;
  }

  if (catalog.supportedVersions.includes("1.2.3")) {
    throw new Error("Packaged catalog must not advertise unpublished Atlas 1.2.3");
  }

  proveInstalledCrossVersionUpgrade({
    catalog,
    consumerRoot: generatedRoot,
    cliInstalled,
    runAtlas(args) {
      process.stdout.write(`${CLEAN_ROOM_STAGE_PREFIX} ${CLEAN_ROOM_STAGES.upgrade}\n`);
      const packageBefore = readFileSync(path.join(generatedRoot, "package.json"), "utf8");
      const lockBefore = existsSync(path.join(generatedRoot, "pnpm-lock.yaml"))
        ? readFileSync(path.join(generatedRoot, "pnpm-lock.yaml"), "utf8")
        : "";
      const contractBefore = readFileSync(path.join(generatedRoot, "atlas.config.json"), "utf8");
      if (args.includes("--dry-run")) {
        installHandoffPredecessor(generatedRoot, previous);
      }
      const result = runCommand(
        consumerPnpm.command,
        generatedProjectPnpmArgs(consumerPnpm, ["atlas", ...args, "--cwd", generatedRoot]),
        {
          cwd: generatedRoot,
          env: sanitizeCleanRoomEnv({ repoRoot, cwd: generatedRoot, extra: consumerToolingEnv }),
          timeout: CLEAN_ROOM_TIMEOUTS_MS.upgrade,
        }
      );
      if (args.includes("--dry-run")) {
        const packageAfter = readFileSync(path.join(generatedRoot, "package.json"), "utf8");
        const lockAfter = existsSync(path.join(generatedRoot, "pnpm-lock.yaml"))
          ? readFileSync(path.join(generatedRoot, "pnpm-lock.yaml"), "utf8")
          : "";
        const contractAfter = readFileSync(path.join(generatedRoot, "atlas.config.json"), "utf8");
        if (
          packageAfter !== packageBefore ||
          lockAfter !== lockBefore ||
          contractAfter !== contractBefore
        ) {
          throw new Error("Upgrade dry-run mutated the consumer working tree");
        }
        restoreConsumerAtlasBin(generatedRoot);
      }
      const envelope = parseJsonEnvelope(
        extractJsonStdout(result.stdout),
        `pnpm atlas ${args.join(" ")}`
      );
      if (args.includes("--dry-run")) {
        return envelope;
      }
      if (result.status !== 0 || result.timedOut) {
        throw new Error(
          formatStageFailure({ ...result, stage: CLEAN_ROOM_STAGES.upgrade, command: atlas, args })
        );
      }
      return envelope;
    },
    runValidation() {
      const version = runStage(
        CLEAN_ROOM_STAGES.doctor,
        consumerPnpm.command,
        generatedProjectPnpmArgs(consumerPnpm, ["atlas", "--version"]),
        {
          cwd: generatedRoot,
          env: sanitizeCleanRoomEnv({
            repoRoot,
            cwd: generatedRoot,
            extra: consumerToolingEnv,
          }),
          timeout: CLEAN_ROOM_TIMEOUTS_MS.doctor,
        }
      );
      const reportedVersion = version.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .at(-1);
      if (reportedVersion !== catalog.current) {
        throw new Error(
          `Post-upgrade pnpm atlas --version did not report ${catalog.current}\n${version.stdout}`
        );
      }
      const doctor = runStage(
        CLEAN_ROOM_STAGES.doctor,
        atlas,
        ["doctor", "--json", "--cwd", generatedRoot],
        {
          cwd: harness,
          env: sanitizeCleanRoomEnv({ repoRoot, cwd: harness }),
          timeout: CLEAN_ROOM_TIMEOUTS_MS.doctor,
        }
      );
      const doctorEnvelope = parseJsonEnvelope(doctor.stdout, "atlas doctor --json");
      const atlasVersion = readGeneratedBaseline(generatedRoot);
      const generatedManifest = JSON.parse(
        readFileSync(path.join(generatedRoot, "package.json"), "utf8")
      );
      const doctorIssues = assertDoctorReport(doctorEnvelope, {
        atlasVersion,
        appVersion: generatedManifest.version,
        generatedRoot,
        repoRoot,
        requireIndependentAppVersion: false,
      });
      if (doctorIssues.length > 0) {
        throw new Error(
          `Post-upgrade doctor assertions failed:\n${doctorIssues.join("\n")}\n${doctor.stdout}`
        );
      }

      runStage(
        CLEAN_ROOM_STAGES.typecheck,
        consumerPnpm.command,
        generatedProjectPnpmArgs(consumerPnpm, ["typecheck"]),
        {
          cwd: generatedRoot,
          env: sanitizeCleanRoomEnv({
            repoRoot,
            cwd: generatedRoot,
            extra: consumerToolingEnv,
          }),
          timeout: CLEAN_ROOM_TIMEOUTS_MS.typecheck,
        }
      );
      runStage(
        CLEAN_ROOM_STAGES.build,
        consumerPnpm.command,
        generatedProjectPnpmArgs(consumerPnpm, ["build"]),
        {
          cwd: generatedRoot,
          env: sanitizeCleanRoomEnv({
            repoRoot,
            cwd: generatedRoot,
            extra: { ...CONSUMER_BUILD_ENV, ...consumerToolingEnv },
          }),
          timeout: CLEAN_ROOM_TIMEOUTS_MS.build,
        }
      );
    },
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    writeHelp();
    return 0;
  }

  const repoRoot = resolveAtlasRepoRoot(path.dirname(scriptPath));
  const pnpm = resolveCommandPath("pnpm");
  const cliPackageRoot = path.join(repoRoot, "packages", "cli");
  let layout;
  let packageRegistry;
  let failed = false;

  try {
    layout = createCleanRoomLayout(repoRoot);
    const packEnv = {
      ...process.env,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    };

    runStage(CLEAN_ROOM_STAGES.packCli, pnpm, PUBLIC_CLI_WORKSPACE_BUILD_ARGS, {
      cwd: repoRoot,
      env: packEnv,
      timeout: CLEAN_ROOM_TIMEOUTS_MS.packCli,
    });
    process.stdout.write(`${CLEAN_ROOM_STAGE_PREFIX} ${CLEAN_ROOM_STAGES.npmPublishDryRun}\n`);
    try {
      verifyNpmPublishDryRun({ packageRoot: cliPackageRoot, env: packEnv });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${CLEAN_ROOM_STAGE_PREFIX} FAILED ${CLEAN_ROOM_STAGES.npmPublishDryRun}\n${message}`
      );
    }
    runStage(CLEAN_ROOM_STAGES.packCli, pnpm, ["pack", "--pack-destination", layout.artifacts], {
      cwd: cliPackageRoot,
      env: packEnv,
      timeout: CLEAN_ROOM_TIMEOUTS_MS.packCli,
    });

    const tarballPath = findPackedTarball(layout.artifacts);
    if (!existsSync(tarballPath)) {
      throw new Error(`Packed CLI tarball was not created at ${tarballPath}`);
    }
    const packedManifest = JSON.parse(
      readFileSync(path.join(cliPackageRoot, "package.json"), "utf8")
    );
    const packageRegistryServer = await startLocalPackageRegistryProcess({
      name: PUBLIC_CLI_PACKAGE_NAME,
      latest: packedManifest.version,
      versions: [{ version: packedManifest.version, tarballPath }],
    });
    packageRegistry = packageRegistryServer;

    const harnessEnv = sanitizeCleanRoomEnv({ repoRoot, cwd: layout.harness });
    runStage(CLEAN_ROOM_STAGES.installCli, pnpm, ["add", tarballPath], {
      cwd: layout.harness,
      env: harnessEnv,
      timeout: CLEAN_ROOM_TIMEOUTS_MS.installCli,
    });

    const atlasBin = installedAtlasBinary(layout.harness);
    const cliInstalled = installedCliPackage(layout.harness);
    assertExecutable(atlasBin, "Installed Atlas binary");
    assertOutsideRepo(repoRoot, layout.harness, "Clean-room harness");
    assertOutsideRepo(repoRoot, atlasBin, "Installed Atlas binary");
    assertOutsideRepo(repoRoot, cliInstalled, `Installed ${PUBLIC_CLI_PACKAGE_NAME}`);
    if (isInsideDirectory(cliPackageRoot, cliInstalled)) {
      throw new Error("Installed CLI resolved to the source-tree package");
    }

    const atlas = realpathSync(atlasBin);
    const initEnv = sanitizeCleanRoomEnv({ repoRoot, cwd: layout.root });
    runStage(CLEAN_ROOM_STAGES.init, atlas, ["init", GENERATED_PROJECT_NAME], {
      cwd: layout.root,
      env: initEnv,
      timeout: CLEAN_ROOM_TIMEOUTS_MS.init,
    });

    const generatedRoot = layout.generatedRoot;
    if (!existsSync(generatedRoot)) {
      throw new Error(`atlas init did not create ${generatedRoot}`);
    }
    assertOutsideRepo(repoRoot, generatedRoot, "Generated project");
    const generatedManifest = assertGeneratedProjectShape(generatedRoot, repoRoot);
    if (generatedManifest.scripts?.atlas !== "atlas") {
      throw new Error("Generated package.json is missing the atlas script");
    }
    if (
      generatedManifest.devDependencies?.["@blitzcraftlabs/atlas"] !== generatedManifest.version &&
      generatedManifest.devDependencies?.["@blitzcraftlabs/atlas"] !==
        readGeneratedBaseline(generatedRoot)
    ) {
      throw new Error(
        `Generated @blitzcraftlabs/atlas pin is ${String(generatedManifest.devDependencies?.["@blitzcraftlabs/atlas"])}`
      );
    }
    const atlasVersion = readGeneratedBaseline(generatedRoot);
    if (generatedManifest.version === atlasVersion) {
      throw new Error("Generated app version must remain independent of the Atlas baseline");
    }

    const consumerToolingEnv = {
      TURBO_CACHE_DIR: path.join(generatedRoot, "node_modules", ".cache", "turbo"),
      TURBO_DAEMON: "false",
    };
    const consumerEnv = sanitizeCleanRoomEnv({
      repoRoot,
      cwd: generatedRoot,
      extra: consumerToolingEnv,
    });
    writeFileSync(
      path.join(generatedRoot, ".npmrc"),
      `@blitzcraftlabs:registry=${packageRegistry.url}/\n`
    );
    const consumerPnpm = resolveGeneratedProjectPnpm({
      generatedRoot,
      env: consumerEnv,
    });
    process.stdout.write(
      `${CLEAN_ROOM_STAGE_PREFIX} consumer pnpm@${consumerPnpm.version} via ${consumerPnpm.source}\n`
    );
    runStage(
      CLEAN_ROOM_STAGES.installConsumer,
      consumerPnpm.command,
      generatedProjectPnpmArgs(consumerPnpm, ["install"]),
      {
        cwd: generatedRoot,
        env: consumerEnv,
        timeout: CLEAN_ROOM_TIMEOUTS_MS.installConsumer,
      }
    );
    if (!existsSync(path.join(generatedRoot, "pnpm-lock.yaml"))) {
      throw new Error("pnpm install did not create pnpm-lock.yaml");
    }
    const installedCliManifest = JSON.parse(
      readFileSync(
        path.join(generatedRoot, "node_modules", "@blitzcraftlabs", "atlas", "package.json"),
        "utf8"
      )
    );
    const installedCli = readFileSync(
      path.join(generatedRoot, "node_modules", "@blitzcraftlabs", "atlas", "dist", "cli.js"),
      "utf8"
    );
    if (installedCliManifest.version !== atlasVersion) {
      throw new Error(
        `Installed ${PUBLIC_CLI_PACKAGE_NAME} is ${installedCliManifest.version}, expected packed ${atlasVersion}`
      );
    }
    if (!installedCli.includes("ATLAS_UPGRADE_HANDOFF")) {
      throw new Error(
        "Consumer install resolved a CLI build that does not contain upgrade handoff"
      );
    }
    const versionCheck = runStage(
      CLEAN_ROOM_STAGES.doctor,
      consumerPnpm.command,
      generatedProjectPnpmArgs(consumerPnpm, ["atlas", "--version"]),
      {
        cwd: generatedRoot,
        env: consumerEnv,
        timeout: CLEAN_ROOM_TIMEOUTS_MS.doctor,
      }
    );
    if (!versionCheck.stdout.includes(atlasVersion)) {
      throw new Error(
        `pnpm atlas --version did not report ${atlasVersion}\n${versionCheck.stdout}`
      );
    }
    const workspaceIssues = auditGeneratedWorkspace(generatedRoot);
    if (workspaceIssues.length > 0) {
      throw new Error(`Generated workspace audit failed:\n${workspaceIssues.join("\n")}`);
    }
    const resolutionIssues = collectWorkspaceResolutionIssues(generatedRoot);
    if (resolutionIssues.length > 0) {
      throw new Error(`Generated workspace resolution failed:\n${resolutionIssues.join("\n")}`);
    }

    const buildEnv = sanitizeCleanRoomEnv({
      repoRoot,
      cwd: generatedRoot,
      extra: { ...CONSUMER_BUILD_ENV, ...consumerToolingEnv },
    });
    runStage(
      CLEAN_ROOM_STAGES.build,
      consumerPnpm.command,
      generatedProjectPnpmArgs(consumerPnpm, ["build"]),
      {
        cwd: generatedRoot,
        env: buildEnv,
        timeout: CLEAN_ROOM_TIMEOUTS_MS.build,
      }
    );

    const doctor = runStage(
      CLEAN_ROOM_STAGES.doctor,
      atlas,
      ["doctor", "--json", "--cwd", generatedRoot],
      {
        cwd: layout.harness,
        env: sanitizeCleanRoomEnv({ repoRoot, cwd: layout.harness }),
        timeout: CLEAN_ROOM_TIMEOUTS_MS.doctor,
      }
    );
    const doctorEnvelope = parseJsonEnvelope(doctor.stdout, "atlas doctor --json");
    const doctorIssues = assertDoctorReport(doctorEnvelope, {
      atlasVersion,
      appVersion: generatedManifest.version,
      generatedRoot,
      repoRoot,
    });
    if (doctorIssues.length > 0) {
      throw new Error(`Doctor assertions failed:\n${doctorIssues.join("\n")}\n${doctor.stdout}`);
    }

    runStage(
      CLEAN_ROOM_STAGES.generate,
      atlas,
      ["generate", "feature", GENERATOR_FEATURE_NAME, "--cwd", generatedRoot],
      {
        cwd: layout.harness,
        env: sanitizeCleanRoomEnv({ repoRoot, cwd: layout.harness }),
        timeout: CLEAN_ROOM_TIMEOUTS_MS.generate,
      }
    );
    runStage(
      CLEAN_ROOM_STAGES.generate,
      atlas,
      ["generate", "page", GENERATOR_PAGE_ROUTE, "--cwd", generatedRoot],
      {
        cwd: layout.harness,
        env: sanitizeCleanRoomEnv({ repoRoot, cwd: layout.harness }),
        timeout: CLEAN_ROOM_TIMEOUTS_MS.generate,
      }
    );
    assertGeneratorOutput(generatedRoot);

    runStage(
      CLEAN_ROOM_STAGES.typecheck,
      consumerPnpm.command,
      generatedProjectPnpmArgs(consumerPnpm, ["typecheck"]),
      {
        cwd: generatedRoot,
        env: sanitizeCleanRoomEnv({
          repoRoot,
          cwd: generatedRoot,
          extra: consumerToolingEnv,
        }),
        timeout: CLEAN_ROOM_TIMEOUTS_MS.typecheck,
      }
    );

    const context = runStage(
      CLEAN_ROOM_STAGES.context,
      atlas,
      ["context", "--json", "--cwd", generatedRoot],
      {
        cwd: layout.harness,
        env: sanitizeCleanRoomEnv({ repoRoot, cwd: layout.harness }),
        timeout: CLEAN_ROOM_TIMEOUTS_MS.context,
      }
    );
    const contextEnvelope = parseJsonEnvelope(context.stdout, "atlas context --json");
    const contextIssues = assertContextReport(contextEnvelope, {
      atlasVersion,
      generatedRoot,
      repoRoot,
    });
    if (contextIssues.length > 0) {
      throw new Error(`Context assertions failed:\n${contextIssues.join("\n")}\n${context.stdout}`);
    }

    proveInstalledUpgradeBoundary({
      atlas,
      generatedRoot,
      cliInstalled,
      repoRoot,
      harness: layout.harness,
      consumerPnpm,
      consumerToolingEnv,
    });

    process.stdout.write(
      `${CLEAN_ROOM_STAGE_PREFIX} ok ${GENERATED_PROJECT_NAME} @ Atlas ${atlasVersion}\n`
    );
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
  }

  if (packageRegistry) {
    await packageRegistry.close();
  }

  if (layout?.root) {
    const cleanupFailed = reportCleanRoomRetention({
      root: layout.root,
      explicitKeep: options.keep,
      failed,
    });
    if (cleanupFailed) {
      return 1;
    }
  }

  return failed ? 1 : 0;
}

/**
 * @param {{
 *   root: string;
 *   explicitKeep: boolean;
 *   failed: boolean;
 * }} options
 * @returns {boolean} true when directory removal failed
 */
function reportCleanRoomRetention(options) {
  const write = options.failed
    ? (message) => process.stderr.write(message)
    : (message) => process.stdout.write(message);
  const retention = finalizeCleanRoom({
    root: options.root,
    explicitKeep: options.explicitKeep,
    isCi: isCiEnvironment(process.env),
    failed: options.failed,
    write,
  });
  if (!retention.cleanupError) {
    return false;
  }
  process.stderr.write(
    `${CLEAN_ROOM_STAGE_PREFIX} cleanup failed ${options.root}: ${retention.cleanupError.message}\n`
  );
  return true;
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(scriptPath).href
) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
      );
      process.exitCode = 1;
    });
}
