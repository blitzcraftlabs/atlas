/** Packaged production release assets, relative to the installed `@blitzcraftlabs/atlas` package. */
export const PACKAGED_RELEASE_ASSET_ROOT_SEGMENTS = ["assets", "releases"] as const;

/** Committed production snapshots, relative to the `@blitzcraftlabs/atlas` package root. */
export const SOURCE_PRODUCTION_RELEASES_RELATIVE_PATH = "release-assets/production";

export const RELEASE_SNAPSHOT_FILENAME = "release.snapshot.json";
export const RELEASE_CATALOG_FILENAME = "catalog.json";
export const RELEASE_CATALOG_SCHEMA_VERSION = 1;
export const PRODUCTION_RELEASE_SUPPORT_POLICY = "adjacent-published-releases" as const;

/** Verified npm publications. Snapshot directories are not publication evidence. */
export const PUBLISHED_RELEASES_FILENAME = "published-releases.json";
export const PUBLISHED_RELEASES_SCHEMA_VERSION = 1;

/**
 * Explicit recovery when a packaged catalog treated an unpublished snapshot as the
 * previous supported release. The bridge applies only on the first later release that
 * is actually published to npm, so stranded published consumers can reach the fix
 * without a fake hop. A snapshot directory, GitHub tag, or GitHub Release does not
 * consume the bridge and does not become a supported predecessor.
 */
export const STRANDED_PUBLISHED_RELEASE_BRIDGES = [
  {
    id: "unpublished-snapshot-1.2.3",
    faultyRelease: "1.2.4",
    unpublishedSnapshots: ["1.2.3"],
    strandedSources: ["1.2.2"],
  },
] as const;

export const DEFAULT_OPENAPI_SPEC_RELATIVE_PATH = "openapi/openapi.json";

/**
 * Repository-local rehearsal snapshots. They are not a public compatibility promise and must never
 * appear in the production catalog or packaged release assets.
 */
export const REHEARSAL_ONLY_ATLAS_VERSIONS = ["0.1.0", "0.2.0"] as const;

export const SNAPSHOT_PACKAGE_MANIFEST_PATHS = [
  "packages/cli/package.json",
  "packages/config/package.json",
  "packages/consent/package.json",
  "packages/project/package.json",
  "packages/ui/package.json",
] as const;
