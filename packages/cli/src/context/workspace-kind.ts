import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { enableCliInvocation } from "../init/cli-release";
import { CLI_PACKAGE_NAME } from "../version";

export type WorkspaceKind = "platform" | "consumer";

function readPackageName(packageJsonPath: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: unknown };
    return typeof parsed.name === "string" ? parsed.name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Platform checkouts vendor the CLI source workspace. Generated consumers do not.
 */
export function detectWorkspaceKind(repoRoot: string): WorkspaceKind {
  const cliPackageJsonPath = path.join(repoRoot, "packages", "cli", "package.json");
  if (existsSync(cliPackageJsonPath) && readPackageName(cliPackageJsonPath) === CLI_PACKAGE_NAME) {
    return "platform";
  }

  return "consumer";
}

export function atlasCliInvocation(_atlasVersion: string, _kind: WorkspaceKind): string {
  return "pnpm atlas";
}

export { enableCliInvocation };
