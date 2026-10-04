import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { DoctorDiagnosticCode } from "../doctor/diagnostics";
import { loadInstalledManifestEvidence } from "../doctor/manifest-alignment";
import { writeManifestFieldValue } from "../upgrade/manifest-fields";
import { ExitCode } from "../exit-codes";
import { readCliAtlasVersion } from "../version";
import {
  createDoctorAtlasFixture,
  createMissingContractFixture,
  snapshotFixtureTree,
  writeCommentedImportFixture,
} from "./helpers/doctor-fixture";
import { getRepoRoot, runAtlasCli } from "./helpers/run-cli";

interface DoctorJsonResult {
  status: string;
  projectRoot: string;
  summary: {
    checksPassed: number;
    checksWarned: number;
    checksFailed: number;
    checksSkipped: number;
    diagnosticWarnings: number;
    diagnosticErrors: number;
  };
  checks: { id: string; status: string; skipReason?: string }[];
  diagnostics: { code: string; message?: string; path?: string }[];
}

function runDoctorJson(
  cwd: string,
  args: string[] = ["doctor", "--json"]
): {
  exitCode: number;
  result: DoctorJsonResult;
} {
  const cliArgs = args.includes("--cwd") ? args : [...args, "--cwd", cwd];
  const output = runAtlasCli(cliArgs, cwd);
  const payload = JSON.parse(output.stdout) as { ok: boolean; result: DoctorJsonResult };
  return { exitCode: output.exitCode ?? 1, result: payload.result };
}

describe("atlas doctor CLI", () => {
  const repoRoot = getRepoRoot();

  it("prints doctor in top-level help", () => {
    const result = runAtlasCli(["--help"], repoRoot);
    expect(result.exitCode).toBe(ExitCode.SUCCESS);
    expect(result.stdout).toContain("doctor");
  });

  it("passes on the healthy Atlas checkout", () => {
    const result = runAtlasCli(["doctor"], repoRoot);
    expect(result.exitCode).toBe(ExitCode.SUCCESS);
    expect(result.stdout).toContain("Atlas Doctor");
    expect(result.stdout).toContain("✓ Project contract");
    expect(result.stdout).toContain("✓ Template infrastructure sync");
    expect(result.stdout).toContain("Summary:");
  });

  it("emits deterministic JSON for a healthy checkout", () => {
    const first = runAtlasCli(["doctor", "--json"], repoRoot);
    const second = runAtlasCli(["doctor", "--json"], repoRoot);

    expect(first.exitCode).toBe(ExitCode.SUCCESS);
    expect(first.stderr).toBe("");

    const firstPayload = JSON.parse(first.stdout) as { ok: boolean; result: unknown };
    const secondPayload = JSON.parse(second.stdout) as { ok: boolean; result: unknown };

    expect(firstPayload.ok).toBe(true);
    expect(JSON.stringify(firstPayload.result)).toBe(JSON.stringify(secondPayload.result));
  });

  it("uses a stable projectRoot regardless of invocation cwd", () => {
    const fromRoot = runDoctorJson(repoRoot);
    const fromNested = runDoctorJson(path.join(repoRoot, "apps/web/src/features"));

    expect(fromRoot.result.projectRoot).toBe(".");
    expect(fromNested.result.projectRoot).toBe(".");
    expect(fromRoot.result.summary).toEqual(fromNested.result.summary);
    expect(fromRoot.result.checks.map((check) => check.id)).toEqual(
      fromNested.result.checks.map((check) => check.id)
    );
  });

  it("reports missing contract diagnostics without crashing", () => {
    const fixture = createMissingContractFixture();
    const { exitCode, result } = runDoctorJson(fixture.root);

    expect(exitCode).toBe(ExitCode.DOCTOR_FAILED);
    expect(result.status).toBe("failed");
    expect(result.diagnostics.some((d) => d.code === DoctorDiagnosticCode.CONTRACT_MISSING)).toBe(
      true
    );
  });

  it("reports invalid contract JSON", () => {
    const fixture = createDoctorAtlasFixture({ invalidContract: true });
    const { exitCode, result } = runDoctorJson(fixture.root);

    expect(exitCode).toBe(ExitCode.DOCTOR_FAILED);
    expect(result.diagnostics.some((d) => d.code === DoctorDiagnosticCode.CONTRACT_INVALID)).toBe(
      true
    );
  });

  it("reports unsupported contract schema versions", () => {
    const fixture = createDoctorAtlasFixture({ unsupportedContract: true });
    const { exitCode, result } = runDoctorJson(fixture.root);

    expect(exitCode).toBe(ExitCode.DOCTOR_FAILED);
    expect(
      result.diagnostics.some((d) => d.code === DoctorDiagnosticCode.CONTRACT_UNSUPPORTED)
    ).toBe(true);
  });

  it("does not mutate fixture files", () => {
    const fixture = createDoctorAtlasFixture({
      withViolation: "cross-feature-import",
      withApplicationTooling: true,
    });
    const before = snapshotFixtureTree(fixture.root);

    runAtlasCli(["doctor", "--cwd", fixture.root], fixture.root);

    expect(snapshotFixtureTree(fixture.root)).toEqual(before);
  });
});

