/**
 * Atlas-owned package manifest fields.
 *
 * Consumers may add their own dependencies. Only fields listed here are recorded in release
 * evidence and evolved during upgrade. Values come from each release snapshot, not from literals
 * in the upgrader.
 */
export const MANAGED_MANIFEST_RELATIVE_PATHS = [
  "package.json",
  "apps/web/package.json",
  "packages/config/package.json",
  "packages/consent/package.json",
  "packages/ui/package.json",
  "packages/project/package.json",
  "packages/cli/package.json",
] as const;

export type ManagedManifestRelativePath = (typeof MANAGED_MANIFEST_RELATIVE_PATHS)[number];

/** Dependency sections Atlas may own inside a package manifest. */
export const MANAGED_DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
] as const;

export type ManagedDependencySection = (typeof MANAGED_DEPENDENCY_SECTIONS)[number];

export interface ManagedManifestField {
  relativePath: ManagedManifestRelativePath;
  /** `version` or `<section>.<package>` such as `dependencies.next`. */
  field: string;
}

/**
 * Explicit platform pins. Workspace package identity is owned everywhere listed above.
 * Dependency ownership stays narrow: only platform pins whose release value must move with Atlas.
 */
export const ATLAS_MANAGED_MANIFEST_FIELDS: readonly ManagedManifestField[] = [
  { relativePath: "package.json", field: "version" },
  { relativePath: "apps/web/package.json", field: "version" },
  { relativePath: "apps/web/package.json", field: "dependencies.next" },
  { relativePath: "packages/config/package.json", field: "version" },
  { relativePath: "packages/config/package.json", field: "devDependencies.eslint-config-next" },
  { relativePath: "packages/consent/package.json", field: "version" },
  { relativePath: "packages/ui/package.json", field: "version" },
  { relativePath: "packages/project/package.json", field: "version" },
  { relativePath: "packages/cli/package.json", field: "version" },
];

/** Root version written by `atlas init` before the first upgrade adopts the Atlas release version. */
export const GENERATED_CONSUMER_ROOT_VERSION = "0.1.0";

/**
 * Atlas 1.3.1 advanced baseline and some workspace versions without evolving every owned manifest
 * field. These are the platform values that upgrader could leave behind. They are not a general
 * license to treat any older version as Atlas-owned.
 */
export const PARTIAL_UPGRADE_1_3_1_BASELINE = "1.3.1";

export const PARTIAL_UPGRADE_1_3_1_STALE_VALUES: Readonly<Record<string, readonly string[]>> = {
  "apps/web/package.json#version": ["1.2.2", "1.2.4"],
  "apps/web/package.json#dependencies.next": ["16.3.3"],
  "packages/config/package.json#devDependencies.eslint-config-next": ["16.3.3"],
};

const FIELD_PATTERN = /^version$|^(dependencies|devDependencies|peerDependencies)\..+$/;

export function manifestFieldId(relativePath: string, field: string): string {
  return `${relativePath}#${field}`;
}

export function isManagedManifestField(field: string): boolean {
  return FIELD_PATTERN.test(field);
}

export function parseManifestField(
  field: string
):
  | { kind: "version" }
  | { kind: "dependency"; section: ManagedDependencySection; name: string }
  | undefined {
  if (field === "version") {
    return { kind: "version" };
  }

  const separator = field.indexOf(".");
  if (separator <= 0) {
    return undefined;
  }

  const section = field.slice(0, separator);
  const name = field.slice(separator + 1);
  if (
    !MANAGED_DEPENDENCY_SECTIONS.includes(section as ManagedDependencySection) ||
    name.length === 0
  ) {
    return undefined;
  }

  return { kind: "dependency", section: section as ManagedDependencySection, name };
}
