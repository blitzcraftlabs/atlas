import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { type ResolvedAtlasProject, toResolvedAtlasProjectJson } from "@atlas/project";

import { DOCTOR_CHECKS } from "../doctor/runner";
import { listCapabilityDefinitions } from "../enable/registry";
import { listGeneratorDefinitions } from "../generators/registry";
import {
  APP_INFRASTRUCTURE_MANIFEST_RELATIVE_PATH,
  type AppInfrastructureManifest,
  loadAppInfrastructureManifest,
} from "../template-sync/manifest";
import { readCliAtlasVersion } from "../version";

import {
  AGENT_ENTRY_POINT_PATH,
  AGENT_WORKFLOW_DOC_PATH,
  listAgentAdrReferences,
  listAgentDocumentationReferences,
  SOURCE_OF_TRUTH_HIERARCHY,
} from "./documentation-registry";
import {
  atlasCliInvocation,
  detectWorkspaceKind,
  enableCliInvocation,
  type WorkspaceKind,
} from "./workspace-kind";

import type { AtlasCliContext } from "./atlas-context";

export const AGENT_CONTEXT_SCHEMA_VERSION = 1;

export interface AgentValidationCommand {
  id: string;
  command: string;
  when: string;
}

export interface AgentOwnershipSnapshot {
  manifestPresent: boolean;
  manifestPath: string;
  canonicalApplication: string | null;
  consumerApplications: string[];
  syncedPaths: string[];
  generatedPaths: string[];
  independentPaths: Record<string, Record<string, string>>;
  referenceOnlyPaths: string[];
  starterOnlyPaths: string[];
  repositorySyncedPaths: string[];
}

export interface AgentContextReport {
  schemaVersion: number;
  atlasVersion: string;
  workspaceKind: WorkspaceKind;
  invocation: {
    cli: string;
    enableCli: string;
  };
  project: {
    root: string;
    applications: string[];
    canonicalApplication: string | null;
  };
  contract: ResolvedAtlasProject | null;
  ownership: AgentOwnershipSnapshot;
  commands: {
    context: {
      command: string;
      jsonSupported: boolean;
    };
    generators: ReturnType<typeof listGeneratorDefinitions>;
    doctor: {
      command: string;
      jsonSupported: boolean;
      checkIds: string[];
    };
    upgrade: {
      command: string;
      dryRunJsonSupported: boolean;
      applyJsonSupported: boolean;
      requiresTargetVersion: boolean;
      decisionSource: string;
      resultStatusField: string;
      planItemConflictField: string;
      planItemActionField: string;
      planItemCategoryField: string;
    };
    enable: {
      command: string;
      listJsonSupported: boolean;
      dryRunJsonSupported: boolean;
      capabilityIds: string[];
    };
  };
  validation: {
    recommended: AgentValidationCommand[];
  };
  documentation: {
    workflow: string;
    agentEntryPoint: string;
    sourceOfTruthHierarchy: string[];
    adrs: ReturnType<typeof listAgentAdrReferences>;
    references: ReturnType<typeof listAgentDocumentationReferences>;
  };
}

function readRootScripts(repoRoot: string): Record<string, string> {
  const packageJsonPath = path.join(repoRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    return parsed.scripts ?? {};
  } catch {
    return {};
  }
}

