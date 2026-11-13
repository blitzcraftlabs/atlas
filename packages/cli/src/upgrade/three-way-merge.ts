import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { UpgradePlanItem } from "./types";

export type ThreeWayMergeResult =
  | { status: "clean"; content: string }
  | { status: "conflict"; content: string; conflicts: number }
  | { status: "unavailable"; reason: string };

/**
 * diff3 merge via `git merge-file`: base = source Atlas release, ours = consumer file,
 * theirs = target Atlas release. Conflict markers are labelled so a reviewer can tell
 * which side is which. Returns `unavailable` when git cannot run.
 */
export function threeWayMerge(options: {
  base: string;
  ours: string;
  theirs: string;
  labels?: { ours: string; base: string; theirs: string };
}): ThreeWayMergeResult {
  const labels = options.labels ?? {
    ours: "consumer",
    base: "atlas-source",
    theirs: "atlas-target",
  };
  const dir = mkdtempSync(path.join(os.tmpdir(), "atlas-merge-"));
  try {
    const ours = path.join(dir, "ours");
    const base = path.join(dir, "base");
    const theirs = path.join(dir, "theirs");
    writeFileSync(ours, options.ours);
    writeFileSync(base, options.base);
    writeFileSync(theirs, options.theirs);
    const result = spawnSync(
      "git",
      ["merge-file", "-L", labels.ours, "-L", labels.base, "-L", labels.theirs, ours, base, theirs],
      { encoding: "utf8" }
    );
    if (result.error || result.status === null || result.status < 0 || result.status > 127) {
      return {
        status: "unavailable",
        reason: result.error?.message ?? `git merge-file exited ${String(result.status)}`,
      };
    }
    const content = readFileSync(ours, "utf8");
    return result.status === 0
      ? { status: "clean", content }
      : { status: "conflict", content, conflicts: result.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface MergeResolution {
  /** Merged content keyed by item relative path, applied in place of target content. */
  contentOverrides: Record<string, string>;
  /** Conflict-marked content for sidecar review files, keyed by item relative path. */
  conflictContents: Record<string, string>;
}

/**
 * Annotate `merge-required` items whose consumer file was modified with the outcome of a
 * three-way merge. With `apply`, clean merges become `merge` actions that no longer block.
 * Security-critical items are never merged automatically.
 */
export function resolveThreeWayMerges(options: {
  items: UpgradePlanItem[];
  apply: boolean;
  sourceVersion: string;
  targetVersion: string;
  sourceContent: (item: UpgradePlanItem) => string | undefined;
  targetContent: (item: UpgradePlanItem) => string | undefined;
  consumerContent: (item: UpgradePlanItem) => string | undefined;
  merge?: typeof threeWayMerge;
}): MergeResolution {
  const merge = options.merge ?? threeWayMerge;
  const resolution: MergeResolution = { contentOverrides: {}, conflictContents: {} };
  for (const item of options.items) {
    if (
      item.category !== "merge-required" ||
      item.action !== "manual-review" ||
      item.baselineStatus !== "modified" ||
      item.securityCritical
    ) {
      continue;
    }
    const base = options.sourceContent(item);
    const theirs = options.targetContent(item);
    const ours = options.consumerContent(item);
    if (base === undefined || theirs === undefined || ours === undefined) continue;

    const result = merge({
      base,
      ours,
      theirs,
      labels: {
        ours: `consumer ${item.relativePath}`,
        base: `atlas ${options.sourceVersion}`,
        theirs: `atlas ${options.targetVersion}`,
      },
    });
    if (result.status === "unavailable") {
      item.autoMerge = "unavailable";
      continue;
    }
    if (result.status === "conflict") {
      item.autoMerge = "conflict";
      item.mergeConflicts = result.conflicts;
      item.message = `${item.message} A three-way merge has ${result.conflicts} conflicting hunk(s).`;
      resolution.conflictContents[item.relativePath] = result.content;
      continue;
    }
    item.autoMerge = "clean";
    if (options.apply) {
      item.action = "merge";
      item.conflict = false;
      item.message = `Consumer changes to ${item.relativePath} and Atlas ${options.targetVersion} changes merged cleanly (three-way). Review the diff before committing.`;
      resolution.contentOverrides[item.relativePath] = result.content;
    } else {
      item.message = `${item.message} A three-way merge applies cleanly; rerun with --merge to apply it.`;
    }
  }
  return resolution;
}

/** Directory (repo-relative) for conflict-marked merge results awaiting human review. */
export const MERGE_SIDECAR_DIR = ".atlas/merge";

/**
 * Write conflict-marked merges as `.atlas/merge/<path>.merge` sidecars. The consumer's file is
 * never touched. The `.merge` suffix keeps lint, typecheck, and tests from picking them up.
 */
export function writeMergeSidecars(options: {
  repoRoot: string;
  applicationRoot: string;
  items: UpgradePlanItem[];
  conflictContents: Record<string, string>;
}): string[] {
  const written: string[] = [];
  for (const item of options.items) {
    const content = options.conflictContents[item.relativePath];
    if (content === undefined) continue;
    const repoRelative =
      item.pathScope === "repository"
        ? item.relativePath
        : path.posix.join(options.applicationRoot, item.relativePath);
    const sidecar = path.posix.join(MERGE_SIDECAR_DIR, `${repoRelative}.merge`);
    const absolute = path.join(options.repoRoot, sidecar);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
    written.push(sidecar);
  }
  return written;
}
