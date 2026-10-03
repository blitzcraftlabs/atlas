import { BootstrapAssetError } from "./errors";

/** Canonical source of the generated-project GitHub Actions workflow. */
export const CONSUMER_CI_WORKFLOW_SOURCE = "packages/cli/bootstrap/github-workflows/ci.yml";

/** Destination inside packaged bootstrap assets and generated projects. */
export const CONSUMER_CI_WORKFLOW_DESTINATION = ".github/workflows/ci.yml";

/** Replaced with the packaged CLI version when bootstrap assets are built. */
export const CONSUMER_CI_ATLAS_VERSION_PLACEHOLDER = "{{ATLAS_CLI_VERSION}}";

export function toConsumerCiWorkflow(source: string, atlasVersion: string): string {
  if (typeof atlasVersion !== "string" || atlasVersion.trim().length === 0) {
    throw new BootstrapAssetError("Consumer CI workflow requires a non-empty Atlas CLI version.");
  }
  if (source.includes("pnpm dlx @blitzcraftlabs/atlas@")) {
    throw new BootstrapAssetError(
      "Consumer CI must use the pinned local CLI (`pnpm atlas`), not a versioned pnpm dlx invocation."
    );
  }
  if (!source.includes(CONSUMER_CI_ATLAS_VERSION_PLACEHOLDER)) {
    return source;
  }

  const rendered = source.replaceAll(CONSUMER_CI_ATLAS_VERSION_PLACEHOLDER, atlasVersion);
  if (rendered.includes(CONSUMER_CI_ATLAS_VERSION_PLACEHOLDER)) {
    throw new BootstrapAssetError(
      "Consumer CI workflow still contains an Atlas version placeholder."
    );
  }

  return rendered;
}
