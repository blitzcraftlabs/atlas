import { spawnSync } from "node:child_process";
import path from "node:path";

import { CLI_PACKAGE_NAME } from "../version";

import { type CommandRunner, pnpmExecutable } from "./release-discovery";
import { assertExactAtlasReleaseVersion } from "./version-compare";

/** Set only on the target CLI process. Not a public flag. */
export const ATLAS_UPGRADE_HANDOFF_ENV = "ATLAS_UPGRADE_HANDOFF";

export type UpgradeHandoffDecision = "execute" | "handoff" | "refuse-recursion";

export function isUpgradeHandoffChild(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ATLAS_UPGRADE_HANDOFF_ENV] === "1";
}

export function decideUpgradeHandoff(options: {
  runningVersion: string;
  targetVersion: string;
  handoffChild: boolean;
}): UpgradeHandoffDecision {
  if (options.runningVersion === options.targetVersion) {
    return "execute";
  }
  if (options.handoffChild) {
    return "refuse-recursion";
  }
  return "handoff";
}

export interface UpgradeHandoffRequest {
  repoRoot: string;
  targetVersion: string;
  dryRun?: boolean;
  json?: boolean;
  allowDirty?: boolean;
  skipValidation?: boolean;
  releasesDir?: string;
}

export function buildUpgradeHandoffArgs(request: UpgradeHandoffRequest): string[] {
  const targetVersion = assertExactAtlasReleaseVersion(request.targetVersion, "Upgrade target");
  const args = [
    "dlx",
    `${CLI_PACKAGE_NAME}@${targetVersion}`,
    "upgrade",
    "--to",
    targetVersion,
    "--cwd",
    path.resolve(request.repoRoot),
  ];

  if (request.dryRun) {
    args.push("--dry-run");
  }
  if (request.json) {
    args.push("--json");
  }
  if (request.allowDirty) {
    args.push("--allow-dirty");
  }
  if (request.skipValidation) {
    args.push("--skip-validation");
  }
  if (request.releasesDir) {
    args.push("--releases-dir", path.resolve(request.releasesDir));
  }

  return args;
}

export interface UpgradeHandoffResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
}

export function executeUpgradeHandoff(options: {
  request: UpgradeHandoffRequest;
  spawn?: CommandRunner;
  env?: NodeJS.ProcessEnv;
  stdio?: "inherit" | "pipe";
}): UpgradeHandoffResult {
  const args = buildUpgradeHandoffArgs(options.request);
  const spawn = options.spawn ?? spawnSync;
  const result = spawn(pnpmExecutable(), args, {
    cwd: options.request.repoRoot,
    env: {
      ...(options.env ?? process.env),
      [ATLAS_UPGRADE_HANDOFF_ENV]: "1",
    },
    encoding: "utf8",
    shell: false,
    stdio: options.stdio ?? "inherit",
  });

  if (result.error) {
    return { exitCode: 1, signal: result.signal };
  }
  if (result.signal) {
    return { exitCode: 1, signal: result.signal };
  }
  return { exitCode: result.status ?? 1, signal: null };
}
