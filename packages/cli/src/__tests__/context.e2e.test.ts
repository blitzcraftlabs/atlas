import { readFileSync } from "node:fs";
import path from "node:path";

import { ExitCode } from "../exit-codes";
import { AGENT_CONTEXT_SCHEMA_VERSION } from "../context/agent-context";

import { createMinimalAtlasFixture } from "./helpers/fixture";
import { getRepoRoot, runAtlasCli } from "./helpers/run-cli";

interface AgentContextJsonResult {
  schemaVersion: number;
  atlasVersion: string;
  workspaceKind: string;
  project: {
    root: string;
    applications: string[];
    canonicalApplication: string | null;
  };
  contract: { schemaVersion: number } | null;
  ownership: {
    manifestPresent: boolean;
    syncedPaths: string[];
    generatedPaths: string[];
  };
  commands: {
    generators: { id: string }[];
    doctor: { checkIds: string[] };
    enable: { capabilityIds: string[] };
    upgrade: {
      dryRunJsonSupported: boolean;
      decisionSource: string;
      resultStatusField: string;
      planItemConflictField: string;
    };
  };
  validation: { recommended: { id: string; command: string }[] };
  documentation: {
    workflow: string;
    agentEntryPoint: string;
    adrs: { id: string; path: string }[];
    references: { id: string; path: string }[];
  };
}

function parseContextJson(stdout: string): AgentContextJsonResult {
  const payload = JSON.parse(stdout) as { ok: boolean; result: AgentContextJsonResult };
  return payload.result;
}

describe("atlas context CLI", () => {
  const repoRoot = getRepoRoot();

  it("prints context in top-level help", () => {
    const result = runAtlasCli(["--help"], repoRoot);
    expect(result.exitCode).toBe(ExitCode.SUCCESS);
    expect(result.stdout).toContain("context");
  });

  it("emits deterministic JSON for the Atlas checkout", () => {
    const first = runAtlasCli(["context", "--json"], repoRoot);
    const second = runAtlasCli(["context", "--json"], repoRoot);

    expect(first.exitCode).toBe(ExitCode.SUCCESS);
    expect(first.stderr).toBe("");

    const firstPayload = JSON.parse(first.stdout) as { ok: boolean; result: unknown };
    const secondPayload = JSON.parse(second.stdout) as { ok: boolean; result: unknown };

    expect(firstPayload.ok).toBe(true);
    expect(JSON.stringify(firstPayload.result)).toBe(JSON.stringify(secondPayload.result));
  });

  it("includes resolved contract, ownership, generators, and documentation references", () => {
    const result = runAtlasCli(["context", "--json"], repoRoot);
    const context = parseContextJson(result.stdout);

    expect(context.schemaVersion).toBe(AGENT_CONTEXT_SCHEMA_VERSION);
    expect(context.project.root).toBe(".");
    expect(context.project.canonicalApplication).toBe("apps/web");
    expect(context.contract?.schemaVersion).toBe(1);
    expect(context.ownership.manifestPresent).toBe(true);
    expect(context.ownership.syncedPaths.length).toBeGreaterThan(0);
    expect(context.ownership.generatedPaths.length).toBeGreaterThan(0);
    expect(context.commands.generators.map((generator) => generator.id)).toEqual([
      "feature",
      "page",
    ]);
    expect(context.commands.doctor.checkIds).toContain("project-contract");
    expect(context.commands.upgrade.dryRunJsonSupported).toBe(true);
    expect(context.commands.upgrade.decisionSource).toBe("pnpm atlas upgrade --dry-run --json");
    expect(context.commands.upgrade.resultStatusField).toBe("status");
    expect(context.commands.upgrade.planItemConflictField).toBe("conflict");
    expect(context.validation.recommended.some((entry) => entry.id === "lint")).toBe(true);
    expect(context.workspaceKind).toBe("platform");
    expect(context.commands.enable.capabilityIds).toContain("storybook");
    expect(context.documentation.workflow).toBe("docs/how-we-build/agents.md");
    expect(context.documentation.agentEntryPoint).toBe("AGENTS.md");
    expect(context.documentation.adrs.some((adr) => adr.id === "ADR-0010")).toBe(true);
  });

  it("references existing documentation paths", () => {
    const result = runAtlasCli(["context", "--json"], repoRoot);
    const context = parseContextJson(result.stdout);

    for (const reference of [
      ...context.documentation.adrs,
      ...context.documentation.references,
      {
        id: "workflow",
        path: context.documentation.workflow,
      },
      {
        id: "entry",
        path: context.documentation.agentEntryPoint,
      },
    ]) {
      expect(existsAtRepoRoot(repoRoot, reference.path)).toBe(true);
    }
  });

  it("maps invalid atlas.config.json to actionable CLI errors", () => {
    const fixture = createMinimalAtlasFixture({ invalidContract: true });
    const result = runAtlasCli(["context", "--json", "--cwd", fixture.root], fixture.root);

    expect(result.exitCode).not.toBe(ExitCode.SUCCESS);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error?: { code: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("CONTRACT_INVALID");
  });

  it("omits ownership manifest data when manifest is absent", () => {
    const fixture = createMinimalAtlasFixture({ withContract: true });
    const result = runAtlasCli(["context", "--json", "--cwd", fixture.root], fixture.root);
    const context = parseContextJson(result.stdout);

    expect(context.ownership.manifestPresent).toBe(false);
    expect(context.ownership.syncedPaths).toEqual([]);
    expect(context.ownership.generatedPaths).toEqual([]);
  });

  it("does not encode upgrade blocking policy in agent context JSON", () => {
    const result = runAtlasCli(["context", "--json"], repoRoot);
    const context = parseContextJson(result.stdout) as AgentContextJsonResult & {
      commands: { upgrade: Record<string, unknown> };
    };

    expect(context.commands.upgrade).not.toHaveProperty("blockingCategories");
    expect(context.commands.upgrade).not.toHaveProperty("deterministicActions");
  });
});

describe("atlas generate list CLI", () => {
  const repoRoot = getRepoRoot();

  it("lists generators as deterministic JSON", () => {
    const first = runAtlasCli(["generate", "list", "--json"], repoRoot);
    const second = runAtlasCli(["generate", "list", "--json"], repoRoot);

    expect(first.exitCode).toBe(ExitCode.SUCCESS);
    expect(JSON.parse(first.stdout)).toEqual(JSON.parse(second.stdout));

    const payload = JSON.parse(first.stdout) as {
      ok: boolean;
      result: { generators: { id: string; usage: string }[] };
    };
    expect(payload.result.generators.map((generator) => generator.id)).toEqual(["feature", "page"]);
    expect(payload.result.generators[0]?.usage).toContain("atlas generate feature");
  });
});

function existsAtRepoRoot(repoRoot: string, relativePath: string): boolean {
  try {
    readFileSync(path.join(repoRoot, relativePath), "utf8");
    return true;
  } catch {
    return false;
  }
}
