/**
 * Isolate test processes from an ambient Git repository.
 *
 * Git exports GIT_DIR (and sometimes GIT_WORK_TREE / GIT_INDEX_FILE) to hooks. In a linked
 * worktree, a pre-push hook that runs `pnpm test` therefore hands every test subprocess a
 * GIT_DIR pointing at the developer's real repository. Fixture code that does
 * `git init` / `git commit` / `git config` inside a temporary directory then writes into the
 * real repository instead (fixture commits, moved branches, "Atlas Fixture" identity,
 * core.bare=true).
 *
 * These variables select which repository Git operates on. Tests must never inherit them.
 */

export const REPOSITORY_SELECTING_GIT_ENV = Object.freeze([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
]);

/**
 * Return a copy of `env` without repository-selecting Git variables.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
export function withoutRepositoryGitEnv(env) {
  const copy = { ...env };
  for (const name of REPOSITORY_SELECTING_GIT_ENV) {
    delete copy[name];
  }
  return copy;
}

/**
 * Remove repository-selecting Git variables from this process so every child inherits a clean
 * environment. Returns the names that were removed.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function isolateFromAmbientGitRepository(env = process.env) {
  const removed = [];
  for (const name of REPOSITORY_SELECTING_GIT_ENV) {
    if (name in env) {
      delete env[name];
      removed.push(name);
    }
  }
  return removed;
}
