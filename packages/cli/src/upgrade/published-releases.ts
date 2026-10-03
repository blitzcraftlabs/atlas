import { existsSync, readFileSync } from "node:fs";

import { CliError, CliErrorCode } from "../errors/cli-error";
import { CLI_PACKAGE_NAME } from "../version";

import { PUBLISHED_RELEASES_SCHEMA_VERSION } from "./release-constants";
import { isExactAtlasReleaseVersion } from "./version-compare";

export interface PublishedReleaseRecord {
  schemaVersion: typeof PUBLISHED_RELEASES_SCHEMA_VERSION;
  packageName: typeof CLI_PACKAGE_NAME;
  versions: string[];
}

export function parsePublishedReleaseRecord(
  raw: unknown,
  recordPath: string
): PublishedReleaseRecord {
  if (typeof raw !== "object" || raw === null) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Published release record at ${recordPath} must be a JSON object.`
    );
  }

  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== PUBLISHED_RELEASES_SCHEMA_VERSION) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Unsupported published release schemaVersion at ${recordPath}: ${String(record.schemaVersion)}.`
    );
  }

  if (record.packageName !== CLI_PACKAGE_NAME) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Published release record at ${recordPath} must describe ${CLI_PACKAGE_NAME}.`
    );
  }

  if (!Array.isArray(record.versions)) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Published release record at ${recordPath} requires versions to be an array.`
    );
  }

  const versions: string[] = [];
  for (const [index, entry] of record.versions.entries()) {
    if (typeof entry !== "string" || !isExactAtlasReleaseVersion(entry)) {
      throw new CliError(
        CliErrorCode.UPGRADE_PREREQUISITE,
        `Published release record at ${recordPath} versions[${index}] must be an exact X.Y.Z release.`
      );
    }
    if (versions.includes(entry)) {
      throw new CliError(
        CliErrorCode.UPGRADE_PREREQUISITE,
        `Published release record at ${recordPath} lists ${entry} more than once.`
      );
    }
    versions.push(entry);
  }

  return {
    schemaVersion: PUBLISHED_RELEASES_SCHEMA_VERSION,
    packageName: CLI_PACKAGE_NAME,
    versions,
  };
}

export function readPublishedReleaseRecord(recordPath: string): PublishedReleaseRecord {
  if (!existsSync(recordPath)) {
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Published release record is missing at ${recordPath}. Snapshot directories are not publication evidence.`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(recordPath, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new CliError(
      CliErrorCode.UPGRADE_PREREQUISITE,
      `Published release record at ${recordPath} contains invalid JSON: ${message}`
    );
  }

  return parsePublishedReleaseRecord(parsed, recordPath);
}
