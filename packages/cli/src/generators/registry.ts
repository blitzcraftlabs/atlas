import type { ResolvedAtlasProject } from "@atlas/project";

import type { GeneratorType } from "./types";

export interface GeneratorArgumentDefinition {
  name: string;
  required: boolean;
  description: string;
}

export interface GeneratorFlagDefinition {
  flag: string;
  description: string;
  appliesTo: GeneratorType | "all";
}

export interface GeneratorDefinition {
  id: GeneratorType;
  /** `builtin` generators ship with Atlas; `custom` ones come from atlas.config.json. */
  source?: "builtin" | "custom";
  description: string;
  usage: string;
  targetOwnership: string;
  conflictBehavior: string;
  arguments: GeneratorArgumentDefinition[];
  flags: GeneratorFlagDefinition[];
}

export const GENERATOR_DEFINITIONS: GeneratorDefinition[] = [
  {
    id: "feature",
    description:
      "Scaffold a product feature module with optional query, mutation, form, and test shells.",
    usage: "atlas generate feature <name> [options]",
    targetOwnership: "Consumer product feature root from the resolved Atlas project contract.",
    conflictBehavior:
      "Fails when generator-owned files already exist. Does not overwrite existing feature shells.",
    arguments: [
      {
        name: "name",
        required: true,
        description: "Feature name in kebab-case (example: billing-history).",
      },
    ],
    flags: [
      {
        flag: "--query",
        description: "Include query key factory and query hook scaffold.",
        appliesTo: "feature",
      },
      { flag: "--mutation", description: "Include mutation hook scaffold.", appliesTo: "feature" },
      {
        flag: "--form",
        description: "Include Zod schema and form component scaffold.",
        appliesTo: "feature",
      },
      {
        flag: "--tests",
        description: "Include deterministic query-key tests (requires --query).",
        appliesTo: "feature",
      },
      {
        flag: "--dry-run",
        description: "Preview planned file actions without writing.",
        appliesTo: "all",
      },
      { flag: "--json", description: "Emit machine-readable JSON on stdout.", appliesTo: "all" },
    ],
  },
  {
    id: "page",
    description:
      "Scaffold a thin App Router page shell under the configured application routes root.",
    usage: "atlas generate page <route> [options]",
    targetOwnership: "Application routes root from the resolved Atlas project contract.",
    conflictBehavior:
      "Fails when the target page file already exists. Does not overwrite existing route shells.",
    arguments: [
      {
        name: "route",
        required: true,
        description: "Route relative to the App Router root (example: settings/profile).",
      },
    ],
    flags: [
      {
        flag: "--dry-run",
        description: "Preview planned file actions without writing.",
        appliesTo: "all",
      },
      { flag: "--json", description: "Emit machine-readable JSON on stdout.", appliesTo: "all" },
    ],
  },
];

export function listGeneratorDefinitions(project?: ResolvedAtlasProject): GeneratorDefinition[] {
  const builtins = GENERATOR_DEFINITIONS.map((definition) => ({
    ...definition,
    source: "builtin" as const,
    arguments: [...definition.arguments],
    flags: [...definition.flags],
  }));
  const custom = Object.entries(project?.generators ?? {}).map(
    ([id, generator]): GeneratorDefinition => {
      const argumentName = generator.argument?.name ?? "name";
      return {
        id,
        source: "custom",
        description: generator.description,
        usage: `atlas generate ${id} <${argumentName}> [options]`,
        targetOwnership: `Consumer-owned output rendered into ${generator.target} from ${generator.templates}.`,
        conflictBehavior:
          "Fails when any rendered file already exists. Does not overwrite existing files.",
        arguments: [
          {
            name: argumentName,
            required: true,
            description: generator.argument?.description ?? "Name in kebab-case.",
          },
        ],
        flags: [
          {
            flag: "--dry-run",
            description: "Preview planned file actions without writing.",
            appliesTo: "all",
          },
          {
            flag: "--json",
            description: "Emit machine-readable JSON on stdout.",
            appliesTo: "all",
          },
        ],
      };
    }
  );
  return [...builtins, ...custom];
}