describe("atlas doctor architecture diagnostics", () => {
  it("detects cross-feature imports in fixture workspaces", () => {
    const fixture = createDoctorAtlasFixture({
      withViolation: "cross-feature-import",
      withApplicationTooling: true,
    });
    const { exitCode, result } = runDoctorJson(fixture.root);

    expect(exitCode).toBe(ExitCode.DOCTOR_FAILED);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === DoctorDiagnosticCode.BOUNDARY_CROSS_FEATURE_IMPORT
      )
    ).toBe(true);
  });

  it("detects custom configured feature root cross-feature imports", () => {
    const fixture = createDoctorAtlasFixture({
      customProductFeaturesRoot: "apps/web/src/domains",
      withViolation: "custom-feature-root-cross-import",
      withApplicationTooling: true,
    });
    const { exitCode, result } = runDoctorJson(fixture.root);

    expect(exitCode).toBe(ExitCode.DOCTOR_FAILED);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === DoctorDiagnosticCode.BOUNDARY_CROSS_FEATURE_IMPORT
      )
    ).toBe(true);
  });

  it("detects raw fetch in custom configured feature roots", () => {
    const fixture = createDoctorAtlasFixture({
      customProductFeaturesRoot: "apps/web/src/domains",
      withViolation: "custom-feature-root-raw-fetch",
      withApplicationTooling: true,
    });
    const { exitCode, result } = runDoctorJson(fixture.root);
    const architectureCheck = result.checks.find((check) => check.id === "architecture-boundaries");

    expect(exitCode).toBe(ExitCode.DOCTOR_FAILED);
    expect(architectureCheck?.status).toBe("fail");
    expect(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === DoctorDiagnosticCode.BOUNDARY_RAW_NETWORK &&
          diagnostic.path?.includes("domains/billing/query.ts")
      )
    ).toBe(true);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === DoctorDiagnosticCode.DOCTOR_CHECK_EXECUTION_FAILED
      )
    ).toBe(false);
  });

  it("detects direct process.env in custom configured feature roots with TypeScript syntax", () => {
    const fixture = createDoctorAtlasFixture({
      customProductFeaturesRoot: "apps/web/src/domains",
      withViolation: "custom-feature-root-direct-env",
      withApplicationTooling: true,
    });
    const { exitCode, result } = runDoctorJson(fixture.root);

    expect(exitCode).toBe(ExitCode.DOCTOR_FAILED);
    expect(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === DoctorDiagnosticCode.BOUNDARY_DIRECT_ENV &&
          diagnostic.path?.includes("domains/billing/env.ts")
      )
    ).toBe(true);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === DoctorDiagnosticCode.DOCTOR_CHECK_EXECUTION_FAILED
      )
    ).toBe(false);
  });

  it("passes valid Atlas APIs in custom configured feature roots", () => {
    const fixture = createDoctorAtlasFixture({
      customProductFeaturesRoot: "apps/web/src/domains",
      withViolation: "custom-feature-root-allowed",
      withApplicationTooling: true,
      withEslintBoundaryFixtures: false,
    });
    const { exitCode, result } = runDoctorJson(fixture.root);
    const architectureCheck = result.checks.find((check) => check.id === "architecture-boundaries");

    expect(exitCode).toBe(ExitCode.SUCCESS);
    expect(architectureCheck?.status).toBe("pass");
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("ATLAS_BOUNDARY_"))
    ).toBe(false);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === DoctorDiagnosticCode.DOCTOR_CHECK_EXECUTION_FAILED
      )
    ).toBe(false);
  });

  it("fails when custom feature root source has a parser error", () => {
    const fixture = createDoctorAtlasFixture({
      customProductFeaturesRoot: "apps/web/src/domains",
      withViolation: "custom-feature-root-parser-failure",
      withApplicationTooling: true,
      withEslintBoundaryFixtures: false,
    });
    const { exitCode, result } = runDoctorJson(fixture.root);
    const architectureCheck = result.checks.find((check) => check.id === "architecture-boundaries");

    expect(exitCode).toBe(ExitCode.DOCTOR_FAILED);
    expect(result.status).toBe("failed");
    expect(architectureCheck?.status).toBe("fail");
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === DoctorDiagnosticCode.DOCTOR_CHECK_EXECUTION_FAILED
      )
    ).toBe(true);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("ATLAS_BOUNDARY_"))
    ).toBe(false);
  });

  it("ignores unrelated ESLint violations in custom configured feature roots", () => {
    const fixture = createDoctorAtlasFixture({
      customProductFeaturesRoot: "apps/web/src/domains",
      withViolation: "custom-feature-root-unrelated-lint",
      withApplicationTooling: true,
      withEslintBoundaryFixtures: false,
    });
    const { exitCode, result } = runDoctorJson(fixture.root);
    const architectureCheck = result.checks.find((check) => check.id === "architecture-boundaries");

    expect(exitCode).toBe(ExitCode.SUCCESS);
    expect(architectureCheck?.status).toBe("pass");
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.code.startsWith("ATLAS_BOUNDARY_"))
    ).toBe(false);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === DoctorDiagnosticCode.DOCTOR_CHECK_EXECUTION_FAILED
      )
    ).toBe(false);
  });

  it("detects reference imports in custom configured feature roots", () => {
    const fixture = createDoctorAtlasFixture({
      customProductFeaturesRoot: "apps/web/src/domains",
      withViolation: "custom-feature-root-reference-import",
      withApplicationTooling: true,
    });
    const { exitCode, result } = runDoctorJson(fixture.root);

    expect(exitCode).toBe(ExitCode.DOCTOR_FAILED);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === DoctorDiagnosticCode.BOUNDARY_REFERENCE_IMPORT
      )
    ).toBe(true);
  });

  it("fails explicitly for product feature roots outside application src", () => {
    const fixture = createDoctorAtlasFixture({
      externalProductFeaturesRoot: "packages/product-features",
      withApplicationTooling: true,
    });
    const { exitCode, result } = runDoctorJson(fixture.root);
    const architectureCheck = result.checks.find((check) => check.id === "architecture-boundaries");

    expect(exitCode).toBe(ExitCode.DOCTOR_FAILED);
    expect(architectureCheck?.status).toBe("fail");
    expect(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === DoctorDiagnosticCode.ARCHITECTURE_POLICY_UNSUPPORTED_ROOT
      )
    ).toBe(true);
  });

  it("fails when required ESLint config is missing", () => {
    const fixture = createDoctorAtlasFixture({
      withApplicationTooling: true,
      missingEslintConfig: true,
    });
    const { exitCode, result } = runDoctorJson(fixture.root);
    const architectureCheck = result.checks.find((check) => check.id === "architecture-boundaries");

    expect(exitCode).toBe(ExitCode.DOCTOR_FAILED);
    expect(architectureCheck?.status).toBe("fail");
    expect(
      result.diagnostics.some((d) => d.code === DoctorDiagnosticCode.ARCHITECTURE_POLICY_MISSING)
    ).toBe(true);
  });

  it("fails when ESLint execution breaks instead of passing", () => {
    const fixture = createDoctorAtlasFixture({
      withApplicationTooling: true,
      brokenEslintConfig: true,
    });
    const { exitCode, result } = runDoctorJson(fixture.root);
    const architectureCheck = result.checks.find((check) => check.id === "architecture-boundaries");

    expect(exitCode).toBe(ExitCode.DOCTOR_FAILED);
    expect(result.status).toBe("failed");
    expect(architectureCheck?.status).toBe("fail");
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === DoctorDiagnosticCode.DOCTOR_CHECK_EXECUTION_FAILED
      )
    ).toBe(true);
  });

  it("agrees with ESLint on allowed public API fixtures", () => {
    const fixture = createDoctorAtlasFixture({ withApplicationTooling: true });
    const allowedPath = path.join(
      fixture.root,
      "apps/web/src/components/eslint-boundaries/allowed-public-api.tsx"
    );
    expect(readFileSync(allowedPath, "utf8")).toContain("@atlas/ui");

    const { result } = runDoctorJson(fixture.root);

    expect(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code.startsWith("ATLAS_BOUNDARY_") &&
          diagnostic.message?.includes("allowed-public-api")
      )
    ).toBe(false);
  });
});

