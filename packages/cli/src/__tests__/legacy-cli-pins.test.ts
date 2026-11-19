import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { SpawnSyncReturns } from "node:child_process";

import { runUpgradeCommand } from "../commands/upgrade";
import * as doctorModule from "../doctor";
import { runCliReferencesCheck } from "../doctor/cli-references";
import { DoctorDiagnosticCode } from "../doctor/diagnostics";
import { DOCTOR_CHECKS } from "../doctor/runner";
import {
  findLegacyCliPins,
  findPinnedCliInvocations,
  planLegacyCliPinReview,
  readConsumerCliPin,
} from "../upgrade/legacy-cli-pins";
import { formatUnsupportedSourceReleaseMessage } from "../upgrade/release-catalog";
import { runUpgrade } from "../upgrade/run";
import { CLI_PACKAGE_NAME } from "../version";
import { FIXTURE_MIGRATION_REGISTRY } from "./fixtures/upgrade-migrations/registry";

import type { DoctorContext } from "../doctor/context";
import type { OutputWriter } from "../output/write";
import type { ProductionReleaseCatalog } from "../upgrade/release-catalog";

/** A pre-1.3.0 consumer: CI and docs call a pinned CLI instead of `pnpm atlas`. */
const LEGACY_CI = `name: CI
on: [push]
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - run: pnpm install --frozen-lockfile
      - run: pnpm dlx ${CLI_PACKAGE_NAME}@1.2.2 doctor
`;

const LEGACY_README = `# my-app

Check the project with:

\`\`\`bash
pnpm dlx ${CLI_PACKAGE_NAME}@1.2.2 doctor
pnpm dlx ${CLI_PACKAGE_NAME}@1.2.2 context --json
\`\`\`
`;

const LEGACY_AGENTS = `# Agents

Before changing code run \`pnpm dlx ${CLI_PACKAGE_NAME}@1.2.2 context --json\`.
`;

function writeFile(root: string, relativePath: string, content: string): void {
  mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
  writeFileSync(path.join(root, relativePath), content);
}

function writeLegacyConsumer(
  root: string,
  options: { baseline: string; pinnedCli?: string }
): void {
  writeFile(
    root,
    "package.json",
    `${JSON.stringify(
      {
        name: "my-app",
        version: "0.1.0",
        ...(options.pinnedCli
          ? { devDependencies: { [CLI_PACKAGE_NAME]: options.pinnedCli } }
          : {}),
      },
      null,
      2
    )}\n`
  );
  writeFile(root, ".github/workflows/ci.yml", LEGACY_CI);
  writeFile(root, "README.md", LEGACY_README);
  writeFile(root, "AGENTS.md", LEGACY_AGENTS);
}

function doctorContext(root: string, baseline: string): DoctorContext {
  return {
    repoRoot: root,
    atlasVersion: "1.5.1",
    checkoutAtlasVersion: baseline,
    rawContract: {
      schemaVersion: 1,
      platform: { baseline: { atlasVersion: baseline } },
    } as DoctorContext["rawContract"],
  };
}

describe("findPinnedCliInvocations", () => {
  it("reports line, column, version and command of each pinned invocation", () => {
    expect(
      findPinnedCliInvocations(`intro\n  run: pnpm dlx ${CLI_PACKAGE_NAME}@1.2.2 doctor\n`, "1.5.0")
    ).toEqual([
      { line: 2, column: 17, version: "1.2.2", command: "doctor", olderThanExpected: true },
    ]);
  });

  it("recognises other package runners and prerelease pins", () => {
    const pins = findPinnedCliInvocations(
      [
        `npx ${CLI_PACKAGE_NAME}@1.2.2 doctor`,
        `pnpx ${CLI_PACKAGE_NAME}@1.2.2 doctor`,
        `pnpm exec ${CLI_PACKAGE_NAME}@1.2.2 doctor`,
        `pnpm dlx ${CLI_PACKAGE_NAME}@1.6.0-rc.1 doctor`,
      ].join("\n"),
      "1.5.0"
    );
    expect(pins.map((pin) => pin.version)).toEqual(["1.2.2", "1.2.2", "1.2.2", "1.6.0-rc.1"]);
    expect(pins[3]?.olderThanExpected).toBe(false);
  });

  it("ignores the expected version, placeholders, latest, and prose without a runner", () => {
    expect(
      findPinnedCliInvocations(
        [
          `pnpm dlx ${CLI_PACKAGE_NAME}@1.5.0 doctor`,
          `pnpm dlx ${CLI_PACKAGE_NAME}@<version> upgrade --to <version>`,
          `pnpm dlx ${CLI_PACKAGE_NAME}@latest upgrade`,
          `Atlas ${CLI_PACKAGE_NAME}@1.2.2 was the last release before the CLI pin.`,
          `pnpm dlx ${CLI_PACKAGE_NAME}@1.2.20 doctor`,
        ].join("\n"),
        "1.5.0"
      ).map((pin) => pin.version)
    ).toEqual(["1.2.20"]);
  });

  it("does not report a deliberate one-release upgrade step", () => {
    expect(
      findPinnedCliInvocations(
        [
          `pnpm dlx ${CLI_PACKAGE_NAME}@1.3.1 upgrade --to 1.3.1`,
          `pnpm dlx ${CLI_PACKAGE_NAME}@1.3.1 upgrade --to=1.3.1 --dry-run`,
          // A different target is not a one-release step and is reported.
          `pnpm dlx ${CLI_PACKAGE_NAME}@1.3.1 upgrade --to 1.3.10`,
        ].join("\n"),
        "1.5.0"
      ).map((pin) => pin.line)
    ).toEqual([3]);
  });
});

