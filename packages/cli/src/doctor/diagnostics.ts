import type { DoctorDiagnostic, DoctorDiagnosticSeverity } from "./types";

export const DoctorDiagnosticCode = {
  CONTRACT_MISSING: "ATLAS_CONTRACT_MISSING",
  CONTRACT_INVALID: "ATLAS_CONTRACT_INVALID",
  CONTRACT_UNSUPPORTED: "ATLAS_CONTRACT_UNSUPPORTED",
  BOUNDARY_PRIVATE_IMPORT: "ATLAS_BOUNDARY_PRIVATE_IMPORT",
  BOUNDARY_DIRECT_ENV: "ATLAS_BOUNDARY_DIRECT_ENV",
  BOUNDARY_RAW_NETWORK: "ATLAS_BOUNDARY_RAW_NETWORK",
  BOUNDARY_REFERENCE_IMPORT: "ATLAS_BOUNDARY_REFERENCE_IMPORT",
  BOUNDARY_CROSS_FEATURE_IMPORT: "ATLAS_BOUNDARY_CROSS_FEATURE_IMPORT",
  BOUNDARY_ANALYTICS_VENDOR: "ATLAS_BOUNDARY_ANALYTICS_VENDOR",
  ARCHITECTURE_POLICY_MISSING: "ATLAS_ARCHITECTURE_POLICY_MISSING",
  ARCHITECTURE_POLICY_UNSUPPORTED_ROOT: "ATLAS_ARCHITECTURE_POLICY_UNSUPPORTED_ROOT",
  DEPENDENCY_UNDECLARED: "ATLAS_DEPENDENCY_UNDECLARED",
  GENERATED_OPENAPI_STALE: "ATLAS_GENERATED_OPENAPI_STALE",
  GENERATED_OPENAPI_INVALID: "ATLAS_GENERATED_OPENAPI_INVALID",
  VERSION_MISMATCH: "ATLAS_VERSION_MISMATCH",
  ROOT_PACKAGE_METADATA_INVALID: "ATLAS_ROOT_PACKAGE_METADATA_INVALID",
  WORKSPACE_CONFIG_MISSING: "ATLAS_WORKSPACE_CONFIG_MISSING",
  WORKSPACE_PACKAGE_MANIFEST_MISSING: "ATLAS_WORKSPACE_PACKAGE_MANIFEST_MISSING",
  WORKSPACE_NOT_INCLUDED: "ATLAS_WORKSPACE_NOT_INCLUDED",
  DOCTOR_CHECK_EXECUTION_FAILED: "ATLAS_DOCTOR_CHECK_EXECUTION_FAILED",
  TEMPLATE_SYNC_DRIFT: "ATLAS_TEMPLATE_SYNC_DRIFT",
  TEMPLATE_SYNC_CANONICAL_MISSING: "ATLAS_TEMPLATE_SYNC_CANONICAL_MISSING",
  TEMPLATE_SYNC_STRUCTURE: "ATLAS_TEMPLATE_SYNC_STRUCTURE",
  TEMPLATE_SYNC_MANIFEST_INVALID: "ATLAS_TEMPLATE_SYNC_MANIFEST_INVALID",
  UPGRADE_BASELINE_MISSING: "ATLAS_UPGRADE_BASELINE_MISSING",
  UPGRADE_BASELINE_STALE: "ATLAS_UPGRADE_BASELINE_STALE",
  UPGRADE_BASELINE_INCOMPLETE: "ATLAS_UPGRADE_BASELINE_INCOMPLETE",
  UPGRADE_BASELINE_CHECKSUM_INVALID: "ATLAS_UPGRADE_BASELINE_CHECKSUM_INVALID",
  UPGRADE_BASELINE_MANIFEST_INCOMPATIBLE: "ATLAS_UPGRADE_BASELINE_MANIFEST_INCOMPATIBLE",
  UPGRADE_BASELINE_STALE_ENTRY: "ATLAS_UPGRADE_BASELINE_STALE_ENTRY",
  MANIFEST_ALIGNMENT_DRIFT: "ATLAS_MANIFEST_ALIGNMENT_DRIFT",
  MANIFEST_ALIGNMENT_EVIDENCE_INVALID: "ATLAS_MANIFEST_ALIGNMENT_EVIDENCE_INVALID",
} as const;

