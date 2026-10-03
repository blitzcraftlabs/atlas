import { buildAgentContextReport } from "../context/agent-context";
import { createAtlasContext } from "../context/atlas-context";
import { ExitCode } from "../exit-codes";
import { writeCommandSuccess } from "../output/write";

import type { AgentContextReport } from "../context/agent-context";
import type { OutputWriter } from "../output/write";

export function runContextCommand(options: {
  cwd?: string;
  json: boolean;
  writer: OutputWriter;
}): number {
  const context = createAtlasContext({
    cwd: options.cwd,
    requireProject: true,
  });

  const report = buildAgentContextReport(context);

  writeCommandSuccess(
    options.writer,
    "context",
    report,
    options.json,
    formatAgentContextHumanReport
  );

  return ExitCode.SUCCESS;
}

export function formatAgentContextHumanReport(report: AgentContextReport): string[] {
  const lines = [
    "Atlas agent context",
    "",
    `Workspace: ${report.workspaceKind}`,
    `Atlas version: ${report.atlasVersion}`,
    `Canonical application: ${report.project.canonicalApplication ?? "unknown"}`,
    `Applications: ${report.project.applications.join(", ") || "none"}`,
    "",
    "Discover project state:",
    `  ${report.invocation.cli} context --json`,
    "",
    "Structural scaffolding:",
    `  ${report.invocation.cli} generate feature <name> [--query] [--mutation] [--form] [--tests]`,
    `  ${report.invocation.cli} generate page <route>`,
    `  ${report.invocation.cli} generate list --json`,
    "",
    "Architecture validation:",
    `  ${report.invocation.cli} doctor`,
    `  ${report.invocation.cli} doctor --json`,
    "",
    "Upgrade planning:",
    `  ${report.invocation.cli} upgrade --dry-run --json`,
    "",
    "Optional tooling:",
    `  ${report.invocation.enableCli} enable list --json`,
    "",
    `Workflow documentation: ${report.documentation.workflow}`,
    `Agent entry point: ${report.documentation.agentEntryPoint}`,
  ];

  return lines;
}

export function writeContextHelp(writer: OutputWriter, json: boolean): void {
  const lines = [
    "Atlas context — resolved project state for humans and coding agents",
    "",
    "Emits a deterministic projection of the Atlas project contract, ownership manifest,",
    "generator inventory, Doctor capabilities, upgrade semantics, validation commands,",
    "and canonical documentation references.",
    "",
    "Usage:",
    "  atlas context [options]",
    "",
    "Options:",
    "  --json           Emit machine-readable JSON on stdout",
    "  --cwd <path>     Resolve the Atlas repository from a starting directory",
    "",
    "See docs/how-we-build/agents.md for the canonical agent workflow.",
  ];

  if (json) {
    writer.writeStdout(
      JSON.stringify({
        ok: true,
        command: "context-help",
        result: { lines },
      })
    );
    return;
  }

  for (const line of lines) {
    writer.writeStdout(line);
  }
}
