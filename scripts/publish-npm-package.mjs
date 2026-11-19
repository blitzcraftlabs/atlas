#!/usr/bin/env node
/**
 * GitHub Actions OIDC publisher for `@blitzcraftlabs/atlas`.
 *
 * Default is dry-run. Live publication requires --oidc on GitHub Actions after
 * the package already exists. The first version must be published from the
 * validated tarball by a human.
 *
 * Already-published versions no-op without packing. Missing package/version
 * publication packs only from the exact canonical `vX.Y.Z` tag.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveAtlasRepoRoot } from "./lib/distribution-clean-room.mjs";
import { runNpmPublication } from "./lib/npm-publication.mjs";

const scriptPath = fileURLToPath(import.meta.url);

function writeHelp() {
  process.stdout.write(`Usage: pnpm distribution:publish-npm [--dry-run | --oidc] [--skip-build]

Query npm for the current Atlas version, then either no-op or pack/publish:

  --dry-run   Decide/publication-check without publishing (default)
  --oidc      Publish that exact tarball with npm Trusted Publishing

If the exact npm version already exists, this command no-ops without packing.
If the package or version is missing, it fails closed unless HEAD is the exact
canonical vX.Y.Z tag matching the package version (clean checkout, HEAD SHA
equals the tagged commit). The first publication cannot use OIDC because the
package does not exist yet. That path is
\`pnpm distribution:prepare-publish --require-release-tag\` plus a human
\`npm publish\` of the printed tarball. This command never authenticates with
NPM_TOKEN.
`);
}

export function parseArgs(argv) {
  const options = { help: false, dryRun: false, oidc: false, skipBuild: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--oidc") {
      options.oidc = true;
    } else if (arg === "--skip-build") {
      options.skipBuild = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.oidc && options.dryRun) {
    throw new Error("Use either --oidc or --dry-run, not both");
  }
  if (!options.oidc) {
    options.dryRun = true;
  }
  return options;
}

function readNpmVersion() {
  const result = spawnSync("npm", ["--version"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error("Unable to read npm --version for Trusted Publishing");
  }
  return result.stdout.trim();
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    writeHelp();
    return 0;
  }

  const repoRoot = resolveAtlasRepoRoot(path.dirname(scriptPath));
  await runNpmPublication({
    repoRoot,
    skipBuild: options.skipBuild,
    dryRun: options.dryRun,
    oidc: options.oidc,
    githubActions: process.env.GITHUB_ACTIONS === "true",
    nodeVersion: process.versions.node,
    npmVersion: options.oidc && !options.dryRun ? readNpmVersion() : undefined,
  });
  return 0;
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
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
