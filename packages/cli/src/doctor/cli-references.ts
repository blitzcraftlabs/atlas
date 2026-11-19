import { findLegacyCliPins, readConsumerCliPin } from "../upgrade/legacy-cli-pins";
import { CLI_PACKAGE_NAME } from "../version";

import { createDiagnostic, DoctorDiagnosticCode } from "./diagnostics";

import type { DoctorContext } from "./context";
import type { DoctorCheckResult, DoctorDiagnostic } from "./types";

export const CLI_REFERENCES_CHECK = {
  id: "cli-references",
  title: "Consumer CLI references",
  rationale:
    "Consumer-owned CI workflows and docs that pin an older Atlas CLI keep running it after an upgrade; once the contract changes, that CLI cannot parse atlas.config.json.",
} as const;

/**
 * Flags `pnpm dlx @blitzcraftlabs/atlas@<version>` invocations in consumer-owned CI workflows,
 * README.md, AGENTS.md and docs/how-we-build/*.md whose version differs from the project's pinned
 * CLI. A workflow pinning a CLI older than the project fails the check: CI would run a CLI that
 * predates the project's contract. Everything else is a warning.
 */
export function runCliReferencesCheck(context: DoctorContext): DoctorCheckResult {
  const pinnedCli = readConsumerCliPin(context.repoRoot);
  const baselineVersion = context.rawContract?.platform?.baseline?.atlasVersion;
  const expectedVersion =
    pinnedCli ??
    (typeof baselineVersion === "string" ? baselineVersion : undefined) ??
    context.checkoutAtlasVersion;

  if (!expectedVersion) {
    return {
      ...CLI_REFERENCES_CHECK,
      status: "skip",
      diagnostics: [],
      skipReason: "Unable to determine the project's Atlas version.",
    };
  }

  const replacement = pinnedCli
    ? "Replace it with `pnpm atlas <command>` so it runs the CLI pinned in package.json."
    : `Run \`atlas upgrade\` (it pins ${CLI_PACKAGE_NAME} as a devDependency and adds \`pnpm atlas\`), then replace it with \`pnpm atlas <command>\`.`;

  const diagnostics: DoctorDiagnostic[] = findLegacyCliPins({
    repoRoot: context.repoRoot,
    expectedVersion,
  }).map((pin) => {
    const blocking = pin.scope === "workflow" && pin.olderThanExpected;
    const invocation = `${CLI_PACKAGE_NAME}@${pin.version}${pin.command ? ` ${pin.command}` : ""}`;
    return createDiagnostic(
      blocking ? DoctorDiagnosticCode.LEGACY_CLI_PIN_WORKFLOW : DoctorDiagnosticCode.LEGACY_CLI_PIN,
      blocking
        ? `CI runs ${invocation}, older than this project's Atlas ${expectedVersion}. That CLI may not parse atlas.config.json.`
        : `Runs ${invocation}, but this project uses Atlas ${expectedVersion}.`,
      {
        path: pin.relativePath,
        line: pin.line,
        column: pin.column,
        suggestedFix: replacement,
      }
    );
  });

  let status: DoctorCheckResult["status"] = "pass";
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    status = "fail";
  } else if (diagnostics.length > 0) {
    status = "warn";
  }

  return { ...CLI_REFERENCES_CHECK, status, diagnostics };
}
