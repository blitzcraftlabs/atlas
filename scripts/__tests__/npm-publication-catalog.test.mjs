import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { PUBLIC_CLI_RELATIVE_PATH } from "../atlas-workspaces.mjs";
import {
  assertPackedPublishedUpgradeCatalog,
  packExactPublicCliTarball,
} from "../lib/npm-publication.mjs";

// Mutates shared `packages/cli/dist` by deleting it and rebuilding through the
// publication pack path. scripts/lib/script-test-schedule.mjs runs this file
// after the parallel batch.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliRoot = path.join(repoRoot, PUBLIC_CLI_RELATIVE_PATH);
const distDir = path.join(cliRoot, "dist");
const bundleCliPath = path.join(cliRoot, "scripts", "bundle-cli.mjs");

function bundledCliJavaScriptEntries() {
  const source = readFileSync(bundleCliPath, "utf8");
  return [...source.matchAll(/outfile:\s*path\.join\(distDir,\s*"([^"]+\.js)"\)/g)]
    .map((match) => match[1])
    .sort();
}

describe("npm publication catalog verification", () => {
  it(
    "packs and validates from a checkout with no pre-existing CLI dist",
    { timeout: 10 * 60 * 1000 },
    () => {
      const destinationDir = mkdtempSync(path.join(os.tmpdir(), "atlas-npm-publication-"));
      try {
        rmSync(distDir, { recursive: true, force: true });
        assert.equal(existsSync(path.join(distDir, "upgrade", "release-assets.js")), false);
        assert.equal(existsSync(path.join(distDir, "upgrade", "release-catalog.js")), false);

        const publishedRecord = JSON.parse(
          readFileSync(path.join(cliRoot, "release-assets", "published-releases.json"), "utf8")
        );
        assert.equal(publishedRecord.versions.includes("1.2.3"), false);
        assert.equal(publishedRecord.versions.includes("1.3.0"), false);

        const packed = packExactPublicCliTarball({
          repoRoot,
          destinationDir,
          requireReleaseTag: false,
        });

        const contractEntries = bundledCliJavaScriptEntries();
        const emittedEntries = readdirSync(distDir)
          .filter((name) => name.endsWith(".js"))
          .sort();
        assert.deepEqual(emittedEntries, contractEntries);
        assert.equal(existsSync(path.join(distDir, "upgrade", "release-assets.js")), false);
        assert.equal(existsSync(path.join(distDir, "upgrade", "release-catalog.js")), false);
        assert.equal(
          packed.entries.some((entry) => entry.includes("/dist/upgrade/")),
          false
        );

        assert.equal(packed.catalog.current, packed.identity.version);
        assert.equal(packed.catalog.supportedVersions.includes("1.2.3"), false);
        assert.equal(packed.catalog.supportedVersions.includes("1.2.2"), true);
        assert.equal(packed.catalog.supportedVersions.includes("1.2.4"), true);
        if (packed.identity.version === "1.3.0") {
          assert.deepEqual(packed.catalog.supportedVersions, ["1.2.2", "1.2.4", "1.3.0"]);
          assert.deepEqual(packed.catalog.recoverySources, ["1.2.2"]);
        }

        const tampered = {
          ...packed.catalog,
          supportedVersions: [
            "1.2.3",
            ...packed.catalog.supportedVersions.filter((version) => version !== "1.2.2"),
          ],
        };
        assert.throws(
          () => assertPackedPublishedUpgradeCatalog(cliRoot, tampered, publishedRecord.versions),
          /invalid upgrade catalog|1\.2\.3|no verified public release identity/
        );
      } finally {
        rmSync(destinationDir, { recursive: true, force: true });
      }
    }
  );
});
