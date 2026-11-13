import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parseAtlasProjectContract } from "@atlas/project";

import { ExitCode } from "../exit-codes";
import { customGeneratorVariables, renderTemplateString } from "../generators/custom/generate";

import { createGeneratorAtlasFixture } from "./helpers/fixture";
import { runAtlasCli } from "./helpers/run-cli";

function addCustomGenerator(root: string): void {
  const configPath = path.join(root, "atlas.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  config.generators = {
    "data-table": {
      description: "Feature with a sortable data table.",
      templates: "tools/generators/data-table",
      target: "apps/web/src/features/{{kebab}}",
      argument: { name: "name", description: "Table name in kebab-case." },
      followUp: ["Export {{pascal}}Table from the feature index."],
    },
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const templates = path.join(root, "tools/generators/data-table");
  mkdirSync(path.join(templates, "components"), { recursive: true });
  writeFileSync(
    path.join(templates, "components/{{pascal}}Table.tsx.tmpl"),
    'export function {{pascal}}Table() {\n  return <table aria-label="{{title}}" />;\n}\n'
  );
  writeFileSync(
    path.join(templates, "index.ts"),
    'export { {{pascal}}Table } from "./components/{{pascal}}Table";\n'
  );
}

describe("custom generator contract", () => {
  it("accepts a valid generator definition", () => {
    const contract = parseAtlasProjectContract({
      schemaVersion: 1,
      generators: {
        "data-table": {
          description: "d",
          templates: "tools/t",
          target: "apps/web/src/features/{{kebab}}",
        },
      },
    });
    expect(contract.generators?.["data-table"]?.templates).toBe("tools/t");
  });

  it("rejects reserved ids, bad ids and escaping paths", () => {
    for (const generators of [
      { feature: { description: "d", templates: "t", target: "x" } },
      { DataTable: { description: "d", templates: "t", target: "x" } },
      { ok: { description: "d", templates: "../outside", target: "x" } },
      { ok: { description: "d", templates: "t", target: "/abs" } },
    ]) {
      expect(() => parseAtlasProjectContract({ schemaVersion: 1, generators })).toThrow();
    }
  });
});

describe("template rendering", () => {
  it("renders every placeholder", () => {
    const variables = customGeneratorVariables("billing-history");
    expect(
      renderTemplateString("{{name}} {{kebab}} {{camel}} {{pascal}} {{ title }}", variables)
    ).toBe("billing-history billing-history billingHistory BillingHistory Billing History");
  });

  it("rejects non-kebab input", () => {
    expect(() => customGeneratorVariables("BillingHistory")).toThrow();
  });
});

describe("atlas generate <custom>", () => {
  it("lists, dry-runs, generates, and refuses to overwrite", () => {
    const fixture = createGeneratorAtlasFixture({ withContract: true });
    try {
      addCustomGenerator(fixture.root);

      const list = runAtlasCli(["generate", "list", "--json"], fixture.root);
      expect(list.exitCode).toBe(ExitCode.SUCCESS);
      const generators = (
        JSON.parse(list.stdout) as { result: { generators: { id: string; source: string }[] } }
      ).result.generators;
      expect(generators.find((entry) => entry.id === "data-table")?.source).toBe("custom");
      expect(generators.find((entry) => entry.id === "feature")?.source).toBe("builtin");

      const dry = runAtlasCli(
        ["generate", "data-table", "billing-history", "--dry-run", "--json"],
        fixture.root
      );
      expect(dry.exitCode).toBe(ExitCode.SUCCESS);
      expect(existsSync(path.join(fixture.root, "apps/web/src/features/billing-history"))).toBe(
        false
      );

      const run = runAtlasCli(
        ["generate", "data-table", "billing-history", "--json"],
        fixture.root
      );
      expect(run.exitCode).toBe(ExitCode.SUCCESS);
      const payload = JSON.parse(run.stdout) as { result: { followUpActions: string[] } };
      expect(payload.result.followUpActions).toEqual([
        "Export BillingHistoryTable from the feature index.",
      ]);
      const component = readFileSync(
        path.join(
          fixture.root,
          "apps/web/src/features/billing-history/components/BillingHistoryTable.tsx"
        ),
        "utf8"
      );
      expect(component).toContain('aria-label="Billing History"');
      expect(
        readFileSync(
          path.join(fixture.root, "apps/web/src/features/billing-history/index.ts"),
          "utf8"
        )
      ).toContain("BillingHistoryTable");

      const again = runAtlasCli(
        ["generate", "data-table", "billing-history", "--json"],
        fixture.root
      );
      expect(again.exitCode).toBe(ExitCode.GENERATOR_CONFLICT);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("reports unknown generators and missing templates", () => {
    const fixture = createGeneratorAtlasFixture({ withContract: true });
    try {
      const unknown = runAtlasCli(["generate", "nope", "x", "--json"], fixture.root);
      expect(unknown.exitCode).toBe(ExitCode.USAGE_ERROR);
      addCustomGenerator(fixture.root);
      rmSync(path.join(fixture.root, "tools"), { recursive: true, force: true });
      const missing = runAtlasCli(["generate", "data-table", "x", "--json"], fixture.root);
      expect(missing.exitCode).not.toBe(ExitCode.SUCCESS);
      expect(missing.stdout + missing.stderr).toContain("templates directory does not exist");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
