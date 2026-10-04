import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const cacheDir = path.join(scriptDir, ".cache");
const outfile = path.join(cacheDir, "published-catalog-verifier.cjs");

/**
 * Bundle the TypeScript catalog rules into a temporary CJS module.
 *
 * The public CLI build emits selected entry points only (`dist/cli.js`,
 * `dist/release-assets.js`, and the other bundle outputs). Internal
 * `src/upgrade/*` modules are not independently require-able from `dist/upgrade`.
 *
 * @returns {{
 *   listProductionSnapshotVersions: (productionRoot: string) => string[];
 *   sourceProductionReleasesRoot: (packageRoot: string) => string;
 *   assertUpgradeCatalogMatchesPublishedIdentity: (options: {
 *     catalog: { current: string; supportedVersions: string[] };
 *     snapshotVersions: string[];
 *     publishedVersions: string[];
 *   }) => void;
 * }}
 */
export function loadPublishedCatalogVerifier() {
  mkdirSync(cacheDir, { recursive: true });
  esbuild.buildSync({
    absWorkingDir: packageRoot,
    bundle: true,
    entryPoints: [path.join(packageRoot, "src/upgrade/published-catalog-verifier.ts")],
    outfile,
    format: "cjs",
    legalComments: "none",
    logLevel: "warning",
    platform: "node",
    sourcemap: false,
    target: "node22",
  });

  const require = createRequire(import.meta.url);
  const resolved = require.resolve(outfile);
  delete require.cache[resolved];
  const verifier = require(resolved);
  if (
    typeof verifier.listProductionSnapshotVersions !== "function" ||
    typeof verifier.sourceProductionReleasesRoot !== "function" ||
    typeof verifier.assertUpgradeCatalogMatchesPublishedIdentity !== "function"
  ) {
    throw new Error(
      "Published catalog verifier bundle is missing the catalog identity checks. Refusing to treat a partial bundle as publication proof."
    );
  }
  return verifier;
}
