import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { CliError, CliErrorCode } from "../errors/cli-error";
import { assertCleanWorktreeForMutation, detectWorktreeStatus } from "../upgrade/worktree";

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

/** Real repository with one committed file, isolated from the developer's Git config. */
function initRepository(root: string): void {
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.email", "atlas-test@example.invalid"]);
  git(root, ["config", "user.name", "Atlas Test"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  writeFileSync(path.join(root, "tracked.txt"), "original\n", "utf8");
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src", "app.ts"), "export {};\n", "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "-m", "initial"]);
}

describe("worktree status", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "atlas-worktree-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("treats a directory that is not a Git repository as unknown, not clean or dirty", () => {
    mkdirSync(path.join(root, ".git"), { recursive: true });
    writeFileSync(path.join(root, "dirty.txt"), "change\n", "utf8");

    expect(detectWorktreeStatus(root)).toEqual({
      isGitRepository: false,
      isDirty: false,
      changedPaths: [],
    });
  });

  it("reports a freshly committed repository as clean", () => {
    initRepository(root);

    expect(detectWorktreeStatus(root)).toEqual({
      isGitRepository: true,
      isDirty: false,
      changedPaths: [],
    });
  });

  it("reports full paths for unstaged, staged, and untracked changes", () => {
    initRepository(root);
    // Unstaged modification: porcelain line starts with a space (" M src/app.ts").
    writeFileSync(path.join(root, "src", "app.ts"), "export const changed = true;\n", "utf8");
    // Staged modification: "M  tracked.txt".
    writeFileSync(path.join(root, "tracked.txt"), "staged\n", "utf8");
    git(root, ["add", "tracked.txt"]);
    // Untracked file: "?? notes.md".
    writeFileSync(path.join(root, "notes.md"), "draft\n", "utf8");

    const status = detectWorktreeStatus(root);

    expect(status.isGitRepository).toBe(true);
    expect(status.isDirty).toBe(true);
    expect([...status.changedPaths].sort()).toEqual(["notes.md", "src/app.ts", "tracked.txt"]);
  });
});

describe("assertCleanWorktreeForMutation", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "atlas-worktree-guard-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("refuses to mutate a dirty repository and names the changed paths", () => {
    initRepository(root);
    writeFileSync(path.join(root, "src", "app.ts"), "export const local = 1;\n", "utf8");

    let thrown: unknown;
    try {
      assertCleanWorktreeForMutation({ repoRoot: root, allowDirty: false });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CliError);
    expect((thrown as CliError).code).toBe(CliErrorCode.UPGRADE_BLOCKED);
    expect((thrown as CliError).message).toMatch(/--allow-dirty/);
    expect((thrown as CliError).details).toEqual(["src/app.ts"]);
  });

  it("allows a dirty repository only with allowDirty", () => {
    initRepository(root);
    writeFileSync(path.join(root, "tracked.txt"), "local edit\n", "utf8");

    expect(() =>
      assertCleanWorktreeForMutation({ repoRoot: root, allowDirty: true })
    ).not.toThrow();
  });

  it("allows a clean repository", () => {
    initRepository(root);

    expect(() =>
      assertCleanWorktreeForMutation({ repoRoot: root, allowDirty: false })
    ).not.toThrow();
  });

  it("caps reported paths at 20", () => {
    initRepository(root);
    for (let index = 0; index < 25; index += 1) {
      writeFileSync(path.join(root, `untracked-${String(index).padStart(2, "0")}.txt`), "x\n");
    }

    let thrown: unknown;
    try {
      assertCleanWorktreeForMutation({ repoRoot: root, allowDirty: false });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CliError);
    expect((thrown as CliError).details).toHaveLength(20);
  });

  it("does not block outside a Git repository", () => {
    writeFileSync(path.join(root, "file.txt"), "x\n", "utf8");

    expect(() =>
      assertCleanWorktreeForMutation({ repoRoot: root, allowDirty: false })
    ).not.toThrow();
  });
});
