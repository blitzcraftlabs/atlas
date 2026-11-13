import assert from "node:assert/strict";
import test from "node:test";

import {
  collectItems,
  parseLastJsonLine,
  renderBlockedIssueBody,
  renderPullRequestBody,
  runAtlasUpgrade,
} from "../../packages/cli/bootstrap/capabilities/templates/atlas-upgrade-pr.mjs";

const single = {
  sourceVersion: "1.3.2",
  targetVersion: "1.3.3",
  status: "success",
  items: [
    { relativePath: "src/lib/api/errors.ts", action: "replace", category: "patch-safe" },
    { relativePath: "src/lib/auth/session.ts", action: "skip", category: "patch-safe" },
    { relativePath: "src/lib/application/authz.ts", action: "manual", category: "manual-review" },
  ],
  conflicts: [],
  validation: { doctor: "passed" },
  dependencyInstall: "passed",
};

test("PR body lists applied files, review items and validation; skips unchanged files", () => {
  const body = renderPullRequestBody({ result: single, plan: single });
  assert.match(body, /Atlas 1\.3\.2 → 1\.3\.3/);
  assert.match(body, /`src\/lib\/api\/errors\.ts` — replace/);
  assert.match(body, /`src\/lib\/application\/authz\.ts` — manual-review/);
  assert.doesNotMatch(body, /session\.ts/);
  assert.match(body, /atlas doctor: passed/);
});

test("PR body shows the multi-release path and collects items from every hop", () => {
  const multi = {
    sourceVersion: "1.2.2",
    targetVersion: "1.3.2",
    status: "success",
    hops: ["1.3.1", "1.3.2"],
    items: [],
    hopResults: [
      { targetVersion: "1.3.1", exitCode: 0, result: { items: [single.items[0]] } },
      { targetVersion: "1.3.2", exitCode: 0, result: { items: [single.items[2]] } },
    ],
  };
  assert.equal(collectItems(multi).length, 2);
  const body = renderPullRequestBody({ result: multi, plan: multi });
  assert.match(body, /Upgrade path:\*\* 1\.2\.2 → 1\.3\.1 → 1\.3\.2/);
});

test("blocked issue body lists conflicts and messages", () => {
  const body = renderBlockedIssueBody({
    exitCode: 9,
    plan: {
      sourceVersion: "1.3.2",
      targetVersion: "1.3.3",
      status: "blocked",
      conflicts: [
        {
          relativePath: "src/lib/auth/session.ts",
          category: "merge-required",
          message: "Consumer modified synced file",
        },
      ],
      messages: ["Blocking conflicts refuse all mutations."],
    },
  });
  assert.match(body, /needs attention/);
  assert.match(body, /`src\/lib\/auth\/session\.ts` — merge-required: Consumer modified/);
  assert.match(body, /exited with code 9/);
});

test("runAtlasUpgrade parses the CLI JSON envelope and tolerates junk output", () => {
  const ok = runAtlasUpgrade(["--dry-run"], (command, args) => {
    assert.equal(command, "pnpm");
    assert.deepEqual(args, ["--silent", "atlas", "upgrade", "--json", "--dry-run"]);
    return { status: 0, stdout: JSON.stringify({ ok: true, result: { status: "planned" } }) };
  });
  assert.deepEqual([ok.exitCode, ok.result.status], [0, "planned"]);
  const junk = runAtlasUpgrade([], () => ({ status: 1, stdout: "not json" }));
  assert.deepEqual([junk.exitCode, junk.result], [1, null]);
});

test("parseLastJsonLine skips pnpm banners and dlx progress", () => {
  const mixed = [
    "> app@0.1.0 atlas /tmp/app",
    "> atlas upgrade --dry-run --json",
    "Progress: resolved 7, reused 6, downloaded 1, added 7, done",
    JSON.stringify({ ok: true, result: { status: "planned" } }),
  ].join("\n");
  assert.equal(parseLastJsonLine(mixed).result.status, "planned");
  assert.equal(parseLastJsonLine("nothing here"), null);
});
