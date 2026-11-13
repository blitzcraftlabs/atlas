import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  isolateFromAmbientGitRepository,
  REPOSITORY_SELECTING_GIT_ENV,
  withoutRepositoryGitEnv,
} from "../lib/git-env-isolation.mjs";

test("withoutRepositoryGitEnv drops repository-selecting variables and keeps the rest", () => {
  const env = {
    GIT_DIR: "/repo/.git",
    GIT_INDEX_FILE: "/repo/.git/index",
    PATH: "/bin",
    GIT_EDITOR: "true",
  };
  const result = withoutRepositoryGitEnv(env);

  assert.deepEqual(result, { PATH: "/bin", GIT_EDITOR: "true" });
  assert.equal(env.GIT_DIR, "/repo/.git", "input is not mutated");
});

test("isolateFromAmbientGitRepository removes variables in place and reports them", () => {
  const env = { GIT_DIR: "/repo/.git", GIT_WORK_TREE: "/repo", HOME: "/home/x" };

  assert.deepEqual(isolateFromAmbientGitRepository(env), ["GIT_DIR", "GIT_WORK_TREE"]);
  assert.deepEqual(env, { HOME: "/home/x" });
});

test("covers the variables Git exports to hooks", () => {
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
    assert.ok(REPOSITORY_SELECTING_GIT_ENV.includes(name), `${name} must be isolated`);
  }
});

test("a fixture repository created after isolation does not touch the ambient GIT_DIR repo", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "atlas-git-env-isolation-"));
  try {
    const ambient = path.join(root, "ambient");
    const fixture = path.join(root, "fixture");
    execFileSync("git", ["init", "-q", ambient]);
    const ambientGitDir = path.join(ambient, ".git");

    const env = withoutRepositoryGitEnv({ ...process.env, GIT_DIR: ambientGitDir });
    execFileSync("git", ["init", "-q", fixture], { env });
    execFileSync("git", ["config", "user.name", "Atlas Fixture"], { cwd: fixture, env });

    const ambientName = (() => {
      try {
        return execFileSync("git", ["--git-dir", ambientGitDir, "config", "--local", "user.name"], {
          encoding: "utf8",
        });
      } catch {
        return "";
      }
    })();
    assert.equal(ambientName, "", "fixture identity must not leak into the ambient repository");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
