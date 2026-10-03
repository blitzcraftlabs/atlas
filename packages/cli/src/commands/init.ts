import { runBootstrapInit } from "../init/bootstrap";
import { runCheckoutInit } from "../init/checkout";

import type { EnvPolicy, ReferencePolicy } from "../init/types";
import type { CommandResult, PlannedAction } from "../types/result";

export type { EnvPolicy, ReferencePolicy };

export interface InitOptions {
  cwd?: string;
  dryRun?: boolean;
  reference: ReferencePolicy;
  env: EnvPolicy;
  project?: string;
  assetRoot?: string;
  beforePromote?: () => void;
}

export function runInit(options: InitOptions): CommandResult {
  if (options.project !== undefined) {
    return runBootstrapInit({
      cwd: options.cwd,
      project: options.project,
      dryRun: options.dryRun,
      env: options.env,
      reference: options.reference,
      assetRoot: options.assetRoot,
      beforePromote: options.beforePromote,
    });
  }

  return runCheckoutInit({
    cwd: options.cwd,
    dryRun: options.dryRun,
    env: options.env,
    reference: options.reference,
  });
}

export function formatInitResult(result: CommandResult, dryRun: boolean): string[] {
  if (result.initMode === "bootstrap") {
    const header = dryRun ? "Atlas init dry run." : "Atlas project created.";
    const lines = [
      header,
      `Project root: ${result.repoRoot}`,
      `Atlas version: ${result.atlasVersion}`,
      "Actions:",
      ...result.actions.map(
        (action: PlannedAction) =>
          `- ${action.kind}: ${action.path}${action.reason ? ` (${action.reason})` : ""}`
      ),
    ];

    if (!dryRun) {
      lines.push(
        "Next steps:",
        `  cd ${result.repoRoot}`,
        "  pnpm install",
        "  pnpm dev",
        "  pnpm atlas doctor",
        "  pnpm atlas context --json",
        "  pnpm atlas enable list --json"
      );
    }

    if (result.warnings.length > 0) {
      lines.push("Warnings:");
      for (const warning of result.warnings) {
        lines.push(`- ${warning.message}`);
      }
    }

    return lines;
  }

  if (result.alreadyInitialized) {
    return [
      "Atlas project already initialized.",
      `Repository root: ${result.repoRoot}`,
      `Atlas version: ${result.atlasVersion}`,
    ];
  }

  const header = dryRun ? "Atlas init dry run." : "Atlas init completed.";

  const lines = [
    header,
    `Repository root: ${result.repoRoot}`,
    `Atlas version: ${result.atlasVersion}`,
    "Actions:",
    ...result.actions.map(
      (action: PlannedAction) =>
        `- ${action.kind}: ${action.path}${action.reason ? ` (${action.reason})` : ""}`
    ),
  ];

  if (result.warnings.length > 0) {
    lines.push("Warnings:");
    for (const warning of result.warnings) {
      lines.push(`- ${warning.message}`);
    }
  }

  return lines;
}

export function writeInitHelp(
  writer: { writeStdout: (line: string) => void },
  json: boolean
): void {
  const lines = [
    "Atlas init — create a project or initialize an existing checkout",
    "",
    "Usage:",
    "  atlas init <project> [options]",
    "  atlas init [options]",
    "",
    "atlas init <project> materializes a complete Atlas consumer project from the",
    "bootstrap assets packaged inside the installed CLI. <project> is resolved",
    "relative to the caller cwd. The destination must not exist, or must be empty.",
    "",
    "atlas init (no project argument) initializes Atlas metadata in an existing",
    "compatible checkout. It does not create a directory.",
    "",
    "Options:",
    "  --dry-run            Preview planned changes without writing files",
    "  --json               Emit machine-readable JSON on stdout",
    "  --cwd <path>         Resolve paths relative to this directory",
    "  --env <mode>         skip (default) or copy (.env.example → .env.local)",
    "  --reference <mode>   Checkout init only: keep (default) or remove",
    "",
    "Examples:",
    "  atlas init my-app",
    "  atlas init nested/my-app",
    "  atlas init my-app --env copy",
    "  atlas init --dry-run",
  ];

  if (json) {
    writer.writeStdout(
      JSON.stringify({
        ok: true,
        command: "init",
        result: { summary: "Atlas init help", lines },
      })
    );
    return;
  }

  for (const line of lines) {
    writer.writeStdout(line);
  }
}