describe("findLegacyCliPins", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "atlas-legacy-pins-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("scans CI workflows, README, AGENTS and docs/how-we-build only", () => {
    writeLegacyConsumer(root, { baseline: "1.2.2" });
    writeFile(
      root,
      ".github/workflows/release.yaml",
      `- run: npx ${CLI_PACKAGE_NAME}@1.1.0 doctor\n`
    );
    writeFile(
      root,
      "docs/how-we-build/agents.md",
      `pnpm dlx ${CLI_PACKAGE_NAME}@1.2.2 generate feature\n`
    );
    // Not scanned: changelogs, nested docs, other directories.
    writeFile(root, "CHANGELOG.md", `pnpm dlx ${CLI_PACKAGE_NAME}@1.0.0 doctor\n`);
    writeFile(
      root,
      "docs/how-we-build/archive/old.md",
      `pnpm dlx ${CLI_PACKAGE_NAME}@1.0.0 doctor\n`
    );
    writeFile(root, "scripts/notes.md", `pnpm dlx ${CLI_PACKAGE_NAME}@1.0.0 doctor\n`);

    const pins = findLegacyCliPins({ repoRoot: root, expectedVersion: "1.5.1" });

    expect(
      pins.map((pin) => `${pin.scope} ${pin.relativePath}:${pin.line} ${pin.version}`)
    ).toEqual([
      "workflow .github/workflows/ci.yml:9 1.2.2",
      "workflow .github/workflows/release.yaml:1 1.1.0",
      "documentation README.md:6 1.2.2",
      "documentation README.md:7 1.2.2",
      "documentation AGENTS.md:3 1.2.2",
      "documentation docs/how-we-build/agents.md:1 1.2.2",
    ]);
  });

  it("finds nothing in a project without those files", () => {
    writeFile(root, "package.json", "{}\n");
    expect(findLegacyCliPins({ repoRoot: root, expectedVersion: "1.5.1" })).toEqual([]);
  });
});

describe("readConsumerCliPin", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "atlas-cli-pin-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("reads an exact devDependency or dependency pin, and ignores ranges", () => {
    writeFile(
      root,
      "package.json",
      JSON.stringify({ devDependencies: { [CLI_PACKAGE_NAME]: "1.5.1" } })
    );
    expect(readConsumerCliPin(root)).toBe("1.5.1");

    writeFile(
      root,
      "package.json",
      JSON.stringify({ dependencies: { [CLI_PACKAGE_NAME]: "1.4.0" } })
    );
    expect(readConsumerCliPin(root)).toBe("1.4.0");

    writeFile(
      root,
      "package.json",
      JSON.stringify({ devDependencies: { [CLI_PACKAGE_NAME]: "^1.5.0" } })
    );
    expect(readConsumerCliPin(root)).toBeUndefined();

    writeFile(root, "package.json", "{ not json");
    expect(readConsumerCliPin(root)).toBeUndefined();
  });
});

