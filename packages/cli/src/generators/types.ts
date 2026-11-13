import type { PlannedAction } from "../types/result";

export type BuiltinGeneratorType = "feature" | "page";

/** Built-in generator ids plus consumer-defined ids from `atlas.config.json#generators`. */
export type GeneratorType = BuiltinGeneratorType | (string & {});

export interface GeneratedFile {
  relativePath: string;
  content: string;
}

export interface GenerationPlan {
  generatorType: GeneratorType;
  normalizedInput: string;
  targetRoot: string;
  files: GeneratedFile[];
  actions: PlannedAction[];
  followUpActions: string[];
}

export interface GenerationResult {
  repoRoot: string;
  atlasVersion: string;
  generatorType: GeneratorType;
  normalizedInput: string;
  targetRoot: string;
  dryRun: boolean;
  actions: PlannedAction[];
  followUpActions: string[];
  warnings: [];
}
