import { DoctorCheckExecutionError } from "./check-execution-error";
import {
  runArchitectureBoundariesCheck,
  runAtlasVersionCheck,
  runDependencyDeclarationsCheck,
  runGeneratedOpenApiCheck,
  runProjectContractCheck,
  runWorkspaceStructureCheck,
} from "./checks";
import { createCheckExecutionFailedDiagnostic } from "./diagnostics";
import { runManifestAlignmentCheck } from "./manifest-alignment";
import { sortDiagnostics } from "./map-eslint";
import { runTemplateInfrastructureSyncCheck } from "./template-sync";
import { DOCTOR_REPORT_SCHEMA_VERSION } from "./types";
import { runUpgradeBaselineCheck } from "./upgrade-baseline";

import type { DoctorContext } from "./context";
import type {
  DoctorCheckDefinition,
  DoctorCheckResult,
  DoctorDiagnostic,
  DoctorReport,
  DoctorReportStatus,
  DoctorReportSummary,
} from "./types";

export const DOCTOR_CHECKS: DoctorCheckDefinition[] = [
  {
    id: "project-contract",
    title: "Project contract",
    rationale:
      "Atlas tooling cannot reason reliably about architecture without a valid atlas.config.json contract resolved through @atlas/project.",
    run: runProjectContractCheck,
  },
  {
    id: "workspace-structure",
    title: "Workspace structure",
    rationale:
      "Configured Atlas workspace roots must exist and be discoverable by pnpm for reliable package boundaries.",
    run: runWorkspaceStructureCheck,
  },
  {
    id: "architecture-boundaries",
    title: "Architecture boundaries",
    rationale:
      "Source bypassing owned boundaries makes migrations, hoisting assumptions, and agent behavior less predictable.",
    run: runArchitectureBoundariesCheck,
  },
  {
    id: "dependency-declarations",
    title: "Dependency declarations",
    rationale:
      "pnpm workspace hoisting can hide undeclared dependency reliance that regresses when package graphs change.",
    run: runDependencyDeclarationsCheck,
  },
  {
    id: "generated-openapi",
    title: "Generated OpenAPI",
    rationale:
      "When OpenAPI is enabled, generated client artifacts must match the canonical spec deterministically.",
    run: runGeneratedOpenApiCheck,
  },
  {
    id: "template-infrastructure-sync",
    title: "Template infrastructure sync",
    rationale:
      "Starter and reference applications duplicate Atlas template infrastructure deliberately; synced paths must stay aligned with the canonical starter unless documented as application-owned.",
    run: runTemplateInfrastructureSyncCheck,
  },
  {
    id: "upgrade-baseline",
    title: "Upgrade baseline",
    rationale:
      "Atlas records platform baseline metadata so future upgrades can distinguish unchanged template infrastructure from consumer modifications.",
    run: runUpgradeBaselineCheck,
  },
  {
    id: "atlas-version",
    title: "Atlas version",
    rationale:
      "The installed Atlas CLI snapshot should match the checkout version to avoid tooling/project drift during future migrations.",
    run: runAtlasVersionCheck,
  },
  {
    id: "manifest-alignment",
    title: "Atlas manifest alignment",
    rationale:
      "A recorded Atlas baseline must match the Atlas-owned package manifest fields shipped in that release. Consumer-owned dependency entries are ignored.",
    run: runManifestAlignmentCheck,
  },
];

export async function runDoctorChecks(context: DoctorContext): Promise<DoctorReport> {
  const checks: DoctorCheckResult[] = [];

  for (const check of DOCTOR_CHECKS) {
    try {
      checks.push(await check.run(context));
    } catch (error) {
      const reason = error instanceof Error ? error.message : undefined;
      const partialDiagnostics =
        error instanceof DoctorCheckExecutionError ? error.partialDiagnostics : [];
      checks.push({
        id: check.id,
        title: check.title,
        rationale: check.rationale,
        status: "fail",
        diagnostics: dedupeExecutionDiagnostics(
          createCheckExecutionFailedDiagnostic(check.id, reason),
          partialDiagnostics
        ),
      });
    }
  }

  const diagnostics = sortDiagnostics(flattenDiagnostics(checks));
  const summary = summarizeChecks(checks, diagnostics);

  return {
    schemaVersion: DOCTOR_REPORT_SCHEMA_VERSION,
    status: deriveReportStatus(summary, checks),
    atlasVersion: context.atlasVersion,
    projectRoot: ".",
    summary,
    checks,
    diagnostics,
  };
}

function flattenDiagnostics(checks: DoctorCheckResult[]): DoctorDiagnostic[] {
  const seen = new Set<string>();
  const flattened: DoctorDiagnostic[] = [];

  for (const check of checks) {
    for (const diagnostic of check.diagnostics) {
      const key = [
        diagnostic.code,
        diagnostic.path ?? "",
        diagnostic.line ?? "",
        diagnostic.column ?? "",
        diagnostic.message,
      ].join("|");

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      flattened.push(diagnostic);
    }
  }

  return flattened;
}

function summarizeChecks(
  checks: DoctorCheckResult[],
  diagnostics: DoctorDiagnostic[]
): DoctorReportSummary {
  return {
    checksPassed: checks.filter((check) => check.status === "pass").length,
    checksWarned: checks.filter((check) => check.status === "warn").length,
    checksFailed: checks.filter((check) => check.status === "fail").length,
    checksSkipped: checks.filter((check) => check.status === "skip").length,
    diagnosticWarnings: diagnostics.filter((diagnostic) => diagnostic.severity === "warning")
      .length,
    diagnosticErrors: diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
  };
}

function deriveReportStatus(
  summary: DoctorReportSummary,
  checks: DoctorCheckResult[]
): DoctorReportStatus {
  if (
    summary.checksFailed > 0 ||
    summary.diagnosticErrors > 0 ||
    checks.some((check) => check.status === "fail")
  ) {
    return "failed";
  }

  if (summary.checksWarned > 0 || summary.diagnosticWarnings > 0) {
    return "warning";
  }

  return "healthy";
}

export function doctorReportHasErrors(report: DoctorReport): boolean {
  return report.summary.checksFailed > 0 || report.summary.diagnosticErrors > 0;
}

function dedupeExecutionDiagnostics(
  executionDiagnostic: DoctorDiagnostic,
  partialDiagnostics: DoctorDiagnostic[]
): DoctorDiagnostic[] {
  const merged = [executionDiagnostic, ...partialDiagnostics];
  const seen = new Set<string>();

  return merged.filter((diagnostic) => {
    const key = [
      diagnostic.code,
      diagnostic.path ?? "",
      diagnostic.line ?? "",
      diagnostic.column ?? "",
      diagnostic.message,
    ].join("|");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
