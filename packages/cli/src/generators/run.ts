import { loadProjectContext } from "../context/atlas-context";

import { applyGenerationPlan } from "./engine/apply";

import type { AtlasCliContext } from "../context/atlas-context";
import type { GenerationPlan, GenerationResult } from "./types";

export interface RunGeneratorOptions {
  context: AtlasCliContext;
  dryRun: boolean;
  plan: GenerationPlan;
}

export function runGenerator(options: RunGeneratorOptions): GenerationResult {
  loadProjectContext(options.context);

  if (!options.dryRun) {
    applyGenerationPlan(options.context.repoRoot, options.plan);
  }

  return {
    repoRoot: options.context.repoRoot,
    atlasVersion: options.context.atlasVersion,
    generatorType: options.plan.generatorType,
    normalizedInput: options.plan.normalizedInput,
    targetRoot: options.plan.targetRoot,
    dryRun: options.dryRun,
    actions: options.plan.actions,
    followUpActions: options.plan.followUpActions,
    warnings: [],
  };
}

export { planCustomGenerationForRepo } from "./custom/generate";
export { planFeatureGenerationForRepo } from "./feature/generate";
export { planPageGenerationForRepo } from "./page/generate";
