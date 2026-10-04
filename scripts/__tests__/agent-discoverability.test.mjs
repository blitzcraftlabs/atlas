import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const agentsMd = readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8");
const agentsWorkflow = readFileSync(
  path.join(repoRoot, "docs/how-we-build/agents.md"),
  "utf8"
);

const requiredAgentCommands = [
  "atlas context",
  "atlas context --json",
  "atlas doctor",
  "atlas doctor --json",
  "atlas generate list",
  "atlas upgrade",
  "--dry-run --json",
];

const requiredValidationCommands = ["pnpm lint", "pnpm typecheck", "pnpm test"];

test("AGENTS.md references canonical agent workflow and executable commands", () => {
  assert.match(agentsMd, /docs\/how-we-build\/agents\.md/);
  for (const command of requiredAgentCommands) {
    assert.match(agentsMd, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const command of requiredValidationCommands) {
    assert.match(agentsMd, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("canonical agent workflow documents source-of-truth hierarchy and vendor adapters", () => {
  assert.match(agentsWorkflow, /Source-of-truth hierarchy/);
  assert.match(agentsWorkflow, /vendor adapters/i);
  assert.match(agentsWorkflow, /Do not.*encode/i);
  assert.match(agentsWorkflow, /pnpm atlas upgrade --dry-run/);
  assert.match(agentsWorkflow, /Do not infer blocking from `category` alone/);
  assert.match(agentsWorkflow, /manual-review/);
  assert.match(agentsWorkflow, /security-critical/);
});

test("referenced agent documentation paths exist", () => {
  const referencedPaths = [
    "AGENTS.md",
    "docs/how-we-build/agents.md",
    "docs/how-we-build/cli.md",
    "docs/how-we-build/doctor.md",
    "docs/how-we-build/upgrades.md",
    "docs/how-we-build/architecture-ownership.md",
    "docs/how-we-build/security.md",
    "docs/security/threat-model.md",
    "SECURITY.md",
    "docs/adr/0010-atlas-upgrades-downstream-propagation.md",
  ];

  for (const relativePath of referencedPaths) {
    assert.equal(existsSync(path.join(repoRoot, relativePath)), true, relativePath);
  }
});

test("Cursor adapter delegates to canonical AGENTS.md", () => {
  const cursorRule = readFileSync(
    path.join(repoRoot, ".cursor/rules/atlas-core.mdc"),
    "utf8"
  );
  assert.match(cursorRule, /AGENTS\.md/);
  assert.match(cursorRule, /atlas context --json/);
  assert.match(cursorRule, /atlas doctor --json/);

  const skill = readFileSync(
    path.join(repoRoot, ".cursor/skills/build-atlas-feature/SKILL.md"),
    "utf8"
  );
  assert.match(skill, /agents\.md/);
  assert.match(skill, /atlas context --json/);
});

test("CLAUDE.md adapters point to AGENTS.md only", () => {
  for (const relativePath of ["apps/web/CLAUDE.md", "apps/reference/CLAUDE.md"]) {
    const contents = readFileSync(path.join(repoRoot, relativePath), "utf8").trim();
    assert.equal(contents, "@AGENTS.md");
  }
});
