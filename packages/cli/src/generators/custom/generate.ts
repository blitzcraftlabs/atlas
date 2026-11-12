import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { joinRepoPath, type ResolvedAtlasProject } from "@atlas/project";

import { CliError, CliErrorCode } from "../../errors/cli-error";
import { buildGenerationPlan } from "../engine/plan";
import { kebabToCamel, kebabToPascal, validateKebabCaseName } from "../naming";

import type { GeneratedFile, GenerationPlan } from "../types";

export interface CustomGeneratorVariables {
  name: string;
  kebab: string;
  camel: string;
  pascal: string;
  title: string;
}

export function customGeneratorVariables(input: string): CustomGeneratorVariables {
  validateKebabCaseName(input, "Generator input");
  return {
    name: input,
    kebab: input,
    camel: kebabToCamel(input),
    pascal: kebabToPascal(input),
    title: input
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
  };
}

const PLACEHOLDER = /\{\{\s*(name|kebab|camel|pascal|title)\s*\}\}/g;

export function renderTemplateString(
  template: string,
  variables: CustomGeneratorVariables
): string {
  return template.replace(
    PLACEHOLDER,
    (_match, key: keyof CustomGeneratorVariables) => variables[key]
  );
}

function listTemplateFiles(root: string, relative = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(path.join(root, relative)).sort()) {
    const entryRelative = relative ? `${relative}/${entry}` : entry;
    if (statSync(path.join(root, entryRelative)).isDirectory()) {
      files.push(...listTemplateFiles(root, entryRelative));
    } else {
      files.push(entryRelative);
    }
  }
  return files;
}

function assertInsideRepo(repoRoot: string, relativePath: string): void {
  const resolved = path.resolve(repoRoot, relativePath);
  if (resolved !== repoRoot && !resolved.startsWith(`${path.resolve(repoRoot)}${path.sep}`)) {
    throw new CliError(
      CliErrorCode.CONTRACT_INVALID,
      `Generator output ${relativePath} resolves outside the repository.`
    );
  }
}

/**
 * Plan a consumer-defined generator from `atlas.config.json#generators.<id>`. Every file under
 * `templates` is rendered into `target`; paths and contents may use {{name}}, {{kebab}},
 * {{camel}}, {{pascal}} and {{title}}. A trailing `.tmpl` suffix is stripped. Existing files
 * are conflicts, exactly as for built-in generators.
 */
export function planCustomGenerationForRepo(
  repoRoot: string,
  project: ResolvedAtlasProject,
  generatorId: string,
  input: string
): GenerationPlan {
  const definition = project.generators?.[generatorId];
  if (!definition) {
    throw new CliError(CliErrorCode.USAGE_ERROR, `Unknown generator: ${generatorId}`);
  }
  const variables = customGeneratorVariables(input);
  const templateRoot = joinRepoPath(repoRoot, definition.templates);
  if (!existsSync(templateRoot) || !statSync(templateRoot).isDirectory()) {
    throw new CliError(
      CliErrorCode.CONTRACT_INVALID,
      `Generator ${generatorId} templates directory does not exist: ${definition.templates}`
    );
  }
  const targetRoot = renderTemplateString(definition.target, variables);
  assertInsideRepo(repoRoot, targetRoot);

  const templateFiles = listTemplateFiles(templateRoot);
  if (templateFiles.length === 0) {
    throw new CliError(
      CliErrorCode.CONTRACT_INVALID,
      `Generator ${generatorId} has no template files in ${definition.templates}`
    );
  }

  const files: GeneratedFile[] = templateFiles.map((templateFile) => {
    const renderedRelative = renderTemplateString(templateFile, variables).replace(/\.tmpl$/, "");
    const relativePath = path.posix.join(targetRoot, renderedRelative);
    assertInsideRepo(repoRoot, relativePath);
    return {
      relativePath,
      content: renderTemplateString(
        readFileSync(path.join(templateRoot, templateFile), "utf8"),
        variables
      ),
    };
  });

  return buildGenerationPlan({
    repoRoot,
    generatorType: generatorId,
    normalizedInput: input,
    targetRoot,
    files,
    followUpActions: (definition.followUp ?? []).map((step) =>
      renderTemplateString(step, variables)
    ),
  });
}