describe("atlas doctor dependency diagnostics", () => {
  it("detects undeclared application dependencies", () => {
    const fixture = createDoctorAtlasFixture({
      withViolation: "undeclared-dependency",
      withApplicationTooling: false,
    });
    const { exitCode, result } = runDoctorJson(fixture.root);

    expect(exitCode).toBe(ExitCode.DOCTOR_FAILED);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === DoctorDiagnosticCode.DEPENDENCY_UNDECLARED
      )
    ).toBe(true);
  });

  it("normalizes next/navigation imports to package next", () => {
    const fixture = createDoctorAtlasFixture({
      withViolation: "undeclared-next-navigation",
      withApplicationTooling: false,
    });
    const { result } = runDoctorJson(fixture.root);

    expect(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === DoctorDiagnosticCode.DEPENDENCY_UNDECLARED &&
          diagnostic.message?.includes('"next"')
      )
    ).toBe(true);
  });

  it("normalizes react/jsx-runtime imports to package react", () => {
    const fixture = createDoctorAtlasFixture({
      withViolation: "undeclared-react-jsx-runtime",
      withApplicationTooling: false,
    });
    const { result } = runDoctorJson(fixture.root);

    expect(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === DoctorDiagnosticCode.DEPENDENCY_UNDECLARED &&
          diagnostic.message?.includes('"react"')
      )
    ).toBe(true);
  });

  it("ignores commented-out and string-literal import lookalikes", () => {
    const fixture = createDoctorAtlasFixture({ withApplicationTooling: false });
    writeCommentedImportFixture(fixture.root);
    const { result } = runDoctorJson(fixture.root);

    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === DoctorDiagnosticCode.DEPENDENCY_UNDECLARED
      )
    ).toBe(false);
  });
});