function recommendedValidationCommands(options: {
  kind: WorkspaceKind;
  atlasVersion: string;
  repoRoot: string;
}): AgentValidationCommand[] {
  const cli = atlasCliInvocation(options.atlasVersion, options.kind);
  const scripts = readRootScripts(options.repoRoot);
  const hasScript = (name: string) => typeof scripts[name] === "string";

  const commands: AgentValidationCommand[] = [
    {
      id: "atlas-doctor",
      command:
        options.kind === "platform"
          ? "pnpm --filter @blitzcraftlabs/atlas build && pnpm atlas doctor"
          : `${cli} doctor`,
      when: "After architecture-sensitive changes (contract, routing, feature structure, ownership).",
    },
    {
      id: "atlas-doctor-json",
      command: `${cli} doctor --json`,
      when: "When machine consumption of Doctor diagnostics is required.",
    },
    {
      id: "lint",
      command: "pnpm lint",
      when: "Minimum engineering validation for source changes.",
    },
    {
      id: "typecheck",
      command: "pnpm typecheck",
      when: "Minimum engineering validation for source changes.",
    },
    {
      id: "test",
      command: "pnpm test",
      when: "Minimum engineering validation for source changes.",
    },
    {
      id: "build",
      command: "pnpm build",
      when: "When changes affect build output or routing.",
    },
  ];

  if (hasScript("validate:env")) {
    commands.push({
      id: "validate-env",
      command: "pnpm validate:env",
      when: "When environment schema or runtime config changes.",
    });
  }

  if (options.kind === "platform") {
    commands.push(
      {
        id: "api-check",
        command: "pnpm api:check",
        when: "When OpenAPI spec or generated client artifacts change.",
      },
      {
        id: "template-check",
        command: "pnpm template:check",
        when: "When synced template infrastructure may have drifted.",
      },
      {
        id: "docs-check",
        command: "pnpm docs:check",
        when: "When documentation links change.",
      },
      {
        id: "governance-check",
        command: "pnpm governance:check",
        when: "When release or governance policy changes.",
      },
      {
        id: "security-check",
        command: "pnpm security:check",
        when: "When dependencies, lockfile, or security policy change.",
      },
      {
        id: "security-workflow-check",
        command: "pnpm security:workflow-check",
        when: "When GitHub workflows or security tooling pins change.",
      },
      {
        id: "web-e2e",
        command: "pnpm --filter @atlas/web test:e2e",
        when: "For user-facing starter application flows.",
      },
      {
        id: "reference-e2e",
        command: "pnpm --filter @atlas/reference test:e2e",
        when: "For reference application flows.",
      }
    );
  } else {
    if (hasScript("security:check")) {
      commands.push({
        id: "security-check",
        command: "pnpm security:check",
        when: "When dependencies, lockfile, or security policy change.",
      });
    }
    if (hasScript("test:risk-coverage")) {
      commands.push({
        id: "risk-coverage",
        command: "pnpm test:risk-coverage",
        when: "When critical-subsystem coverage enforcement is enabled.",
      });
    }
    commands.push({
      id: "web-e2e",
      command: "pnpm --filter @atlas/web test:e2e",
      when: "For user-facing starter application flows after Playwright browsers are installed.",
    });
  }

  return commands;
}

function documentationReferencesForWorkspace(repoRoot: string) {
  return listAgentDocumentationReferences().filter((reference) =>
    existsSync(path.join(repoRoot, reference.path))
  );
}

function documentationAdrsForWorkspace(repoRoot: string) {
  return listAgentAdrReferences().filter((reference) =>
    existsSync(path.join(repoRoot, reference.path))
  );
}

function sortPaths(paths: string[]): string[] {
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function sortIndependentPaths(
  independentPaths: Record<string, Record<string, string>>
): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Object.entries(independentPaths)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([application, paths]) => [
        application,
        Object.fromEntries(
          Object.entries(paths).sort(([left], [right]) => left.localeCompare(right))
        ),
      ])
  );
}

function buildOwnershipSnapshot(repoRoot: string): AgentOwnershipSnapshot {
  const manifestPath = APP_INFRASTRUCTURE_MANIFEST_RELATIVE_PATH;
  if (!existsSync(`${repoRoot}/${manifestPath}`)) {
    return {
      manifestPresent: false,
      manifestPath,
      canonicalApplication: null,
      consumerApplications: [],
      syncedPaths: [],
      generatedPaths: [],
      independentPaths: {},
      referenceOnlyPaths: [],
      starterOnlyPaths: [],
      repositorySyncedPaths: [],
    };
  }

  const manifest = loadAppInfrastructureManifest(repoRoot);
  return serializeOwnershipManifest(manifest);
}

