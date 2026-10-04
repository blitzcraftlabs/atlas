import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  manifestFieldValueIsMalformed,
  readManifestFieldValue,
  type ReleaseManifestFields,
} from "../upgrade/manifest-fields";
import {
  GENERATED_CONSUMER_ROOT_VERSION,
  manifestFieldId,
  parseManifestField,
} from "../upgrade/manifest-ownership";
import { RELEASE_SNAPSHOT_FILENAME } from "../upgrade/release-constants";
import { findCliPackageRoot } from "../version";

import { createDiagnostic, DoctorDiagnosticCode } from "./diagnostics";

import type { DoctorContext } from "./context";
import type { DoctorCheckResult, DoctorDiagnostic } from "./types";

export interface ManifestAlignmentEvidence {
  atlasVersion: string;
  manifestFields?: ReleaseManifestFields;
}

function readSnapshotManifestFields(snapshotPath: string): ReleaseManifestFields | undefined {
  const parsed = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
    manifestFields?: ReleaseManifestFields;
  };
  return parsed.manifestFields;
}

export function loadInstalledManifestEvidence(
  atlasVersion: string
): ManifestAlignmentEvidence | undefined {
  let packageRoot: string;
  try {
    packageRoot = findCliPackageRoot(__dirname);
  } catch {
    return undefined;
  }

  const candidates = [
    path.join(packageRoot, "assets", "releases", atlasVersion, RELEASE_SNAPSHOT_FILENAME),
    path.join(packageRoot, "release-assets", "production", atlasVersion, RELEASE_SNAPSHOT_FILENAME),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    return {
      atlasVersion,
      manifestFields: readSnapshotManifestFields(candidate),
    };
  }

  return undefined;
}

function fieldLabel(field: string): string {
  const parsed = parseManifestField(field);
  if (!parsed || parsed.kind === "version") {
    return "version";
  }
  return parsed.name;
}

function readManifestFile(absolutePath: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(readFileSync(absolutePath, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function fieldMatches(options: {
  relativePath: string;
  field: string;
  expected: string | undefined;
  manifest: Record<string, unknown>;
}): boolean {
  if (
    options.relativePath === "package.json" &&
    options.field === "version" &&
    readManifestFieldValue(options.manifest, options.field) === GENERATED_CONSUMER_ROOT_VERSION
  ) {
    return true;
  }

  if (manifestFieldValueIsMalformed(options.manifest, options.field)) {
    return false;
  }

  return readManifestFieldValue(options.manifest, options.field) === options.expected;
}

function manifestsMatchEvidence(repoRoot: string, fields: ReleaseManifestFields): boolean {
  for (const [relativePath, set] of Object.entries(fields)) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!existsSync(absolutePath)) {
      continue;
    }
    const manifest = readManifestFile(absolutePath);
    if (!manifest) {
      return false;
    }
    for (const field of set.owned) {
      if (!fieldMatches({ relativePath, field, expected: set.values[field], manifest })) {
        return false;
      }
    }
  }
  return true;
}

export function runManifestAlignmentCheck(
  context: DoctorContext,
  loadEvidence: (
    atlasVersion: string
  ) => ManifestAlignmentEvidence | undefined = loadInstalledManifestEvidence
): DoctorCheckResult {
  const base = {
    id: "manifest-alignment",
    title: "Atlas manifest alignment",
    rationale:
      "A recorded Atlas baseline must match the Atlas-owned package manifest fields shipped in that release. Consumer-owned dependency entries are ignored.",
  };

  const baselineVersion = context.checkoutAtlasVersion;
  if (!baselineVersion) {
    return {
      ...base,
      status: "skip",
      diagnostics: [],
      skipReason: "Project Atlas version is unavailable, so manifest alignment was not checked.",
    };
  }

  let baselineEvidence: ManifestAlignmentEvidence | undefined;
  let cliEvidence: ManifestAlignmentEvidence | undefined;
  try {
    baselineEvidence = loadEvidence(baselineVersion);
    if (context.atlasVersion !== baselineVersion) {
      cliEvidence = loadEvidence(context.atlasVersion);
    }
  } catch {
    return {
      ...base,
      status: "fail",
      diagnostics: [
        createDiagnostic(
          DoctorDiagnosticCode.MANIFEST_ALIGNMENT_EVIDENCE_INVALID,
          `Installed Atlas release evidence could not be read.`,
          { path: RELEASE_SNAPSHOT_FILENAME }
        ),
      ],
    };
  }

  const manifestFields = baselineEvidence?.manifestFields;
  if (!manifestFields) {
    return {
      ...base,
      status: "skip",
      diagnostics: [],
      skipReason: `Installed Atlas ${baselineVersion} release evidence has no manifest-field snapshot. Alignment was not checked.`,
    };
  }

  if (
    manifestsMatchEvidence(context.repoRoot, manifestFields) ||
    (cliEvidence?.manifestFields &&
      manifestsMatchEvidence(context.repoRoot, cliEvidence.manifestFields))
  ) {
    return {
      ...base,
      status: "pass",
      diagnostics: [],
    };
  }

  const atlasVersion = baselineEvidence?.atlasVersion ?? baselineVersion;

  const diagnostics: DoctorDiagnostic[] = [];
  const relativePaths = Object.keys(manifestFields).sort((left, right) =>
    left.localeCompare(right)
  );

  for (const relativePath of relativePaths) {
    const absolutePath = path.join(context.repoRoot, relativePath);
    if (!existsSync(absolutePath)) {
      continue;
    }

    let manifest: Record<string, unknown>;
    try {
      const parsed = JSON.parse(readFileSync(absolutePath, "utf8")) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("manifest root is not an object");
      }
      manifest = parsed as Record<string, unknown>;
    } catch {
      diagnostics.push(
        createDiagnostic(
          DoctorDiagnosticCode.MANIFEST_ALIGNMENT_DRIFT,
          `${relativePath} is not valid JSON, so Atlas cannot confirm baseline ${atlasVersion} manifest alignment.`,
          { path: relativePath }
        )
      );
      continue;
    }

    const set = manifestFields[relativePath];
    if (!set) {
      continue;
    }

    for (const field of [...set.owned].sort((left, right) => left.localeCompare(right))) {
      const expected = set.values[field];
      if (manifestFieldValueIsMalformed(manifest, field)) {
        diagnostics.push(
          createDiagnostic(
            DoctorDiagnosticCode.MANIFEST_ALIGNMENT_DRIFT,
            `${manifestFieldId(relativePath, field)} is not a string. Atlas ${atlasVersion} expects ${expected ?? "the field to be absent"}.`,
            { path: relativePath }
          )
        );
        continue;
      }

      const actual = readManifestFieldValue(manifest, field);
      if (actual === expected) {
        continue;
      }
      if (
        relativePath === "package.json" &&
        field === "version" &&
        actual === GENERATED_CONSUMER_ROOT_VERSION
      ) {
        continue;
      }

      const actualLabel = actual ?? "(absent)";
      const expectedLabel = expected ?? "(absent)";
      diagnostics.push(
        createDiagnostic(
          DoctorDiagnosticCode.MANIFEST_ALIGNMENT_DRIFT,
          `${fieldLabel(field)} = ${actualLabel}; Atlas ${atlasVersion} expects ${expectedLabel}.`,
          { path: relativePath }
        )
      );
    }
  }

  return {
    ...base,
    status: diagnostics.length > 0 ? "fail" : "pass",
    diagnostics,
  };
}
