import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Placeholders that once stood in for unreleased CLI versions and must not return to docs. */
const STALE_PLACEHOLDERS = ["<next-cli-release>"];

function listMarkdown(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "_archive" || entry === "node_modules") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listMarkdown(full));
    else if (entry.endsWith(".md")) out.push(full);
  }
  return out;
}

test("public and how-we-build docs do not reference unreleased CLI placeholders", () => {
  const files = [
    ...listMarkdown(path.join(repoRoot, "docs")),
    path.join(repoRoot, "README.md"),
    path.join(repoRoot, "AGENTS.md"),
  ];
  const hits = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const placeholder of STALE_PLACEHOLDERS) {
      if (text.includes(placeholder)) hits.push(`${path.relative(repoRoot, file)}: ${placeholder}`);
    }
  }
  assert.deepEqual(hits, []);
});