describe("atlas doctor workspace diagnostics", () => {
  it("reports missing pnpm-workspace.yaml", () => {
    const fixture = createDoctorAtlasFixture({ missingWorkspaceConfig: true });
    const { exitCode, result } = runDoctorJson(fixture.root);

    expect(exitCode).toBe(ExitCode.DOCTOR_FAILED);
    expect(
      result.diagnostics.some((d) => d.code === DoctorDiagnosticCode.WORKSPACE_CONFIG_MISSING)
    ).toBe(true);
  });

  it("reports configured UI workspace missing from workspace globs", () => {
    const fixture = createDoctorAtlasFixture({ workspacePatterns: ['"apps/*"'] });
    const { exitCode, result } = runDoctorJson(fixture.root);

    expect(exitCode).toBe(ExitCode.DOCTOR_FAILED);
    expect(
      result.diagnostics.some((d) => d.code === DoctorDiagnosticCode.WORKSPACE_NOT_INCLUDED)
    ).toBe(true);
  });

  it("passes with explicit package roots", () => {
    const fixture = createDoctorAtlasFixture({
      workspacePatterns: ['"apps/web"', '"packages/ui"'],
    });
    const { result } = runDoctorJson(fixture.root);
    const workspaceCheck = result.checks.find((check) => check.id === "workspace-structure");

    expect(workspaceCheck?.status).toBe("pass");
  });
});

