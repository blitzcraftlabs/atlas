export type CapabilityId =
  | "docs"
  | "storybook"
  | "visual"
  | "perf-ci"
  | "security"
  | "updates"
  | "upgrades"
  | "coverage"
  | "hooks"
  | "cursor"
  | "docker";

export type CapabilityTier = "default" | "opt-in";

export interface CapabilityFileMapping {
  source: string;
  destination: string;
  exclude?: string[];
}

export interface PackageManifestPatch {
  path: string;
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  pnpmOverrides?: Record<string, string>;
  /**
   * Current `devDependencies` values that Atlas may replace (known shipped
   * specifiers). Other values conflict and are left untouched.
   */
  replaceableDevDependencies?: Record<string, string[]>;
  /**
   * `conflicts-only` ignores match/missing/replaceable keys when deriving
   * capability status. Use for keys that also exist on the default starter
   * (aligned Playwright) so Storybook/visual stay absent until their files exist.
   */
  statusMode?: "all" | "conflicts-only";
}

export interface CapabilityDefinition {
  id: CapabilityId;
  title: string;
  description: string;
  tier: CapabilityTier;
  heavier: boolean;
  requires: CapabilityId[];
  detectPath: string;
  files: CapabilityFileMapping[];
  /** UI package.json script names to restore from the canonical UI manifest. */
  restoreUiScriptNames?: string[];
  /** Extra root package.json scripts to merge. */
  rootScripts?: Record<string, string>;
  /** Extra root devDependencies to merge. */
  rootDevDependencies?: Record<string, string>;
  /** Generate files in application code rather than copying packaged assets. */
  generated?: boolean;
  /**
   * Command that actually exercises the capability. File presence is not a substitute
   * for a successful run of this command.
   */
  validationCommand: string;
}

export interface PackagedCapabilityEntry {
  destination: string;
  sha256: string;
  mode: string;
}

export interface PackagedCapability {
  id: CapabilityId;
  title: string;
  description: string;
  tier: CapabilityTier;
  heavier: boolean;
  requires: CapabilityId[];
  detectPath: string;
  generated?: boolean;
  validationCommand: string;
  entries: PackagedCapabilityEntry[];
  packagePatches: PackageManifestPatch[];
}

export interface PackagedCapabilitiesManifest {
  schemaVersion: 1;
  atlasVersion: string;
  capabilities: PackagedCapability[];
}
