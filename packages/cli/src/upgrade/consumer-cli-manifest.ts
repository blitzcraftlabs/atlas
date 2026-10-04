import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { detectWorkspaceKind } from "../context/workspace-kind";
import { CLI_PACKAGE_NAME } from "../version";

import { isExactAtlasReleaseVersion } from "./version-compare";

import type { UpgradePlanItem } from "./types";

export const CONSUMER_ATLAS_SCRIPT = "atlas";
export const CONSUMER_ATLAS_SCRIPT_VALUE = "atlas";

export type ConsumerCliPinAction = "skip-platform" | "noop" | "update" | "conflict";

export interface ConsumerCliPinPlan {
  action: ConsumerCliPinAction;
  items: UpgradePlanItem[];
}

interface PackageManifest {
  scripts?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  optionalDependencies?: unknown;
  peerDependencies?: unknown;
  [key: string]: unknown;
}

function readManifest(packageJsonPath: string): PackageManifest | undefined {
  if (!existsSync(packageJsonPath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as PackageManifest;
  } catch {
    return undefined;
  }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function dependencySpec(section: unknown): string | undefined {
  const record = recordValue(section);
  const value = record?.[CLI_PACKAGE_NAME];
  return typeof value === "string" ? value : undefined;
}

function conflictItem(
  message: string,
  sourceVersion: string,
  targetVersion: string
): UpgradePlanItem {
  return {
    relativePath: "package.json",
    ownershipChannel: "structural-contract",
    category: "manual",
    action: "manual-review",
    message,
    conflict: true,
    securityCritical: false,
    sourceVersion,
    targetVersion,
    pathScope: "repository",
  };
}

export function planConsumerCliPin(options: {
  repoRoot: string;
  sourceVersion: string;
  targetVersion: string;
}): ConsumerCliPinPlan {
  if (detectWorkspaceKind(options.repoRoot) === "platform") {
    return { action: "skip-platform", items: [] };
  }

  const packageJsonPath = path.join(options.repoRoot, "package.json");
  const manifest = readManifest(packageJsonPath);
  if (!manifest) {
    return {
      action: "conflict",
      items: [
        conflictItem(
          "Root package.json is missing or invalid. Atlas will not rewrite it while pinning the CLI.",
          options.sourceVersion,
          options.targetVersion
        ),
      ],
    };
  }

  const conflicts: UpgradePlanItem[] = [];
  const scripts = manifest.scripts;
  const scriptRecord = recordValue(scripts);
  const scriptValue = scriptRecord?.[CONSUMER_ATLAS_SCRIPT];
  let scriptChange: "add" | "keep" = "add";

  if (scripts !== undefined && scriptRecord === undefined) {
    conflicts.push(
      conflictItem(
        "Root package.json scripts is not an object. Atlas will not overwrite it to add the atlas script.",
        options.sourceVersion,
        options.targetVersion
      )
    );
  } else if (scriptValue === undefined) {
    scriptChange = "add";
  } else if (scriptValue === CONSUMER_ATLAS_SCRIPT_VALUE) {
    scriptChange = "keep";
  } else {
    conflicts.push(
      conflictItem(
        `Root package.json script "atlas" is ${JSON.stringify(scriptValue)}. Atlas will not overwrite a custom atlas script.`,
        options.sourceVersion,
        options.targetVersion
      )
    );
  }

  const devSpec = dependencySpec(manifest.devDependencies);
  const otherLocations = [
    ["dependencies", dependencySpec(manifest.dependencies)],
    ["optionalDependencies", dependencySpec(manifest.optionalDependencies)],
    ["peerDependencies", dependencySpec(manifest.peerDependencies)],
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string");

  if (otherLocations.length > 0) {
    conflicts.push(
      conflictItem(
        `${CLI_PACKAGE_NAME} is declared in ${otherLocations.map(([name]) => name).join(", ")}. Atlas pins the CLI as a root devDependency and will not rewrite that customization.`,
        options.sourceVersion,
        options.targetVersion
      )
    );
  }

  const devDependencies = manifest.devDependencies;
  if (devDependencies !== undefined && recordValue(devDependencies) === undefined) {
    conflicts.push(
      conflictItem(
        "Root package.json devDependencies is not an object. Atlas will not overwrite it to pin the CLI.",
        options.sourceVersion,
        options.targetVersion
      )
    );
  } else if (devSpec === undefined) {
    // added below
  } else if (devSpec === options.targetVersion) {
    // already the target pin
  } else if (devSpec === options.sourceVersion && isExactAtlasReleaseVersion(devSpec)) {
    // advance the baseline pin
  } else {
    conflicts.push(
      conflictItem(
        `${CLI_PACKAGE_NAME} devDependency is ${JSON.stringify(devSpec)}, which is neither the source baseline ${options.sourceVersion} nor the target ${options.targetVersion}. Atlas will not rewrite that customization.`,
        options.sourceVersion,
        options.targetVersion
      )
    );
  }

  if (conflicts.length > 0) {
    return { action: "conflict", items: conflicts };
  }

  let dependencyChange: "add" | "keep" | "advance" = "keep";
  if (devSpec === undefined) {
    dependencyChange = "add";
  } else if (devSpec !== options.targetVersion) {
    dependencyChange = "advance";
  }
  if (scriptChange === "keep" && dependencyChange === "keep") {
    return { action: "noop", items: [] };
  }
  let message = `Add the root atlas script. ${CLI_PACKAGE_NAME} is already pinned to ${options.targetVersion}.`;
  if (dependencyChange === "add") {
    message = `Add root devDependency ${CLI_PACKAGE_NAME}@${options.targetVersion} and the atlas script.`;
  } else if (dependencyChange === "advance") {
    message = `Advance root devDependency ${CLI_PACKAGE_NAME} from ${options.sourceVersion} to ${options.targetVersion}.`;
  }

  return {
    action: "update",
    items: [
      {
        relativePath: "package.json",
        ownershipChannel: "structural-contract",
        category: "patch-safe",
        action: "package-upgrade",
        message,
        conflict: false,
        securityCritical: false,
        sourceVersion: options.sourceVersion,
        targetVersion: options.targetVersion,
        pathScope: "repository",
      },
    ],
  };
}

export function applyConsumerCliPin(options: {
  repoRoot: string;
  sourceVersion: string;
  targetVersion: string;
  dryRun?: boolean;
}): ConsumerCliPinPlan {
  const plan = planConsumerCliPin(options);
  if (options.dryRun || plan.action !== "update") {
    return plan;
  }

  const packageJsonPath = path.join(options.repoRoot, "package.json");
  const manifest = readManifest(packageJsonPath);
  if (!manifest) {
    return plan;
  }

  const scripts = recordValue(manifest.scripts) ?? {};
  scripts[CONSUMER_ATLAS_SCRIPT] = CONSUMER_ATLAS_SCRIPT_VALUE;
  manifest.scripts = scripts;

  const devDependencies = recordValue(manifest.devDependencies) ?? {};
  devDependencies[CLI_PACKAGE_NAME] = options.targetVersion;
  manifest.devDependencies = devDependencies;

  writeFileSync(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return plan;
}
