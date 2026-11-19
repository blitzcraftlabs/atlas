import { spawnSync } from "node:child_process";

import { CliError, CliErrorCode } from "../errors/cli-error";

export interface WorktreeStatus {
  isGitRepository: boolean;
  isDirty: boolean;
  changedPaths: string[];
}

export function detectWorktreeStatus(repoRoot: string): WorktreeStatus {
  const result = spawnSync("git", ["-C", repoRoot, "status", "--porcelain"], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return {
      isGitRepository: false,
      isDirty: false,
      changedPaths: [],
    };
  }

  // Porcelain v1 lines are "XY <path>": a fixed two-character status, a space, then the path.
  // The status can start with a space (" M file" = unstaged change), so lines must not be trimmed
  // before slicing off the status, or the first characters of the path are lost.
  const lines = result.stdout.split("\n").filter((line) => line.trim().length > 0);

  const changedPaths = lines.map((line) => line.slice(3).trim());

  return {
    isGitRepository: true,
    isDirty: lines.length > 0,
    changedPaths,
  };
}

export function assertCleanWorktreeForMutation(options: {
  repoRoot: string;
  allowDirty: boolean;
}): void {
  const status = detectWorktreeStatus(options.repoRoot);

  if (!status.isGitRepository) {
    return;
  }

  if (status.isDirty && !options.allowDirty) {
    throw new CliError(
      CliErrorCode.UPGRADE_BLOCKED,
      "Refusing to mutate the repository because the Git worktree has uncommitted changes. Commit or stash changes, or pass --allow-dirty to override.",
      {
        details: status.changedPaths.slice(0, 20),
      }
    );
  }
}