describe("atlas doctor OpenAPI diagnostics", () => {
  it("skips OpenAPI check when capability is disabled", () => {
    const fixture = createDoctorAtlasFixture({ withContract: true, openApi: false });
    const { result } = runDoctorJson(fixture.root);
    const openApiCheck = result.checks.find((check) => check.id === "generated-openapi");

    expect(openApiCheck?.status).toBe("skip");
    expect(openApiCheck?.skipReason).toContain("disabled");
  });

  it("passes when generated OpenAPI artifacts are current", () => {
    const fixture = createDoctorAtlasFixture({ openApi: true, withApplicationTooling: true });
    const { result } = runDoctorJson(fixture.root);
    const openApiCheck = result.checks.find((check) => check.id === "generated-openapi");

    expect(openApiCheck?.status).toBe("pass");
  });

  it("reports stale generated OpenAPI artifacts", () => {
    const fixture = createDoctorAtlasFixture({
      openApi: true,
      withApplicationTooling: true,
      withViolation: "stale-openapi",
    });
    const { exitCode, result } = runDoctorJson(fixture.root);

    expect(exitCode).toBe(ExitCode.DOCTOR_FAILED);
    expect(
      result.diagnostics.some((d) => d.code === DoctorDiagnosticCode.GENERATED_OPENAPI_STALE)
    ).toBe(true);
  });

  it("reports invalid OpenAPI generation instead of skipping", () => {
    const fixture = createDoctorAtlasFixture({
      openApi: true,
      withApplicationTooling: true,
      invalidOpenApiSpec: true,
    });
    const { exitCode, result } = runDoctorJson(fixture.root);
    const openApiCheck = result.checks.find((check) => check.id === "generated-openapi");

    expect(exitCode).toBe(ExitCode.DOCTOR_FAILED);
    expect(openApiCheck?.status).toBe("fail");
    expect(
      result.diagnostics.some((d) => d.code === DoctorDiagnosticCode.GENERATED_OPENAPI_INVALID)
    ).toBe(true);
  });

  it("skips when OpenAPI generator tooling is unavailable", () => {
    const fixture = createDoctorAtlasFixture({
      openApi: true,
      withApplicationTooling: true,
      withoutOpenApiGenerator: true,
      withEslintBoundaryFixtures: false,
    });
    const { exitCode, result } = runDoctorJson(fixture.root);
    const openApiCheck = result.checks.find((check) => check.id === "generated-openapi");

    expect(exitCode).toBe(ExitCode.SUCCESS);
    expect(openApiCheck?.status).toBe("skip");
    expect(result.summary.checksSkipped).toBeGreaterThan(0);
  });
});

