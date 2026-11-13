import type { ResolvedAtlasProject } from "./schema";

function sortRecord<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right))
  ) as T;
}

/** Produce deterministic, fully-serializable JSON for tooling and agents. */
export function serializeResolvedAtlasProject(project: ResolvedAtlasProject): string {
  const payload = sortRecord({
    schemaVersion: project.schemaVersion,
    application: sortRecord({ ...project.application }),
    features: sortRecord({ ...project.features }),
    reference: sortRecord({ ...project.reference }),
    ui: sortRecord({ ...project.ui }),
    generated: {
      openApi: sortRecord({ ...project.generated.openApi }),
    },
    capabilities: sortRecord({ ...project.capabilities }),
    boundaries: sortRecord({ ...project.boundaries }),
    ...(project.generators ? { generators: sortRecord({ ...project.generators }) } : {}),
    ...(project.platform
      ? {
          platform: {
            baseline: sortRecord({
              ...project.platform.baseline,
              syncedPathChecksums: sortRecord({
                ...project.platform.baseline.syncedPathChecksums,
              }),
              ...(project.platform.baseline.repositorySyncedPathChecksums
                ? {
                    repositorySyncedPathChecksums: sortRecord({
                      ...project.platform.baseline.repositorySyncedPathChecksums,
                    }),
                  }
                : {}),
            }),
          },
        }
      : {}),
  });

  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function toResolvedAtlasProjectJson(project: ResolvedAtlasProject): ResolvedAtlasProject {
  return JSON.parse(serializeResolvedAtlasProject(project)) as ResolvedAtlasProject;
}
