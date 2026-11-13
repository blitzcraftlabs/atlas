/**
 * Jest globalSetup: drop repository-selecting Git variables inherited from Git hooks.
 *
 * A pre-push hook run from a linked worktree exports GIT_DIR. CLI tests spawn `git` in temporary
 * fixture directories; with GIT_DIR inherited, those commands target the developer's real
 * repository instead. This must run as globalSetup (in the parent process, before workers start):
 * setupFiles only edit the sandboxed `process.env`, which child processes do not inherit.
 * Mirrors scripts/lib/git-env-isolation.mjs.
 */
const REPOSITORY_SELECTING_GIT_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
];

module.exports = async function isolateFromAmbientGitRepository() {
  for (const name of REPOSITORY_SELECTING_GIT_ENV) {
    delete process.env[name];
  }
};
