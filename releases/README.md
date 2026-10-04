# Atlas release snapshots

`atlas upgrade` plans upgrades **without Git ancestry** to upstream Atlas.

## Production evidence (installed CLI)

External consumers load production snapshots from the installed `@blitzcraftlabs/atlas` package:

```text
@blitzcraftlabs/atlas
└── assets/releases/
    ├── catalog.json
    └── <supported-version>/
        ├── release.snapshot.json
        └── ...
```

`--releases-dir` is an explicit fixture/maintainer override. Normal `atlas upgrade --to <version>`
does **not** read a consumer or checkout `releases/` directory. Missing packaged evidence fails
closed.

The pre-1.0 support window is the current Atlas release plus the immediately previous supported
production release. Adjacent upgrades only. Unsupported source or target versions fail with a clear
message.

Generated consumers do not carry Atlas release history.

## `release.snapshot.json` (schema v1)

```json
{
  "schemaVersion": 1,
  "atlasVersion": "0.4.0",
  "contractSchemaVersion": 1,
  "templateManifestSchemaVersion": 1,
  "canonicalApplication": "apps/web",
  "syncedPaths": ["src/lib/api/errors.ts"],
  "generatedPaths": ["src/lib/api/contracts/schema.ts"],
  "independentPaths": ["src/lib/application/authz.ts"],
  "packageVersions": {
    "@atlas/ui": "0.4.0",
    "@atlas/web": "0.4.0"
  },
  "manifestFields": {
    "apps/web/package.json": {
      "owned": ["dependencies.next", "version"],
      "values": {
        "dependencies.next": "16.3.8",
        "version": "0.4.0"
      }
    }
  },
  "openApiSpecRelativePath": "openapi/openapi.json"
}
```

The loader (`packages/cli/src/upgrade/release-snapshot.ts`) validates this manifest and reads file
contents from the release directory. Source-era snapshots are required so paths introduced after a
consumer baseline are not invisible to the planner.

Canonical production snapshots are generated from the release tree at version time and stored under
`packages/cli/release-assets/production/`. The CLI build copies the support-window subset into
`assets/releases/`.

## Rehearsal snapshots

`releases/0.1.0/` and `releases/0.2.0/` contain a **minimal rehearsal pair** used by CLI upgrade
tests. They do **not** represent the full production manifest surface and are **not** public upgrade
support. Do not package them as a compatibility promise.

See [upgrades.md](../docs/how-we-build/upgrades.md) and [cli.md](../docs/how-we-build/cli.md).
