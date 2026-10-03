import { spawnSync } from "node:child_process";

import { type CommandRunner, pnpmExecutable } from "./release-discovery";

function commandText(value: string | Buffer | null | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value) {
    return value.toString("utf8").trim();
  }
  return "";
}

export interface DependencyInstallResult {
  status: "passed" | "failed" | "skipped";
  message: string;
}

export function installConsumerDependencies(options: {
  repoRoot: string;
  spawn?: CommandRunner;
  env?: NodeJS.ProcessEnv;
}): DependencyInstallResult {
  const spawn = options.spawn ?? spawnSync;
  const result = spawn(pnpmExecutable(), ["install"], {
    cwd: options.repoRoot,
    encoding: "utf8",
    shell: false,
    env: options.env ?? process.env,
  });

  if (result.error || result.status !== 0 || result.signal) {
    const detail =
      commandText(result.stderr) ||
      commandText(result.stdout) ||
      (result.error instanceof Error ? result.error.message : "") ||
      (result.signal
        ? `pnpm install exited from signal ${result.signal}.`
        : "pnpm install failed.");
    return {
      status: "failed",
      message: `Dependency installation failed. platform.baseline was not advanced.\n${detail}`,
    };
  }

  return {
    status: "passed",
    message: "Installed dependencies with pnpm.",
  };
}