function serializeOwnershipManifest(manifest: AppInfrastructureManifest): AgentOwnershipSnapshot {
  return {
    manifestPresent: true,
    manifestPath: APP_INFRASTRUCTURE_MANIFEST_RELATIVE_PATH,
    canonicalApplication: manifest.canonicalApplication,
    consumerApplications: sortPaths(manifest.consumerApplications),
    syncedPaths: sortPaths(manifest.syncedPaths),
    generatedPaths: sortPaths(manifest.generatedPaths),
    independentPaths: sortIndependentPaths(manifest.independentPaths),
    referenceOnlyPaths: sortPaths(manifest.referenceOnlyPaths),
    starterOnlyPaths: sortPaths(manifest.starterOnlyPaths),
    repositorySyncedPaths: sortPaths(manifest.repositorySyncedPaths ?? []),
  };
}

function listApplicationRoots(
  project: ResolvedAtlasProject | undefined,
  ownership: AgentOwnershipSnapshot
): string[] {
  const applications = new Set<string>();

  if (project?.application.root) {
    applications.add(project.application.root);
  }

  if (ownership.canonicalApplication) {
    applications.add(ownership.canonicalApplication);
  }

  for (const application of ownership.consumerApplications) {
    applications.add(application);
  }

  return sortPaths([...applications]);
}

export function buildAgentContextReport(context: AtlasCliContext): AgentContextReport {
  const ownership = buildOwnershipSnapshot(context.repoRoot);
  const contract = context.project ? toResolvedAtlasProjectJson(context.project) : null;
  const applications = listApplicationRoots(context.project, ownership);
  const doctorCheckIds = DOCTOR_CHECKS.map((check) => check.id).sort((left, right) =>
    left.localeCompare(right)
  );
  const workspaceKind = detectWorkspaceKind(context.repoRoot);
  const invocationCli = atlasCliInvocation(context.atlasVersion, workspaceKind);

  return {
    schemaVersion: AGENT_CONTEXT_SCHEMA_VERSION,
    atlasVersion: context.atlasVersion,
    workspaceKind,
    invocation: {
      cli: invocationCli,
      enableCli: enableCliInvocation(context.atlasVersion, workspaceKind, {
        runningCliVersion: readCliAtlasVersion(),
      }),
    },
    project: {
      root: ".",
      applications,
      canonicalApplication:
        ownership.canonicalApplication ?? context.project?.application.root ?? null,
    },
    contract,
    ownership,
    commands: {
      context: {
        command: "atlas context",
        jsonSupported: true,
      },
      generators: listGeneratorDefinitions(),
      doctor: {
        command: "atlas doctor",
        jsonSupported: true,
        checkIds: doctorCheckIds,
      },
      upgrade: {
        command: "atlas upgrade",
        dryRunJsonSupported: true,
        applyJsonSupported: true,
        requiresTargetVersion: false,
        decisionSource: "pnpm atlas upgrade --dry-run --json",
        resultStatusField: "status",
        planItemConflictField: "conflict",
        planItemActionField: "action",
        planItemCategoryField: "category",
      },
      enable: {
        command: "atlas enable",
        listJsonSupported: true,
        dryRunJsonSupported: true,
        capabilityIds: listCapabilityDefinitions().map((capability) => capability.id),
      },
    },
    validation: {
      recommended: recommendedValidationCommands({
        kind: workspaceKind,
        atlasVersion: context.atlasVersion,
        repoRoot: context.repoRoot,
      }),
    },
    documentation: {
      workflow: AGENT_WORKFLOW_DOC_PATH,
      agentEntryPoint: AGENT_ENTRY_POINT_PATH,
      sourceOfTruthHierarchy: [...SOURCE_OF_TRUTH_HIERARCHY],
      adrs: documentationAdrsForWorkspace(context.repoRoot),
      references: documentationReferencesForWorkspace(context.repoRoot),
    },
  };
}
