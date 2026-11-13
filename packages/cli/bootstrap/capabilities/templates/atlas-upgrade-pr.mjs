#!/usr/bin/env node
/**
 * Atlas upgrade bot for generated consumers (`atlas enable upgrades`).
 *
 * 1. `pnpm atlas upgrade --dry-run --json`. Nothing to do when Atlas is current.
 * 2. Apply on the rolling `atlas/upgrade` branch with `pnpm atlas upgrade --json`.
 * 3. Success: commit, push, and open or update one pull request.
 *    Blocked/failed: discard file changes and open or update one issue listing what needs a human.
 *
 * Consumer-owned after enablement. Requires `gh` and `git` (present on GitHub-hosted runners).
 */

import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BRANCH = "atlas/upgrade";
export const LABEL = "atlas-upgrade";
const MARKER = "<!-- atlas-upgrade-bot -->";

function sh(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });
}

/**
 * Last JSON object line in mixed output. pnpm script banners and `pnpm dlx` progress can share
 * stdout with the CLI's single-line JSON envelope.
 */
export function parseLastJsonLine(stdout) {
  const lines = String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"));
  for (const line of lines.reverse()) {
    try {
      return JSON.parse(line);
    } catch {
      // keep looking
    }
  }
  return null;
}

/** Runs `pnpm atlas upgrade` and returns `{ exitCode, result }` from its JSON envelope. */
export function runAtlasUpgrade(args, run = spawnSync) {
  const child = run("pnpm", ["--silent", "atlas", "upgrade", "--json", ...args], {
    encoding: "utf8",
  });
  const envelope = parseLastJsonLine(child.stdout);
  return {
    exitCode: child.status ?? 1,
    result: envelope?.result ?? null,
    error: envelope?.error ?? null,
    stderr: String(child.stderr ?? ""),
  };
}

function bullet(items, render) {
  return items.length === 0 ? "_None._" : items.map((item) => `- ${render(item)}`).join("\n");
}

function hopPath(result) {
  return result?.hops?.length > 1 ? [result.sourceVersion, ...result.hops].join(" → ") : null;
}

/** Items from a single-hop result or from every hop of a multi-hop result. */
export function collectItems(result) {
  if (!result) return [];
  const nested = (result.hopResults ?? []).flatMap((hop) => hop?.result?.items ?? []);
  return [...(result.items ?? []), ...nested];
}

/** Pull request body for a successful upgrade. */
export function renderPullRequestBody({ result, plan }) {
  const items = collectItems(result).filter((item) => item.action !== "skip");
  const review = items.filter((item) =>
    ["manual-review", "merge-required", "security-critical", "migration-required"].includes(
      item.category
    )
  );
  const lines = [
    MARKER,
    `## Atlas ${result.sourceVersion} → ${result.targetVersion}`,
    "",
    "Opened by the Atlas upgrade workflow (`.github/workflows/atlas-upgrade.yml`).",
    "",
  ];
  const path = hopPath(result) ?? hopPath(plan);
  if (path) lines.push(`**Upgrade path:** ${path}`, "");
  lines.push(
    "### Applied",
    bullet(
      items.filter((item) => !review.includes(item)),
      (item) => `\`${item.relativePath}\` — ${item.action}`
    ),
    "",
    "### Review before merging",
    bullet(review, (item) => `\`${item.relativePath}\` — ${item.category}`),
    "",
    "### Validation",
    `- atlas doctor: ${result.validation?.doctor ?? "see hop results"}`,
    `- dependency install: ${result.dependencyInstall ?? "see hop results"}`,
    "",
    "Run your usual checks (`pnpm lint && pnpm typecheck && pnpm test && pnpm build`) before merging.",
    "Changelog: https://github.com/blitzcraftlabs/atlas/blob/main/CHANGELOG.md"
  );
  return lines.join("\n");
}