describe("atlas doctor version diagnostics", () => {
  it("warns without failing when checkout version differs from CLI version", () => {
    const fixture = createDoctorAtlasFixture({
      checkoutVersion: "9.9.9",
      baselineAtlasVersion: "9.9.9",
      withApplicationTooling: true,
      withEslintBoundaryFixtures: false,
    });
    const { exitCode, result } = runDoctorJson(fixture.root);

    expect(exitCode).toBe(ExitCode.SUCCESS);
    expect(result.status).toBe("warning");
    expect(result.summary.diagnosticWarnings).toBeGreaterThanOrEqual(1);
    expect(result.summary.diagnosticErrors).toBe(0);
    expect(result.diagnostics.some((d) => d.code === DoctorDiagnosticCode.VERSION_MISMATCH)).toBe(
      true
    );
  });

  it("fails when root package metadata is invalid", () => {
    const fixture = createDoctorAtlasFixture({ invalidRootPackageJson: true });
    const { exitCode, result } = runDoctorJson(fixture.root);
    const versionCheck = result.checks.find((check) => check.id === "atlas-version");
    const workspaceCheck = result.checks.find((check) => check.id === "workspace-structure");
    const metadataDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === DoctorDiagnosticCode.ROOT_PACKAGE_METADATA_INVALID
    );

    expect(exitCode).toBe(ExitCode.DOCTOR_FAILED);
    expect(metadataDiagnostics).toHaveLength(1);
    expect(versionCheck?.status).toBe("fail");
    expect(workspaceCheck?.status).not.toBe("fail");
  });

  it("does not treat a generated app version as an Atlas mismatch when baseline matches the CLI", () => {
    const fixture = createDoctorAtlasFixture({
      checkoutVersion: "0.1.0",
      baselineAtlasVersion: readCliAtlasVersion(),
      withApplicationTooling: true,
      withEslintBoundaryFixtures: false,
    });
    const evidence = loadInstalledManifestEvidence(readCliAtlasVersion());
    for (const [relativePath, set] of Object.entries(evidence?.manifestFields ?? {})) {
      const absolutePath = path.join(fixture.root, relativePath);
      if (relativePath === "package.json") {
        continue;
      }
      try {
        const manifest = JSON.parse(readFileSync(absolutePath, "utf8")) as Record<string, unknown>;
        for (const field of set.owned) {
          writeManifestFieldValue(manifest, field, set.values[field]);
        }
        writeFileSync(absolutePath, `${JSON.stringify(manifest, null, 2)}\n`);
      } catch {
        // Fixture packages that are not part of this stub stay unchecked.
      }
    }
    const { exitCode, result } = runDoctorJson(fixture.root);
    const versionCheck = result.checks.find((check) => check.id === "atlas-version");

    expect(exitCode).toBe(ExitCode.SUCCESS);
    expect(versionCheck?.status).toBe("pass");
    expect(result.diagnostics.some((d) => d.code === DoctorDiagnosticCode.VERSION_MISMATCH)).toBe(
      false
    );
  });
});

describe("atlas doctor report semantics", () => {
  it("uses consistent summary counters", () => {
    const fixture = createDoctorAtlasFixture({
      withViolation: "undeclared-dependency",
      withApplicationTooling: false,
    });
    const { result } = runDoctorJson(fixture.root);

    expect(result.summary).toEqual(
      expect.objectContaining({
        checksPassed: expect.any(Number),
        checksWarned: expect.any(Number),
        checksFailed: expect.any(Number),
        checksSkipped: expect.any(Number),
        diagnosticWarnings: expect.any(Number),
        diagnosticErrors: expect.any(Number),
      })
    );
    expect(result.summary.diagnosticErrors).toBeGreaterThan(0);
    expect(result.status).toBe("failed");
  });

  it("never reports healthy when a required check failed", () => {
    const fixture = createDoctorAtlasFixture({
      withApplicationTooling: true,
      brokenEslintConfig: true,
    });
    const { result } = runDoctorJson(fixture.root);

    expect(result.checks.some((check) => check.status === "fail")).toBe(true);
    expect(result.status).toBe("failed");
  });
});
