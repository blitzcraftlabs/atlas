import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { CLI_PACKAGE_NAME, readCliAtlasVersion } from "../version";
import { CliErrorCode } from "../errors/cli-error";
import {
  assertPackagedReleaseSupported,
  findReleaseAssetRoot,
  packagedReleaseAssetRoot,
  readPackagedReleaseCatalog,
} from "../upgrade/release-assets";
import { loadReleaseSnapshot } from "../upgrade/release-snapshot";
import { runUpgrade } from "../upgrade/run";
import { parseCliArgs } from "../parse-args";

const PACKAGE_ROOT = path.resolve(__dirname, "../..");
const FIXTURE_RELEASES = path.resolve(__dirname, "fixtures/upgrade-e2e/releases");

function writeConsumerContract(root: string, atlasVersion: string): void {
  writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "consumer", version: "0.1.0" }, null, 2)}\n`
  );
  writeFileSync(
    path.join(root, "atlas.config.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        platform: {
          baseline: {
            atlasVersion,
            contractSchemaVersion: 1,
            templateManifestSchemaVersion: 1,
            syncedPathChecksums: {},
          },
        },
      },
      null,
      2
    )}\n`
  );
}

describe("packaged production release resolution", () => {
  it("resolves the packaged release root from the CLI package, not cwd or a consumer releases tree", () => {
    const previousCwd = process.cwd();
    const decoy = mkdtempSync(path.join(os.tmpdir(), "atlas-release-decoy-"));

    try {
      mkdirSync(path.join(decoy, "releases", "9.9.9"), { recursive: true });
      writeFileSync(
        path.join(decoy, "releases", "9.9.9", "release.snapshot.json"),
        `${JSON.stringify({ atlasVersion: "9.9.9" }, null, 2)}\n`
      );
      writeFileSync(
        path.join(decoy, "package.json"),
        `${JSON.stringify({ name: "consumer", version: "0.0.0" }, null, 2)}\n`
      );
      process.chdir(decoy);

      const assetRoot = findReleaseAssetRoot(path.join(PACKAGE_ROOT, "dist"));
      expect(assetRoot).toBe(packagedReleaseAssetRoot(PACKAGE_ROOT));
      expect(assetRoot.startsWith(decoy)).toBe(false);
      expect(assetRoot.includes(`${path.sep}releases${path.sep}9.9.9`)).toBe(false);

      const catalog = readPackagedReleaseCatalog(assetRoot);
      expect(catalog.policy).toBe("adjacent-published-releases");
      expect(catalog.supportedVersions).toContain(catalog.current);
      expect(catalog.supportedVersions).not.toContain("0.1.0");
      expect(catalog.supportedVersions).not.toContain("0.2.0");
      expect(catalog.rehearsalOnlyVersions).toEqual(["0.1.0", "0.2.0"]);
    } finally {
      process.chdir(previousCwd);
      rmSync(decoy, { recursive: true, force: true });
    }
  });

  it("fails closed when packaged catalog evidence is missing", () => {
    const installed = mkdtempSync(path.join(os.tmpdir(), "atlas-release-missing-"));
    writeFileSync(
      path.join(installed, "package.json"),
      `${JSON.stringify({ name: CLI_PACKAGE_NAME, version: "9.9.9" }, null, 2)}\n`
    );
    mkdirSync(path.join(installed, "dist"), { recursive: true });

    expect(() => findReleaseAssetRoot(path.join(installed, "dist"))).toThrow(
      expect.objectContaining({
        code: CliErrorCode.UPGRADE_PREREQUISITE,
        message: expect.stringContaining("does not load consumer repository releases/"),
      })
    );

    rmSync(installed, { recursive: true, force: true });
  });

  it("fails closed on a corrupt packaged snapshot", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-release-corrupt-"));
    const releasesDir = path.join(tempRoot, "releases");
    mkdirSync(path.join(releasesDir, "0.9.9"), { recursive: true });
    writeFileSync(path.join(releasesDir, "0.9.9", "release.snapshot.json"), "{not-json");

    expect(() =>
      loadReleaseSnapshot({
        atlasVersion: "0.9.9",
        releasesDir,
      })
    ).toThrow(
      expect.objectContaining({
        code: CliErrorCode.UPGRADE_PREREQUISITE,
        message: expect.stringContaining("invalid JSON"),
      })
    );

    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("does not use a consumer releases/ tree as the default upgrade root", async () => {
    const consumer = mkdtempSync(path.join(os.tmpdir(), "atlas-consumer-releases-"));
    writeConsumerContract(consumer, "0.1.0");
    mkdirSync(path.join(consumer, "releases", "0.1.0"), { recursive: true });
    writeFileSync(
      path.join(consumer, "releases", "0.1.0", "release.snapshot.json"),
      `${JSON.stringify({ schemaVersion: 1, atlasVersion: "0.1.0" }, null, 2)}\n`
    );

    await expect(
      runUpgrade({
        repoRoot: consumer,
        targetVersion: "0.2.0",
        dryRun: true,
      })
    ).rejects.toThrow(/Unsupported source Atlas release 0\.1\.0/);

    rmSync(consumer, { recursive: true, force: true });
  });

  it("keeps --releases-dir as an explicit fixture override", () => {
    const parsed = parseCliArgs(["upgrade", "--to", "0.2.0", "--releases-dir", FIXTURE_RELEASES]);
    expect(parsed.releasesDir).toBe(FIXTURE_RELEASES);

    const loaded = loadReleaseSnapshot({
      atlasVersion: "0.2.0",
      releasesDir: FIXTURE_RELEASES,
    });
    expect(loaded.manifest.atlasVersion).toBe("0.2.0");
    expect(loaded.releaseRoot.startsWith(FIXTURE_RELEASES)).toBe(true);
  });

  it("fails closed for unsupported source and target versions", async () => {
    const catalog = readPackagedReleaseCatalog();
    expect(() =>
      assertPackagedReleaseSupported({
        sourceVersion: "0.1.0",
        targetVersion: catalog.current,
        catalog,
      })
    ).toThrow(/Unsupported source Atlas release 0\.1\.0/);
    expect(() =>
      assertPackagedReleaseSupported({
        sourceVersion: catalog.current,
        targetVersion: "9.9.9",
        catalog,
      })
    ).toThrow(/Unsupported target Atlas release 9\.9\.9/);

    const consumer = mkdtempSync(path.join(os.tmpdir(), "atlas-unsupported-target-"));
    writeConsumerContract(consumer, readCliAtlasVersion());
    await expect(
      runUpgrade({
        repoRoot: consumer,
        targetVersion: "9.9.9",
        dryRun: true,
      })
    ).rejects.toThrow(/Unsupported target Atlas release 9\.9\.9/);
    rmSync(consumer, { recursive: true, force: true });
  });
});
