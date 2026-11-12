import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { SNAPSHOT_PACKAGE_MANIFEST_PATHS } from "./release-constants";
import { compareAtlasVersions, isExactAtlasReleaseVersion } from "./version-compare";

export interface StaleVersionRepair {
  relativePath: string;
  from: string;
  to: string;
}

/**
 * Before a multi-release hop, align Atlas-owned workspace `version` fields that older CLIs
 * left behind.
 *
 * Atlas CLIs before 1.3.2 did not advance `apps/web/package.json#version` (and other
 * workspace versions) during upgrades. Published CLIs from 1.3.2 onward treat a value that is
 * neither the source nor the target release as a consumer modification and block. A value that
 * is an *earlier Atlas release* than the current baseline is not a consumer edit: it is exactly
 * what an older CLI left. Only those values are rewritten to the baseline version.
 */
export function repairStaleWorkspaceVersions(options: {
  repoRoot: string;
  baselineVersion: string;
  knownAtlasVersions: readonly string[];
  dryRun?: boolean;
}): StaleVersionRepair[] {
  const known = new Set(options.knownAtlasVersions);
  const repairs: StaleVersionRepair[] = [];
  for (const relativePath of SNAPSHOT_PACKAGE_MANIFEST_PATHS) {
    const manifestPath = path.join(options.repoRoot, relativePath);
    if (!existsSync(manifestPath)) continue;
    const raw = readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(raw) as { version?: unknown };
    const current = manifest.version;
    if (
      typeof current !== "string" ||
      !isExactAtlasReleaseVersion(current) ||
      !known.has(current) ||
      compareAtlasVersions(current, options.baselineVersion) >= 0
    ) {
      continue;
    }
    repairs.push({ relativePath, from: current, to: options.baselineVersion });
    if (!options.dryRun) {
      const updated = raw.replace(
        /("version"\s*:\s*)"[^"]*"/,
        `$1${JSON.stringify(options.baselineVersion)}`
      );
      writeFileSync(manifestPath, updated);
    }
  }
  return repairs;
}