describe("doctor cli-references check", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "atlas-doctor-cli-refs-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("is registered with Doctor", () => {
    expect(DOCTOR_CHECKS.map((check) => check.id)).toContain("cli-references");
  });

  it.each(["1.1.0", "1.2.2"])(
    "fails a project upgraded from %s whose CI still runs the old CLI, and warns about docs",
    (generatedAt) => {
      writeLegacyConsumer(root, { baseline: "1.5.1", pinnedCli: "1.5.1" });
      writeFile(root, ".github/workflows/ci.yml", LEGACY_CI.replace("1.2.2", generatedAt));

      const result = runCliReferencesCheck(doctorContext(root, "1.5.1"));

      expect(result.status).toBe("fail");
      const workflow = result.diagnostics.filter(
        (diagnostic) => diagnostic.code === DoctorDiagnosticCode.LEGACY_CLI_PIN_WORKFLOW
      );
      expect(workflow).toEqual([
        expect.objectContaining({
          severity: "error",
          path: ".github/workflows/ci.yml",
          line: 9,
          message: expect.stringContaining(`${CLI_PACKAGE_NAME}@${generatedAt} doctor`),
          suggestedFix: expect.stringContaining("pnpm atlas <command>"),
        }),
      ]);
      const docs = result.diagnostics.filter(
        (diagnostic) => diagnostic.code === DoctorDiagnosticCode.LEGACY_CLI_PIN
      );
      expect(docs.map((diagnostic) => `${diagnostic.path}:${diagnostic.line}`)).toEqual([
        "README.md:6",
        "README.md:7",
        "AGENTS.md:3",
      ]);
      expect(docs.every((diagnostic) => diagnostic.severity === "warning")).toBe(true);
    }
  );

  it("only warns when CI pins a newer CLI than the project", () => {
    writeLegacyConsumer(root, { baseline: "1.2.2", pinnedCli: "1.2.0" });

    const result = runCliReferencesCheck(doctorContext(root, "1.2.2"));

    expect(result.status).toBe("warn");
    expect(result.diagnostics.every((diagnostic) => diagnostic.severity === "warning")).toBe(true);
  });

  it("passes a pre-1.3 project whose pins all match its baseline", () => {
    writeLegacyConsumer(root, { baseline: "1.2.2" });

    expect(runCliReferencesCheck(doctorContext(root, "1.2.2"))).toEqual(
      expect.objectContaining({ status: "pass", diagnostics: [] })
    );
  });

  it("tells a project without a pinned CLI to upgrade before switching to pnpm atlas", () => {
    writeLegacyConsumer(root, { baseline: "1.3.3" });

    const result = runCliReferencesCheck(doctorContext(root, "1.3.3"));

    expect(result.status).toBe("fail");
    expect(result.diagnostics[0]?.suggestedFix).toMatch(/Run `atlas upgrade`/);
  });

  it("passes a current project that uses pnpm atlas", () => {
    writeFile(
      root,
      "package.json",
      JSON.stringify({ devDependencies: { [CLI_PACKAGE_NAME]: "1.5.1" } })
    );
    writeFile(root, ".github/workflows/ci.yml", "- run: pnpm atlas doctor\n");
    writeFile(root, "README.md", "Run `pnpm atlas context --json`.\n");

    expect(runCliReferencesCheck(doctorContext(root, "1.5.1")).status).toBe("pass");
  });

  it("skips when the project's Atlas version is unknown", () => {
    writeFile(root, "package.json", "{}\n");

    const result = runCliReferencesCheck({ repoRoot: root, atlasVersion: "1.5.1" });

    expect(result.status).toBe("skip");
  });
});

