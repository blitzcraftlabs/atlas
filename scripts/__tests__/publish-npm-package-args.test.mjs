import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseArgs } from "../publish-npm-package.mjs";

describe("publish-npm-package arguments", () => {
  it("defaults to a dry run: publishing requires an explicit --oidc", () => {
    assert.deepEqual(parseArgs([]), { help: false, dryRun: true, oidc: false, skipBuild: false });
    assert.deepEqual(parseArgs(["--skip-build"]), {
      help: false,
      dryRun: true,
      oidc: false,
      skipBuild: true,
    });
  });

  it("publishes only with --oidc", () => {
    assert.deepEqual(parseArgs(["--oidc"]), {
      help: false,
      dryRun: false,
      oidc: true,
      skipBuild: false,
    });
  });

  it("refuses --oidc together with --dry-run", () => {
    assert.throws(() => parseArgs(["--oidc", "--dry-run"]), /either --oidc or --dry-run/);
  });

  it("refuses unknown arguments instead of ignoring them (e.g. a token flag)", () => {
    assert.throws(() => parseArgs(["--token", "abc"]), /Unknown argument: --token/);
    assert.throws(() => parseArgs(["--publish"]), /Unknown argument: --publish/);
  });

  it("accepts --help and -h", () => {
    assert.equal(parseArgs(["--help"]).help, true);
    assert.equal(parseArgs(["-h"]).help, true);
  });
});
