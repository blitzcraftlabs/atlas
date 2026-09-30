import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { LATEST_SCHEMA_VERSION } from "@atlas/project";

import {
  CLI_PACKAGE_NAME,
  findCliPackageRoot,
  readCheckoutAtlasVersion,
  readCliAtlasVersion,
  readCliVersionMetadata,
} from "../version";

const CLI_PACKAGE_ROOT = path.resolve(__dirname, "../..");
const CLI_PACKAGE_VERSION = (
  JSON.parse(readFileSync(path.join(CLI_PACKAGE_ROOT, "package.json"), "utf8")) as {
    version: string;
  }
).version;

const SYNTHETIC_CHECKOUT_VERSION = CLI_PACKAGE_VERSION === "9.9.9" ? "8.8.8" : "9.9.9";

describe("CLI package version resolution", () => {
  it("reads the installed CLI version from the @blitzcraftlabs/atlas package, not the process cwd", () => {
    expect(readCliAtlasVersion()).toBe(CLI_PACKAGE_VERSION);
    expect(findCliPackageRoot(__dirname)).toBe(CLI_PACKAGE_ROOT);
    expect(findCliPackageRoot(path.join(CLI_PACKAGE_ROOT, "dist"))).toBe(CLI_PACKAGE_ROOT);
  });

  it("does not treat an unrelated package.json as the CLI package", () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), "atlas-cli-version-unrelated-"));
    writeFileSync(
      path.join(outside, "package.json"),
      `${JSON.stringify({ name: "some-other-project", version: "99.0.0" }, null, 2)}\n`,
      "utf8"
    );

    expect(readCliAtlasVersion()).toBe(CLI_PACKAGE_VERSION);
    expect(readCliAtlasVersion()).not.toBe("99.0.0");
    expect(() => findCliPackageRoot(outside)).toThrow(
      `Unable to locate ${CLI_PACKAGE_NAME} package.json`
    );
    rmSync(outside, { recursive: true, force: true });
  });

  it("finds the CLI package from a nested dist layout used by the packed artifact", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "atlas-cli-version-layout-"));
    writeFileSync(
      path.join(root, "package.json"),
      `${JSON.stringify({ name: CLI_PACKAGE_NAME, version: "9.9.9" }, null, 2)}\n`,
      "utf8"
    );
    const nested = path.join(root, "dist", "nested");
    mkdirSync(nested, { recursive: true });

    expect(findCliPackageRoot(nested)).toBe(root);
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps checkout Atlas version separate from the installed CLI version", () => {
    const checkout = mkdtempSync(path.join(os.tmpdir(), "atlas-cli-checkout-version-"));
    writeFileSync(
      path.join(checkout, "package.json"),
      `${JSON.stringify(
        { name: "@atlas/monorepo", version: SYNTHETIC_CHECKOUT_VERSION },
        null,
        2
      )}\n`,
      "utf8"
    );

    expect(readCheckoutAtlasVersion(checkout)).toBe(SYNTHETIC_CHECKOUT_VERSION);
    expect(readCliAtlasVersion()).toBe(CLI_PACKAGE_VERSION);
    expect(readCliAtlasVersion()).not.toBe(SYNTHETIC_CHECKOUT_VERSION);
    rmSync(checkout, { recursive: true, force: true });
  });

  it("falls back to root package.json when a generated project has no baseline", () => {
    const checkout = mkdtempSync(path.join(os.tmpdir(), "atlas-cli-legacy-version-"));
    writeFileSync(
      path.join(checkout, "package.json"),
      `${JSON.stringify({ name: "legacy-app", version: "0.1.0" }, null, 2)}\n`,
      "utf8"
    );
    writeFileSync(
      path.join(checkout, "atlas.config.json"),
      `${JSON.stringify({ schemaVersion: 1 }, null, 2)}\n`,
      "utf8"
    );

    expect(readCheckoutAtlasVersion(checkout)).toBe("0.1.0");
    rmSync(checkout, { recursive: true, force: true });
  });

  it("resolves generated-project Atlas version from platform.baseline, not app package.json", () => {
    const checkout = mkdtempSync(path.join(os.tmpdir(), "atlas-cli-generated-version-"));
    writeFileSync(
      path.join(checkout, "package.json"),
      `${JSON.stringify({ name: "consumer-app", version: "0.1.0" }, null, 2)}\n`,
      "utf8"
    );
    writeFileSync(
      path.join(checkout, "atlas.config.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          platform: {
            baseline: {
              atlasVersion: "0.3.0",
              contractSchemaVersion: 1,
              templateManifestSchemaVersion: 1,
              syncedPathChecksums: {},
            },
          },
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    expect(readCheckoutAtlasVersion(checkout)).toBe("0.3.0");
    rmSync(checkout, { recursive: true, force: true });
  });

  it("keeps platform checkout Atlas version on root package.json even when baseline differs", () => {
    const checkout = mkdtempSync(path.join(os.tmpdir(), "atlas-cli-platform-version-"));
    writeFileSync(
      path.join(checkout, "package.json"),
      `${JSON.stringify({ name: "@atlas/monorepo", version: "0.3.0" }, null, 2)}\n`,
      "utf8"
    );
    mkdirSync(path.join(checkout, "packages/cli"), { recursive: true });
    writeFileSync(
      path.join(checkout, "packages/cli/package.json"),
      `${JSON.stringify({ name: CLI_PACKAGE_NAME, version: "0.3.0" }, null, 2)}\n`,
      "utf8"
    );
    writeFileSync(
      path.join(checkout, "atlas.config.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          platform: {
            baseline: {
              atlasVersion: "0.1.0",
              contractSchemaVersion: 1,
              templateManifestSchemaVersion: 1,
              syncedPathChecksums: {},
            },
          },
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    expect(readCheckoutAtlasVersion(checkout)).toBe("0.3.0");
    rmSync(checkout, { recursive: true, force: true });
  });

  it("reports CLI metadata from the installed package", () => {
    expect(readCliVersionMetadata()).toEqual({
      atlasVersion: CLI_PACKAGE_VERSION,
      contractSchemaVersion: LATEST_SCHEMA_VERSION,
      cliPackage: CLI_PACKAGE_NAME,
    });
  });
});