export type DoctorDiagnosticCodeType =
  (typeof DoctorDiagnosticCode)[keyof typeof DoctorDiagnosticCode];

interface DiagnosticDefinition {
  severity: DoctorDiagnosticSeverity;
  suggestedFix: string;
  documentation?: string;
}

export const DOCTOR_DIAGNOSTIC_DEFINITIONS: Record<string, DiagnosticDefinition> = {
  [DoctorDiagnosticCode.CONTRACT_MISSING]: {
    severity: "error",
    suggestedFix:
      "Create atlas.config.json at the repository root or run `atlas init` in a compatible checkout.",
    documentation: "docs/how-we-build/atlas-contract.md",
  },
  [DoctorDiagnosticCode.CONTRACT_INVALID]: {
    severity: "error",
    suggestedFix:
      "Fix atlas.config.json so it validates through @atlas/project, then rerun `atlas doctor`.",
    documentation: "docs/how-we-build/atlas-contract.md",
  },
  [DoctorDiagnosticCode.CONTRACT_UNSUPPORTED]: {
    severity: "error",
    suggestedFix:
      "Upgrade this Atlas checkout or adjust atlas.config.json schemaVersion to a supported version.",
    documentation: "docs/how-we-build/atlas-contract.md",
  },
  [DoctorDiagnosticCode.BOUNDARY_PRIVATE_IMPORT]: {
    severity: "error",
    suggestedFix:
      "Import from the package public entry point (for example `@atlas/ui`) instead of workspace source paths or UI-internal app aliases.",
    documentation: "docs/how-we-build/architecture-ownership.md",
  },
  [DoctorDiagnosticCode.BOUNDARY_DIRECT_ENV]: {
    severity: "error",
    suggestedFix:
      "Use `getServerConfig()` on the server or `useConfig()` on the client instead of direct `process.env` or `@/env` imports.",
    documentation: "docs/how-we-build/architecture-ownership.md",
  },
  [DoctorDiagnosticCode.BOUNDARY_RAW_NETWORK]: {
    severity: "error",
    suggestedFix:
      "Use the central API client from `@/lib/api` instead of raw `fetch()` in application-layer code.",
    documentation: "docs/how-we-build/api.md",
  },
  [DoctorDiagnosticCode.BOUNDARY_REFERENCE_IMPORT]: {
    severity: "error",
    suggestedFix:
      "Do not import reference or example modules from product features. Copy the pattern or extract shared logic to `src/lib/`.",
    documentation: "docs/how-we-build/architecture-ownership.md",
  },
  [DoctorDiagnosticCode.BOUNDARY_CROSS_FEATURE_IMPORT]: {
    severity: "error",
    suggestedFix:
      "Do not import one product feature from another. Extract shared logic to `src/lib/` and import from there.",
    documentation: "docs/how-we-build/architecture-ownership.md",
  },
  [DoctorDiagnosticCode.BOUNDARY_ANALYTICS_VENDOR]: {
    severity: "error",
    suggestedFix:
      "Use the analytics adapter from `@/lib/analytics` instead of importing analytics vendor SDKs directly.",
    documentation: "docs/how-we-build/architecture-ownership.md",
  },
  [DoctorDiagnosticCode.DEPENDENCY_UNDECLARED]: {
    severity: "error",
    suggestedFix:
      "Declare the imported package in the owning workspace package.json dependencies, devDependencies, or peerDependencies.",
    documentation: "docs/how-we-build/folder-structure.md",
  },
  [DoctorDiagnosticCode.GENERATED_OPENAPI_STALE]: {
    severity: "error",
    suggestedFix:
      "Run `pnpm api:gen` and commit the updated OpenAPI client artifacts for both applications.",
    documentation: "docs/how-we-build/architecture-ownership.md",
  },
  [DoctorDiagnosticCode.GENERATED_OPENAPI_INVALID]: {
    severity: "error",
    suggestedFix:
      "Run the canonical API generation command locally, fix the OpenAPI source or generator error, then rerun `atlas doctor`.",
    documentation: "docs/how-we-build/architecture-ownership.md",
  },
  [DoctorDiagnosticCode.ARCHITECTURE_POLICY_MISSING]: {
    severity: "error",
    suggestedFix:
      "Restore the application ESLint config and architecture policy files required for Atlas boundary enforcement.",
    documentation: "docs/how-we-build/architecture-ownership.md",
  },
  [DoctorDiagnosticCode.ARCHITECTURE_POLICY_UNSUPPORTED_ROOT]: {
    severity: "error",
    suggestedFix:
      "Move the product feature root under `<application.root>/src`, or extend the Atlas architecture contract/tooling before using an external feature root.",
    documentation: "docs/how-we-build/atlas-contract.md",
  },
  [DoctorDiagnosticCode.ROOT_PACKAGE_METADATA_INVALID]: {
    severity: "error",
    suggestedFix:
      "Restore a valid root package.json with a meaningful version field so Atlas Doctor can compare checkout metadata.",
    documentation: "docs/how-we-build/releases-and-governance.md",
  },
  [DoctorDiagnosticCode.WORKSPACE_CONFIG_MISSING]: {
    severity: "error",
    suggestedFix:
      "Restore pnpm-workspace.yaml and include the configured application and UI workspace roots.",
    documentation: "docs/how-we-build/folder-structure.md",
  },
  [DoctorDiagnosticCode.DOCTOR_CHECK_EXECUTION_FAILED]: {
    severity: "error",
    suggestedFix:
      "Inspect the underlying tooling or configuration error. If the checkout is valid, report this as an Atlas CLI defect.",
  },
  [DoctorDiagnosticCode.VERSION_MISMATCH]: {
    severity: "warning",
    suggestedFix:
      "Align the installed Atlas CLI snapshot with the checkout version, or upgrade using the supported migration path when available.",
    documentation: "docs/how-we-build/releases-and-governance.md",
  },
  [DoctorDiagnosticCode.WORKSPACE_PACKAGE_MANIFEST_MISSING]: {
    severity: "error",
    suggestedFix:
      "Add the missing package.json for the configured Atlas workspace root declared in atlas.config.json.",
    documentation: "docs/how-we-build/atlas-contract.md",
  },
  [DoctorDiagnosticCode.WORKSPACE_NOT_INCLUDED]: {
    severity: "error",
    suggestedFix:
      "Include the configured Atlas workspace root in pnpm-workspace.yaml so pnpm discovers the package.",
    documentation: "docs/how-we-build/folder-structure.md",
  },
  [DoctorDiagnosticCode.TEMPLATE_SYNC_DRIFT]: {
    severity: "error",
    suggestedFix:
      "Run `atlas sync infrastructure` to copy canonical starter template files into consumer applications, or document intentional divergence in templates/app-infrastructure.manifest.json independentPaths.",
    documentation: "docs/how-we-build/architecture-ownership.md",
  },
  [DoctorDiagnosticCode.TEMPLATE_SYNC_CANONICAL_MISSING]: {
    severity: "error",
    suggestedFix:
      "Restore the missing path in the canonical starter application or remove it from templates/app-infrastructure.manifest.json syncedPaths.",
    documentation: "docs/how-we-build/architecture-ownership.md",
  },
  [DoctorDiagnosticCode.TEMPLATE_SYNC_STRUCTURE]: {
    severity: "error",
    suggestedFix:
      "Restore the required infrastructure module or update templates/app-infrastructure.manifest.json if ownership changed.",
    documentation: "docs/how-we-build/architecture-ownership.md",
  },
  [DoctorDiagnosticCode.TEMPLATE_SYNC_MANIFEST_INVALID]: {
    severity: "error",
    suggestedFix:
      "Fix templates/app-infrastructure.manifest.json so Atlas can validate starter/reference synchronization policy.",
    documentation: "docs/how-we-build/architecture-ownership.md",
  },
  [DoctorDiagnosticCode.UPGRADE_BASELINE_MISSING]: {
    severity: "warning",
    suggestedFix:
      "Record `platform.baseline` in atlas.config.json via `atlas init` on first bootstrap or the baseline capture helpers documented in docs/how-we-build/upgrades.md.",
    documentation: "docs/how-we-build/upgrades.md",
  },
  [DoctorDiagnosticCode.UPGRADE_BASELINE_STALE]: {
    severity: "warning",
    suggestedFix:
      "Complete the supported upgrade path for your recorded Atlas baseline version, then refresh platform.baseline metadata.",
    documentation: "docs/how-we-build/upgrades.md",
  },
  [DoctorDiagnosticCode.UPGRADE_BASELINE_INCOMPLETE]: {
    severity: "error",
    suggestedFix:
      "Re-capture platform.baseline after restoring all manifest syncedPaths in the canonical application, or complete the supported upgrade path before attempting automated template replacements.",
    documentation: "docs/how-we-build/upgrades.md",
  },
  [DoctorDiagnosticCode.UPGRADE_BASELINE_CHECKSUM_INVALID]: {
    severity: "error",
    suggestedFix:
      "Replace malformed checksum values with sha256:<64 hex characters> or re-run `pnpm --filter @atlas/project capture-baseline` on a healthy checkout.",
    documentation: "docs/how-we-build/upgrades.md",
  },
  [DoctorDiagnosticCode.UPGRADE_BASELINE_MANIFEST_INCOMPATIBLE]: {
    severity: "warning",
    suggestedFix:
      "Refresh platform.baseline after adopting the current template manifest schema version documented in upgrades.md.",
    documentation: "docs/how-we-build/upgrades.md",
  },
  [DoctorDiagnosticCode.UPGRADE_BASELINE_STALE_ENTRY]: {
    severity: "warning",
    suggestedFix:
      "Remove stale baseline checksum entries or re-capture platform.baseline so evidence matches current manifest syncedPaths.",
    documentation: "docs/how-we-build/upgrades.md",
  },
  [DoctorDiagnosticCode.MANIFEST_ALIGNMENT_DRIFT]: {
    severity: "error",
    suggestedFix:
      "Run `pnpm atlas upgrade` so Atlas-owned manifest fields match the recorded baseline.",
    documentation: "docs/how-we-build/upgrades.md",
  },
  [DoctorDiagnosticCode.MANIFEST_ALIGNMENT_EVIDENCE_INVALID]: {
    severity: "error",
    suggestedFix:
      "Reinstall @blitzcraftlabs/atlas so Doctor can read the local release snapshot for this baseline. Doctor does not query a registry.",
    documentation: "docs/how-we-build/upgrades.md",
  },
};

export function createCheckExecutionFailedDiagnostic(
  checkId: string,
  reason?: string
): DoctorDiagnostic {
  const reasonSuffix = reason ? `: ${reason}` : "";
  return createDiagnostic(
    DoctorDiagnosticCode.DOCTOR_CHECK_EXECUTION_FAILED,
    `Doctor could not execute the "${checkId}" check${reasonSuffix}.`
  );
}

export function createDiagnostic(
  code: string,
  message: string,
  options?: {
    path?: string;
    line?: number;
    column?: number;
    suggestedFix?: string;
    documentation?: string;
    severity?: DoctorDiagnosticSeverity;
  }
): DoctorDiagnostic {
  const definition = DOCTOR_DIAGNOSTIC_DEFINITIONS[code];
  return {
    code,
    severity: options?.severity ?? definition?.severity ?? "error",
    message,
    suggestedFix:
      options?.suggestedFix ?? definition?.suggestedFix ?? "Review the Atlas architecture docs.",
    documentation: options?.documentation ?? definition?.documentation,
    path: options?.path,
    line: options?.line,
    column: options?.column,
  };
}
