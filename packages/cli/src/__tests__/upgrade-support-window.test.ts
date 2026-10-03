import { readFileSync } from "node:fs";
import path from "node:path";

import {
  assertUpgradeCatalogMatchesPublishedIdentity,
  buildProductionReleaseCatalog,
  isRehearsalOnlyAtlasVersion,
  selectSupportedReleaseWindow,
} from "../upgrade/release-catalog";
import { readPublishedReleaseRecord } from "../upgrade/published-releases";
import {
  PUBLISHED_RELEASES_FILENAME,
  REHEARSAL_ONLY_ATLAS_VERSIONS,
} from "../upgrade/release-constants";
import { listProductionSnapshotVersions } from "../upgrade/release-assets";

const PACKAGE_ROOT = path.resolve(__dirname, "../..");

describe("production upgrade support window", () => {
  it("selects the current release plus the previous published release", () => {
    expect(
      selectSupportedReleaseWindow({
        currentVersion: "0.5.0",
        snapshotVersions: ["0.4.0", "0.5.0", "0.3.0"],
        publishedVersions: ["0.4.0", "0.5.0", "0.3.0"],
      }).supportedVersions
    ).toEqual(["0.4.0", "0.5.0"]);
    expect(
      selectSupportedReleaseWindow({
        currentVersion: "1.0.0",
        snapshotVersions: ["0.4.0", "0.5.0", "1.0.0"],
        publishedVersions: ["0.4.0", "0.5.0", "1.0.0"],
      }).supportedVersions
    ).toEqual(["0.5.0", "1.0.0"]);
  });

  it("never treats rehearsal 0.1.0/0.2.0 as production support", () => {
    expect(REHEARSAL_ONLY_ATLAS_VERSIONS).toEqual(["0.1.0", "0.2.0"]);
    expect(isRehearsalOnlyAtlasVersion("0.1.0")).toBe(true);
    expect(isRehearsalOnlyAtlasVersion("0.2.0")).toBe(true);
    expect(isRehearsalOnlyAtlasVersion("0.4.0")).toBe(false);

    const catalog = buildProductionReleaseCatalog({
      currentVersion: "0.4.0",
      snapshotVersions: ["0.1.0", "0.2.0", "0.4.0"],
      publishedVersions: ["0.4.0"],
    });
    expect(catalog.supportedVersions).toEqual(["0.4.0"]);
    expect(catalog.rehearsalOnlyVersions).toEqual(["0.1.0", "0.2.0"]);
  });

  it("packages only the committed production snapshots in the support window", () => {
    const available = listProductionSnapshotVersions(
      path.join(PACKAGE_ROOT, "release-assets", "production")
    );
    expect(available).toContain("0.4.0");
    expect(available).not.toContain("0.1.0");
    expect(available).not.toContain("0.2.0");

    const published = readPublishedReleaseRecord(
      path.join(PACKAGE_ROOT, "release-assets", PUBLISHED_RELEASES_FILENAME)
    );
    expect(published.versions).not.toContain("1.2.3");
    expect(published.versions).toContain("1.2.2");
    expect(published.versions).toContain("1.2.4");

    const currentVersion = (
      JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as {
        version: string;
      }
    ).version;
    const supported = selectSupportedReleaseWindow({
      currentVersion,
      snapshotVersions: available,
      publishedVersions: published.versions,
    });
    expect(supported.supportedVersions.at(-1)).toBe(currentVersion);
    expect(supported.supportedVersions).toEqual(
      currentVersion === "1.2.4" ? ["1.2.2", "1.2.4"] : expect.any(Array)
    );
    expect(supported.supportedVersions).not.toContain("1.2.3");
    expect(
      supported.supportedVersions.every((version) => !isRehearsalOnlyAtlasVersion(version))
    ).toBe(true);
  });

  it("keeps the canonical 0.4.0 snapshot as a v0.4.0 baseline, not a current-main rewrite", () => {
    const snapshot = JSON.parse(
      readFileSync(
        path.join(PACKAGE_ROOT, "release-assets", "production", "0.4.0", "release.snapshot.json"),
        "utf8"
      )
    ) as {
      atlasVersion: string;
      packageVersions: Record<string, string>;
    };
    expect(snapshot.atlasVersion).toBe("0.4.0");
    expect(snapshot.packageVersions["@atlas/cli"]).toBe("0.4.0");
    expect(snapshot.packageVersions["@blitzcraftlabs/atlas"]).toBeUndefined();
  });

  it("ignores the unpublished 1.2.3 snapshot when selecting 1.2.4 support", () => {
    const window = selectSupportedReleaseWindow({
      currentVersion: "1.2.4",
      snapshotVersions: ["1.2.2", "1.2.3", "1.2.4"],
      publishedVersions: ["1.2.2", "1.2.4"],
    });

    expect(window.supportedVersions).toEqual(["1.2.2", "1.2.4"]);
    expect(window.supportedVersions).not.toContain("1.2.3");
    expect(window.recoverySources).toEqual([]);
  });

  it("bridges stranded 1.2.2 consumers on the first packaged release after the faulty 1.2.4 catalog", () => {
    const window = selectSupportedReleaseWindow({
      currentVersion: "1.3.0",
      snapshotVersions: ["1.2.2", "1.2.3", "1.2.4", "1.3.0"],
      publishedVersions: ["1.2.2", "1.2.4"],
    });

    expect(window.supportedVersions).toEqual(["1.2.2", "1.2.4", "1.3.0"]);
    expect(window.recoverySources).toEqual(["1.2.2"]);
    expect(window.supportedVersions).not.toContain("1.2.3");
  });

  it("does not keep the 1.2.2 recovery bridge after a later published release", () => {
    const window = selectSupportedReleaseWindow({
      currentVersion: "1.3.1",
      snapshotVersions: ["1.2.2", "1.2.3", "1.2.4", "1.3.0", "1.3.1"],
      publishedVersions: ["1.2.2", "1.2.4", "1.3.0"],
    });

    expect(window.supportedVersions).toEqual(["1.3.0", "1.3.1"]);
    expect(window.recoverySources).toEqual([]);
  });

  it("refuses a catalog that advertises the unpublished 1.2.3 snapshot", () => {
    expect(() =>
      assertUpgradeCatalogMatchesPublishedIdentity({
        catalog: {
          current: "1.2.4",
          supportedVersions: ["1.2.3", "1.2.4"],
        },
        snapshotVersions: ["1.2.2", "1.2.3", "1.2.4"],
        publishedVersions: ["1.2.2", "1.2.4"],
      })
    ).toThrow(/invalid upgrade catalog|no verified public release identity/);
  });
});
