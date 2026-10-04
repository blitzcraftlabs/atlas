import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { PUBLIC_CLI_RELATIVE_PATH } from "../atlas-workspaces.mjs";
import { loadPublishedCatalogVerifier } from "../../packages/cli/scripts/load-published-catalog-verifier.mjs";
import {
  assertPackedPublishedUpgradeCatalog,
  packExactPublicCliTarball,
} from "../lib/npm-publication.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliRoot = path.join(repoRoot, PUBLIC_CLI_RELATIVE_PATH);

describe("Version PR prospective release catalog state", () => {
  it(
    "matches npm-published predecessors while the workspace version is still unpublished",
    { timeout: 10 * 60 * 1000 },
    () => {
      const verifier = loadPublishedCatalogVerifier();
      const productionRoot = verifier.sourceProductionReleasesRoot(cliRoot);
      const snapshotVersions = verifier.listProductionSnapshotVersions(productionRoot);
      const workspaceVersion = JSON.parse(
        readFileSync(path.join(cliRoot, "package.json"), "utf8")
      ).version;
      const publishedRecord = JSON.parse(
        readFileSync(path.join(cliRoot, "release-assets", "published-releases.json"), "utf8")
      );

      assert.equal(publishedRecord.versions.includes("1.2.3"), false);
      assert.equal(publishedRecord.versions.includes("1.3.0"), false);

      const expected = verifier.selectSupportedReleaseWindow({
        currentVersion: workspaceVersion,
        snapshotVersions,
        publishedVersions: publishedRecord.versions,
      });
      const catalog = verifier.buildProductionReleaseCatalog({
        currentVersion: workspaceVersion,
        snapshotVersions,
        publishedVersions: publishedRecord.versions,
      });

      verifier.assertUpgradeCatalogMatchesPublishedIdentity({
        catalog,
        snapshotVersions,
        publishedVersions: publishedRecord.versions,
      });
      assert.deepEqual(catalog.supportedVersions, expected.supportedVersions);
      assert.deepEqual(catalog.recoverySources, expected.recoverySources);
      assert.equal(catalog.supportedVersions.includes("1.2.3"), false);
      assert.equal(catalog.supportedVersions.includes("1.3.0"), false);

      if (!publishedRecord.versions.includes(workspaceVersion)) {
        assert.equal(catalog.current, workspaceVersion);
        assert.equal(catalog.supportedVersions.at(-1), workspaceVersion);
      }

      const destinationDir = mkdtempSync(path.join(os.tmpdir(), "atlas-version-pr-pack-"));
      try {
        const packed = packExactPublicCliTarball({
          repoRoot,
          destinationDir,
          requireReleaseTag: false,
          publishedVersions: publishedRecord.versions,
        });
        assert.deepEqual(packed.catalog.supportedVersions, expected.supportedVersions);
        assertPackedPublishedUpgradeCatalog(
          cliRoot,
          packed.catalog,
          publishedRecord.versions
        );
      } finally {
        rmSync(destinationDir, { recursive: true, force: true });
      }
    }
  );

  it("keeps unpublished GitHub-only predecessors out of the support window", () => {
    const verifier = loadPublishedCatalogVerifier();
    const snapshots = ["1.2.2", "1.2.3", "1.2.4", "1.3.0", "1.3.1", "1.3.2"];
    const publishedVersions = ["1.2.2", "1.2.4", "1.3.1"];

    const window = verifier.selectSupportedReleaseWindow({
      currentVersion: "1.3.2",
      snapshotVersions: snapshots,
      publishedVersions,
    });

    assert.deepEqual(window.supportedVersions, ["1.3.1", "1.3.2"]);
    assert.deepEqual(window.recoverySources, []);
    assert.equal(window.supportedVersions.includes("1.3.0"), false);
    assert.equal(publishedVersions.includes("1.2.3"), false);
    assert.equal(publishedVersions.includes("1.3.0"), false);

    assert.throws(
      () =>
        verifier.assertUpgradeCatalogMatchesPublishedIdentity({
          catalog: { current: "1.3.2", supportedVersions: ["1.3.0", "1.3.2"] },
          snapshotVersions: snapshots,
          publishedVersions,
        }),
      /invalid upgrade catalog|no verified public release identity/
    );
  });

  it("still bridges stranded 1.2.2 consumers when npm has not advanced past 1.2.4", () => {
    const verifier = loadPublishedCatalogVerifier();
    const snapshots = ["1.2.2", "1.2.3", "1.2.4", "1.3.0", "1.3.1"];
    const publishedVersions = ["1.2.2", "1.2.4"];

    const window = verifier.selectSupportedReleaseWindow({
      currentVersion: "1.3.1",
      snapshotVersions: snapshots,
      publishedVersions,
    });

    assert.deepEqual(window.supportedVersions, ["1.2.2", "1.2.4", "1.3.1"]);
    assert.deepEqual(window.recoverySources, ["1.2.2"]);
    assert.equal(window.supportedVersions.includes("1.3.0"), false);
  });
});
