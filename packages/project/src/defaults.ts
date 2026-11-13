import { normalizeRepoRelativePath } from "./paths";

import type { RawAtlasProjectContract, ResolvedAtlasProject } from "./schema";

export const DEFAULT_ATLAS_PROJECT_CONTRACT: Omit<ResolvedAtlasProject, "schemaVersion"> = {
  application: {
    root: "apps/web",
  },
  features: {
    product: "apps/web/src/features",
    reference: "apps/reference/src/features",
    examples: "apps/web/src/features/examples",
  },
  reference: {
    components: "apps/reference/src/features/components",
    routes: "apps/reference/src/app",
  },
  ui: {
    package: "@atlas/ui",
    path: "packages/ui",
    sourceImports: false,
  },
  generated: {
    openApi: {
      spec: "openapi/openapi.json",
      schema: "apps/web/src/lib/api/contracts/schema.ts",
    },
  },
  capabilities: {
    auth: true,
    consent: true,
    analytics: true,
    featureFlags: true,
    i18n: true,
    openApi: true,
    observability: true,
  },
  boundaries: {
    noFeatureToFeatureImports: true,
    noProductImportsFromReference: true,
    uiPublicApiOnly: true,
  },
};

export function resolveAtlasProjectContract(raw: RawAtlasProjectContract): ResolvedAtlasProject {
  const merged: ResolvedAtlasProject = {
    schemaVersion: 1,
    application: {
      ...DEFAULT_ATLAS_PROJECT_CONTRACT.application,
      ...raw.application,
    },
    features: {
      ...DEFAULT_ATLAS_PROJECT_CONTRACT.features,
      ...raw.features,
    },
    reference: {
      ...DEFAULT_ATLAS_PROJECT_CONTRACT.reference,
      ...raw.reference,
    },
    ui: {
      ...DEFAULT_ATLAS_PROJECT_CONTRACT.ui,
      ...raw.ui,
    },
    generated: {
      openApi: {
        ...DEFAULT_ATLAS_PROJECT_CONTRACT.generated.openApi,
        ...raw.generated?.openApi,
      },
    },
    capabilities: {
      ...DEFAULT_ATLAS_PROJECT_CONTRACT.capabilities,
      ...raw.capabilities,
    },
    boundaries: {
      ...DEFAULT_ATLAS_PROJECT_CONTRACT.boundaries,
      ...raw.boundaries,
    },
  };

  const resolved: ResolvedAtlasProject = {
    schemaVersion: merged.schemaVersion,
    application: {
      root: normalizeRepoRelativePath(merged.application.root),
    },
    features: {
      product: normalizeRepoRelativePath(merged.features.product),
      reference: normalizeRepoRelativePath(merged.features.reference),
      examples: normalizeRepoRelativePath(merged.features.examples),
    },
    reference: {
      components: normalizeRepoRelativePath(merged.reference.components),
      routes: normalizeRepoRelativePath(merged.reference.routes),
    },
    ui: {
      package: merged.ui.package,
      path: normalizeRepoRelativePath(merged.ui.path),
      sourceImports: merged.ui.sourceImports,
    },
    generated: {
      openApi: {
        spec: normalizeRepoRelativePath(merged.generated.openApi.spec),
        schema: normalizeRepoRelativePath(merged.generated.openApi.schema),
      },
    },
    capabilities: { ...merged.capabilities },
    boundaries: { ...merged.boundaries },
  };

  if (raw.generators && Object.keys(raw.generators).length > 0) {
    resolved.generators = Object.fromEntries(
      Object.entries(raw.generators)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, generator]) => [
          id,
          {
            ...generator,
            templates: normalizeRepoRelativePath(generator.templates),
            target: normalizeRepoRelativePath(generator.target),
          },
        ])
    );
  }

  if (raw.platform?.baseline) {
    resolved.platform = {
      baseline: {
        atlasVersion: raw.platform.baseline.atlasVersion,
        contractSchemaVersion: raw.platform.baseline.contractSchemaVersion,
        templateManifestSchemaVersion: raw.platform.baseline.templateManifestSchemaVersion,
        syncedPathChecksums: Object.fromEntries(
          Object.entries(raw.platform.baseline.syncedPathChecksums).sort(([left], [right]) =>
            left.localeCompare(right)
          )
        ),
        ...(raw.platform.baseline.repositorySyncedPathChecksums
          ? {
              repositorySyncedPathChecksums: Object.fromEntries(
                Object.entries(raw.platform.baseline.repositorySyncedPathChecksums).sort(
                  ([left], [right]) => left.localeCompare(right)
                )
              ),
            }
          : {}),
      },
    };
  }

  return resolved;
}