describe("upgrade reports legacy CLI pins", () => {
  it("returns one non-blocking manual-review item per file", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "atlas-upgrade-pins-"));
    try {
      writeLegacyConsumer(root, { baseline: "1.2.2" });

      const review = planLegacyCliPinReview({
        repoRoot: root,
        sourceVersion: "1.2.2",
        targetVersion: "1.5.1",
      });

      expect(review.items.map((item) => item.relativePath)).toEqual([
        ".github/workflows/ci.yml",
        "README.md",
        "AGENTS.md",
      ]);
      for (const item of review.items) {
        expect(item).toEqual(
          expect.objectContaining({
            action: "manual-review",
            category: "manual",
            ownershipChannel: "consumer-owned-source",
            conflict: false,
            pathScope: "repository",
          })
        );
      }
      expect(review.items[1]?.message).toContain("line 6");
      expect(review.messages).toHaveLength(1);
      expect(review.messages[0]).toContain("3 consumer-owned files still run a pinned Atlas CLI");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lists pins in a single-release dry run without blocking, and never rewrites them", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "atlas-upgrade-run-pins-"));
    try {
      cpSync(path.resolve(__dirname, "fixtures/upgrade-e2e"), root, { recursive: true });
      writeFile(root, ".github/workflows/ci.yml", LEGACY_CI);
      writeFile(root, "AGENTS.md", LEGACY_AGENTS);
      const options = {
        repoRoot: root,
        targetVersion: "0.2.0",
        allowDirty: true,
        migrationRegistry: FIXTURE_MIGRATION_REGISTRY,
        releasesDir: path.join(root, "releases"),
      };

      const planned = await runUpgrade({ ...options, dryRun: true });

      expect(planned.status).toBe("planned");
      const pinItems = planned.items.filter(
        (item) => item.action === "manual-review" && item.message.includes("pinned Atlas CLI")
      );
      expect(pinItems.map((item) => item.relativePath).sort()).toEqual([
        ".github/workflows/ci.yml",
        "AGENTS.md",
      ]);
      expect(planned.conflicts.map((item) => item.relativePath)).not.toContain("AGENTS.md");
      expect(planned.messages.join("\n")).toContain("still run a pinned Atlas CLI");

      jest.spyOn(doctorModule, "runDoctor").mockResolvedValue({
        schemaVersion: 1,
        status: "healthy",
        atlasVersion: "0.2.0",
        projectRoot: ".",
        summary: {
          checksPassed: 1,
          checksWarned: 0,
          checksFailed: 0,
          checksSkipped: 0,
          diagnosticWarnings: 0,
          diagnosticErrors: 0,
        },
        checks: [],
        diagnostics: [],
      });
      const applied = await runUpgrade({ ...options, skipValidation: false });

      expect(applied.status).toBe("success");
      expect(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")).toBe(LEGACY_CI);
      expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).toBe(LEGACY_AGENTS);
    } finally {
      jest.restoreAllMocks();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lists pins in a multi-release dry run (upgrade --dry-run --json)", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "atlas-upgrade-hops-pins-"));
    try {
      writeLegacyConsumer(root, { baseline: "1.2.1" });
      writeFile(
        root,
        "atlas.config.json",
        JSON.stringify({
          schemaVersion: 1,
          platform: {
            baseline: {
              atlasVersion: "1.2.1",
              contractSchemaVersion: 1,
              templateManifestSchemaVersion: 1,
              syncedPathChecksums: {},
            },
          },
        })
      );
      const out: string[] = [];
      const writer: OutputWriter = {
        writeStdout: (line) => out.push(line),
        writeStderr: () => undefined,
      };
      const spawnResult = (): SpawnSyncReturns<string> => ({
        pid: 1,
        output: [],
        stdout: "",
        stderr: "",
        status: 0,
        signal: null,
      });

      const code = await runUpgradeCommand({
        cwd: root,
        dryRun: true,
        json: true,
        writer,
        runningVersion: "1.3.2",
        resolveLatest: () => "1.3.2",
        resolvePublished: () => ["1.2.1", "1.2.2", "1.2.4", "1.3.1", "1.3.2"],
        spawn: spawnResult,
      });

      expect(code).toBe(0);
      const payload = JSON.parse(out.join("\n")) as {
        result: {
          status: string;
          summary: { manual: number };
          items: { relativePath: string; action: string; conflict: boolean }[];
          messages: string[];
        };
      };
      expect(payload.result.status).toBe("planned");
      expect(payload.result.items).toEqual([
        expect.objectContaining({
          relativePath: ".github/workflows/ci.yml",
          action: "manual-review",
          conflict: false,
        }),
        expect.objectContaining({
          relativePath: "README.md",
          action: "manual-review",
          conflict: false,
        }),
        expect.objectContaining({
          relativePath: "AGENTS.md",
          action: "manual-review",
          conflict: false,
        }),
      ]);
      expect(payload.result.summary.manual).toBe(3);
      expect(payload.result.messages.join("\n")).toContain("still run a pinned Atlas CLI");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("unsupported source release message", () => {
  const catalog = {
    current: "1.5.1",
    supportedVersions: ["1.5.1", "1.5.0"],
  } as ProductionReleaseCatalog;

  it("points a project several releases behind at the multi-release upgrade", () => {
    const message = formatUnsupportedSourceReleaseMessage("1.2.2", catalog);

    expect(message).toContain("Unsupported source Atlas release 1.2.2");
    expect(message).toContain("more than one published release behind");
    expect(message).toContain(`pnpm dlx ${CLI_PACKAGE_NAME}@latest upgrade`);
  });

  it("does not suggest the multi-release route for a source newer than the window", () => {
    expect(formatUnsupportedSourceReleaseMessage("1.6.0", catalog)).not.toContain(
      "more than one published release behind"
    );
  });
});
