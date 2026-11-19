import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { CliError, CliErrorCode } from "../errors/cli-error";
import {
  buildPackagedReleaseAssets,
  publishedReleaseRecordPath,
} from "../upgrade/build-release-assets";
import {
  PUBLISHED_RELEASES_SCHEMA_VERSION,
  RELEASE_CATALOG_FILENAME,
  RELEASE_SNAPSHOT_FILENAME,
  SOURCE_PRODUCTION_RELEASES_RELATIVE_PATH,
} from "../upgrade/release-constants";
import { CLI_PACKAGE_NAME } from "../version";

/** Minimal CLI package checkout: package.json, committed production snapshots, publication record. */
function writeCliPackage(
  packageRoot: string,
  options: { version?: string; snapshots: string[]; published?: string[] }
): void {
  writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify(
      options.version === undefined
        ? { name: CLI_PACKAGE_NAME }
        : { name: CLI_PACKAGE_NAME, version: options.version }
    )
  );
  const productionRoot = path.join(packageRoot, SOURCE_PRODUCTION_RELEASES_RELATIVE_PATH);
  for (const version of options.snapshots) {
    mkdirSync(path.join(productionRoot, version), { recursive: true });
    writeFileSync(
      path.join(productionRoot, version, RELEASE_SNAPSHOT_FILENAME),
      JSON.stringify({ atlasVersion: version })
    );
  }
  if (options.published) {
    mkdirSync(path.dirname(publishedReleaseRecordPath(packageRoot)), { recursive: true });
    writeFileSync(
      publishedReleaseRecordPath(packageRoot),
      JSON.stringify({
        schemaVersion: PUBLISHED_RELEASES_SCHEMA_VERSION,
        packageName: CLI_PACKAGE_NAME,
        versions: options.published,
      })
    );
  }
}

function readCatalog(outputDir: string): { current: string; supportedVersions: string[] } {
  return JSON.parse(readFileSync(path.join(outputDir, RELEASE_CATALOG_FILENAME), "utf8")) as {
    current: string;
    supportedVersions: string[];
  };
}

function captureCliError(fn: () => unknown): CliError {
  try {
    fn();
  } catch (error) {
    if (error instanceof CliError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected a CliError");
}

describe("buildPackagedReleaseAssets", () => {
  let packageRoot: string;
  let outputDir: string;
  beforeEach(() => {
    packageRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-release-assets-"));
    outputDir = path.join(packageRoot, "assets", "releases");
  });
  afterEach(() => rmSync(packageRoot, { recursive: true, force: true }));

  it("packages the current release and the previous npm-published release only", () => {
    writeCliPackage(packageRoot, {
      version: "1.4.0",
      snapshots: ["1.2.0", "1.3.0", "1.4.0"],
      published: ["1.2.0", "1.3.0"],
    });

    const written = buildPackagedReleaseAssets({ packageRoot, outputDir });

    expect(written).toBe(outputDir);
    const catalog = readCatalog(outputDir);
    expect(catalog.current).toBe("1.4.0");
    expect([...catalog.supportedVersions].sort()).toEqual(["1.3.0", "1.4.0"]);
    expect(existsSync(path.join(outputDir, "1.3.0", RELEASE_SNAPSHOT_FILENAME))).toBe(true);
    expect(existsSync(path.join(outputDir, "1.4.0", RELEASE_SNAPSHOT_FILENAME))).toBe(true);
    expect(existsSync(path.join(outputDir, "1.2.0"))).toBe(false);
  });

  it("never offers an unpublished snapshot as the upgrade source (the 1.2.3 incident shape)", () => {
    writeCliPackage(packageRoot, {
      version: "1.4.0",
      snapshots: ["1.3.0", "1.3.5", "1.4.0"],
      published: ["1.3.0"],
    });

    buildPackagedReleaseAssets({ packageRoot, outputDir });

    const catalog = readCatalog(outputDir);
    expect(catalog.supportedVersions).not.toContain("1.3.5");
    expect(catalog.supportedVersions).toContain("1.3.0");
    expect(existsSync(path.join(outputDir, "1.3.5"))).toBe(false);
  });

  it("uses explicit publishedVersions instead of the on-disk record", () => {
    writeCliPackage(packageRoot, {
      version: "1.4.0",
      snapshots: ["1.3.0", "1.4.0"],
      published: ["1.0.0"],
    });

    buildPackagedReleaseAssets({ packageRoot, outputDir, publishedVersions: ["1.3.0"] });

    expect([...readCatalog(outputDir).supportedVersions].sort()).toEqual(["1.3.0", "1.4.0"]);
  });

  it("replaces stale packaged assets from a previous build", () => {
    writeCliPackage(packageRoot, {
      version: "1.4.0",
      snapshots: ["1.3.0", "1.4.0"],
      published: ["1.3.0"],
    });
    mkdirSync(path.join(outputDir, "0.9.0"), { recursive: true });
    writeFileSync(path.join(outputDir, "0.9.0", RELEASE_SNAPSHOT_FILENAME), "{}");

    buildPackagedReleaseAssets({ packageRoot, outputDir });

    expect(existsSync(path.join(outputDir, "0.9.0"))).toBe(false);
  });

  it("refuses to build when the current version has no committed snapshot", () => {
    writeCliPackage(packageRoot, {
      version: "1.4.0",
      snapshots: ["1.3.0"],
      published: ["1.3.0"],
    });

    const error = captureCliError(() => buildPackagedReleaseAssets({ packageRoot, outputDir }));

    expect(error.code).toBe(CliErrorCode.UPGRADE_PREREQUISITE);
    expect(error.message).toMatch(/no production snapshot exists/);
    expect(existsSync(outputDir)).toBe(false);
  });

  it("refuses to build without publication evidence", () => {
    writeCliPackage(packageRoot, { version: "1.4.0", snapshots: ["1.3.0", "1.4.0"] });

    const error = captureCliError(() => buildPackagedReleaseAssets({ packageRoot, outputDir }));

    expect(error.message).toMatch(/Published release record is missing/);
  });

  it("refuses a package.json without a version, or no package.json at all", () => {
    writeCliPackage(packageRoot, { snapshots: ["1.4.0"], published: [] });
    expect(
      captureCliError(() => buildPackagedReleaseAssets({ packageRoot, outputDir })).message
    ).toMatch(/Missing version/);

    rmSync(path.join(packageRoot, "package.json"));
    expect(
      captureCliError(() => buildPackagedReleaseAssets({ packageRoot, outputDir })).message
    ).toMatch(/Missing package\.json/);
  });
});
