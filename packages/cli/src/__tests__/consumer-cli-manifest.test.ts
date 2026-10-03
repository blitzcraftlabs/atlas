import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { applyConsumerCliPin, planConsumerCliPin } from "../upgrade/consumer-cli-manifest";

function writePackage(root: string, manifest: Record<string, unknown>): void {
  writeFileSync(path.join(root, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function readPackage(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("consumer CLI manifest migration", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "atlas-cli-pin-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("adds the atlas script and exact devDependency when both are absent", () => {
    const original = {
      name: "consumer",
      version: "0.1.0",
      private: true,
      scripts: { dev: "turbo run dev", lint: "turbo run lint" },
      dependencies: { react: "19.0.0" },
      devDependencies: { prettier: "3.4.2" },
      packageManager: "pnpm@10.19.0",
    };
    writePackage(root, original);

    const applied = applyConsumerCliPin({
      repoRoot: root,
      sourceVersion: "1.2.2",
      targetVersion: "1.2.5",
    });
    const next = readPackage(root);

    expect(applied.action).toBe("update");
    expect(next.name).toBe(original.name);
    expect(next.version).toBe(original.version);
    expect(next.private).toBe(true);
    expect(next.dependencies).toEqual(original.dependencies);
    expect(next.packageManager).toBe(original.packageManager);
    expect(next.scripts).toEqual({ ...original.scripts, atlas: "atlas" });
    expect(next.devDependencies).toEqual({
      ...original.devDependencies,
      "@blitzcraftlabs/atlas": "1.2.5",
    });
  });

  it("leaves an already correct pin unchanged", () => {
    const original = {
      name: "consumer",
      version: "0.1.0",
      scripts: { atlas: "atlas", dev: "turbo run dev" },
      devDependencies: { "@blitzcraftlabs/atlas": "1.2.5", prettier: "3.4.2" },
    };
    writePackage(root, original);
    const before = readFileSync(path.join(root, "package.json"), "utf8");

    const plan = planConsumerCliPin({
      repoRoot: root,
      sourceVersion: "1.2.2",
      targetVersion: "1.2.5",
    });
    applyConsumerCliPin({
      repoRoot: root,
      sourceVersion: "1.2.2",
      targetVersion: "1.2.5",
    });

    expect(plan.action).toBe("noop");
    expect(readFileSync(path.join(root, "package.json"), "utf8")).toBe(before);
  });

  it("advances an exact source baseline pin", () => {
    writePackage(root, {
      name: "consumer",
      scripts: { atlas: "atlas", build: "turbo run build" },
      devDependencies: { "@blitzcraftlabs/atlas": "1.2.2" },
    });

    applyConsumerCliPin({
      repoRoot: root,
      sourceVersion: "1.2.2",
      targetVersion: "1.2.5",
    });

    expect(readPackage(root).devDependencies).toEqual({ "@blitzcraftlabs/atlas": "1.2.5" });
    expect(readPackage(root).scripts).toEqual({ atlas: "atlas", build: "turbo run build" });
  });

  it("preserves unrelated scripts while adding atlas", () => {
    writePackage(root, {
      scripts: { dev: "next dev", "custom:task": "node tools/task.js" },
    });

    applyConsumerCliPin({
      repoRoot: root,
      sourceVersion: "1.2.2",
      targetVersion: "1.2.5",
    });

    expect(readPackage(root).scripts).toEqual({
      dev: "next dev",
      "custom:task": "node tools/task.js",
      atlas: "atlas",
    });
  });

  it("does not overwrite a conflicting atlas script", () => {
    const original = {
      scripts: { atlas: "some-other-command", dev: "next dev" },
      devDependencies: { typescript: "5.7.2" },
    };
    writePackage(root, original);
    const before = readFileSync(path.join(root, "package.json"), "utf8");

    const plan = applyConsumerCliPin({
      repoRoot: root,
      sourceVersion: "1.2.2",
      targetVersion: "1.2.5",
    });

    expect(plan.action).toBe("conflict");
    expect(plan.items[0]?.conflict).toBe(true);
    expect(plan.items[0]?.message).toContain("some-other-command");
    expect(readFileSync(path.join(root, "package.json"), "utf8")).toBe(before);
  });

  it("does not rewrite an unexpected Atlas dependency source", () => {
    const original = {
      scripts: { dev: "next dev" },
      devDependencies: { "@blitzcraftlabs/atlas": "github:example/atlas" },
    };
    writePackage(root, original);
    const before = readFileSync(path.join(root, "package.json"), "utf8");

    const plan = planConsumerCliPin({
      repoRoot: root,
      sourceVersion: "1.2.2",
      targetVersion: "1.2.5",
    });

    expect(plan.action).toBe("conflict");
    expect(plan.items.some((item) => item.message.includes("github:example/atlas"))).toBe(true);
    expect(readFileSync(path.join(root, "package.json"), "utf8")).toBe(before);
  });

  it("does not write during a dry run", () => {
    writePackage(root, { name: "consumer", scripts: { dev: "next dev" } });
    const before = readFileSync(path.join(root, "package.json"), "utf8");

    const plan = applyConsumerCliPin({
      repoRoot: root,
      sourceVersion: "1.2.2",
      targetVersion: "1.2.5",
      dryRun: true,
    });

    expect(plan.action).toBe("update");
    expect(readFileSync(path.join(root, "package.json"), "utf8")).toBe(before);
  });
});