/** Issue body when the upgrade needs a human (blocking conflicts or failed validation). */
export function renderBlockedIssueBody({ plan, result, exitCode }) {
  const source = result ?? plan ?? {};
  const conflicts = [
    ...(source.conflicts ?? []),
    ...(source.hopResults ?? []).flatMap((hop) => hop?.result?.conflicts ?? []),
  ];
  const lines = [
    MARKER,
    `## Atlas ${source.sourceVersion ?? "?"} → ${source.targetVersion ?? "?"} needs attention`,
    "",
    `\`pnpm atlas upgrade\` exited with code ${exitCode} (status: \`${source.status ?? "unknown"}\`). No files were changed on \`main\`.`,
    "",
  ];
  const path = hopPath(source);
  if (path) lines.push(`**Upgrade path:** ${path}`, "");
  lines.push(
    "### Blocking items",
    bullet(conflicts, (item) =>
      `\`${item.relativePath}\` — ${item.category}: ${item.message ?? ""}`.trim()
    ),
    "",
    "### Messages",
    bullet(source.messages ?? [], (message) => message),
    "",
    "Resolve locally with `pnpm atlas upgrade --dry-run`, merge the listed files by hand, then run",
    "`pnpm atlas upgrade`. This issue updates on the next scheduled run."
  );
  return lines.join("\n");
}

function findOpen(kind, title) {
  const out = sh("gh", [
    kind,
    "list",
    "--state",
    "open",
    "--label",
    LABEL,
    "--json",
    "number,title",
    "--limit",
    "50",
  ]);
  return JSON.parse(out || "[]").find((entry) => entry.title === title) ?? null;
}

function ensureLabel() {
  spawnSync(
    "gh",
    ["label", "create", LABEL, "--color", "84cc16", "--description", "Atlas platform upgrade"],
    {
      stdio: "ignore",
    }
  );
}

function upsert(kind, title, body, extra = []) {
  ensureLabel();
  const existing = findOpen(kind, title);
  if (existing) {
    sh("gh", [kind, "edit", String(existing.number), "--body", body]);
    return existing.number;
  }
  sh("gh", [kind, "create", "--title", title, "--body", body, "--label", LABEL, ...extra]);
  return null;
}

export async function main() {
  const plan = runAtlasUpgrade(["--dry-run"]);
  if (plan.exitCode !== 0 && plan.exitCode !== 9) {
    process.stderr.write(`atlas upgrade --dry-run failed (exit ${plan.exitCode}).\n${plan.stderr}`);
    return 1;
  }
  if (plan.result?.status === "already-current") {
    process.stdout.write(`Atlas is current (${plan.result.sourceVersion}). Nothing to do.\n`);
    return 0;
  }
  const target = plan.result?.targetVersion ?? "latest";
  const title = `chore(atlas): upgrade Atlas to ${target}`;

  if (plan.exitCode === 9) {
    upsert("issue", title, renderBlockedIssueBody({ plan: plan.result, exitCode: 9 }));
    return 0;
  }

  sh("git", ["checkout", "-B", BRANCH]);
  const applied = runAtlasUpgrade([]);
  if (applied.exitCode !== 0) {
    sh("git", ["checkout", "--", "."]);
    sh("git", ["clean", "-fd"]);
    upsert(
      "issue",
      title,
      renderBlockedIssueBody({
        plan: plan.result,
        result: applied.result,
        exitCode: applied.exitCode,
      })
    );
    return 0;
  }

  if (!applied.result) {
    process.stderr.write(
      "atlas upgrade succeeded but returned no JSON result; refusing to open a PR.\n"
    );
    return 1;
  }
  sh("git", ["add", "-A"]);
  sh("git", [
    "-c",
    "user.name=github-actions[bot]",
    "-c",
    "user.email=41898282+github-actions[bot]@users.noreply.github.com",
    "commit",
    "-m",
    title,
  ]);
  sh("git", ["push", "--force", "origin", BRANCH]);
  upsert("pr", title, renderPullRequestBody({ result: applied.result, plan: plan.result }), [
    "--head",
    BRANCH,
  ]);
  return 0;
}

const scriptPath = fileURLToPath(import.meta.url);
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(scriptPath).href
) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  );
}
