import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SCRIPT = path.resolve(__dirname, "../../bootstrap/capabilities/templates/security-audit.mjs");

function runAudit(
  audit: unknown,
  now = "2026-09-21"
): { status: number; stdout: string; stderr: string } {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-security-audit-"));
  const auditPath = path.join(cwd, "audit.json");
  writeFileSync(auditPath, `${JSON.stringify(audit)}\n`);
  const result = spawnSync(process.execPath, [SCRIPT, "--audit-json", auditPath, "--now", now], {
    encoding: "utf8",
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function advisory(options: {
  id: string;
  module: string;
  version: string;
  paths: string[];
  severity?: string;
}) {
  return {
    github_advisory_id: options.id,
    module_name: options.module,
    severity: options.severity ?? "high",
    title: `${options.module} advisory`,
    url: `https://github.com/advisories/${options.id}`,
    findings: [{ version: options.version, paths: options.paths }],
  };
}

const FIXTURE_EXCEPTION = {
  advisory: "GHSA-ph9p-34f9-6g65",
  packageName: "tmp",
  versions: ["0.0.33"],
  pathIncludes: "@lhci/cli",
  rationale: "Test-only exception used to exercise advisory/version/path matching.",
  expiresOn: "2026-11-27",
};

/**
 * Evaluates an audit document in-process against an explicit exception list, so
 * matching logic stays covered while the shipped exception list is empty.
 */
function evaluateWithExceptions(
  audit: unknown,
  exceptions: unknown[],
  now = "2026-09-21"
): {
  blocking: { packageName: string; version: string; advisory: string }[];
  ignored: unknown[];
} {
  const source = `
    import { evaluateConsumerSecurityAudit } from ${JSON.stringify(pathToFileURL(SCRIPT).href)};
    const [audit, exceptions, now] = JSON.parse(process.argv[1]);
    process.stdout.write(JSON.stringify(evaluateConsumerSecurityAudit(audit, exceptions, now)));
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", source, JSON.stringify([audit, exceptions, now])],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(`evaluateConsumerSecurityAudit failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function tmpAudit(findings: { version: string; paths: string[] }[]) {
  return {
    advisories: {
      "1": {
        github_advisory_id: "GHSA-ph9p-34f9-6g65",
        module_name: "tmp",
        severity: "high",
        title: "tmp advisory",
        url: "https://github.com/advisories/GHSA-ph9p-34f9-6g65",
        findings,
      },
    },
  };
}

const LHCI_TMP_PATH = ["node_modules/@lhci/cli>tmp"];
const OTHER_TMP_PATH = ["node_modules/@turbo/gen>inquirer>tmp"];

describe("consumer security audit exceptions", () => {
  it("fails an unapproved high finding", () => {
    const result = runAudit({
      advisories: {
        "1": advisory({
          id: "GHSA-xxxx-yyyy-zzzz",
          module: "left-pad",
          version: "1.0.0",
          paths: ["left-pad"],
        }),
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("left-pad@1.0.0");
    expect(result.stderr).toContain("GHSA-xxxx-yyyy-zzzz");
  });

  it("ships no built-in exceptions, so former LHCI tmp/extract-zip findings now block", () => {
    for (const [id, module, version, paths] of [
      ["GHSA-ph9p-34f9-6g65", "tmp", "0.1.0", ["node_modules/@lhci/cli>tmp"]],
      [
        "GHSA-jmr9-qjv8-65gv",
        "extract-zip",
        "2.0.1",
        ["node_modules/@lhci/cli>lighthouse>puppeteer-core>@puppeteer/browsers>extract-zip"],
      ],
      [
        "GHSA-7pqw-9j4j-h8q3",
        "extract-zip",
        "2.0.1",
        ["node_modules/@lhci/cli>lighthouse>puppeteer-core>@puppeteer/browsers>extract-zip"],
      ],
    ] as const) {
      const result = runAudit({
        advisories: { "1": advisory({ id, module, version, paths: [...paths] }) },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`${module}@${version}`);
      expect(result.stderr).toContain(id);
      expect(result.stdout).not.toContain("Ignored");
    }
  });

  it("ignores an exempt finding when every path matches the exception scope", () => {
    const result = evaluateWithExceptions(tmpAudit([{ version: "0.0.33", paths: LHCI_TMP_PATH }]), [
      FIXTURE_EXCEPTION,
    ]);
    expect(result.blocking).toEqual([]);
    expect(result.ignored).toHaveLength(1);
  });

  it("fails an exempt advisory that is also reachable through a non-exempt path", () => {
    const result = evaluateWithExceptions(
      tmpAudit([{ version: "0.0.33", paths: [...LHCI_TMP_PATH, ...OTHER_TMP_PATH] }]),
      [FIXTURE_EXCEPTION]
    );
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0]).toMatchObject({
      packageName: "tmp",
      version: "0.0.33",
    });
    expect(result.blocking[0]?.advisory.toLowerCase()).toBe("ghsa-ph9p-34f9-6g65");
  });

  it("blocks separate in-scope and out-of-scope findings for the same advisory in either order", () => {
    for (const findings of [
      [
        { version: "0.0.33", paths: LHCI_TMP_PATH },
        { version: "0.0.33", paths: OTHER_TMP_PATH },
      ],
      [
        { version: "0.0.33", paths: OTHER_TMP_PATH },
        { version: "0.0.33", paths: LHCI_TMP_PATH },
      ],
    ]) {
      const result = evaluateWithExceptions(tmpAudit(findings), [FIXTURE_EXCEPTION]);
      expect(result.blocking.length).toBeGreaterThan(0);
      expect(result.blocking[0]).toMatchObject({ packageName: "tmp", version: "0.0.33" });
    }
  });

  it("still ignores in-scope duplicate findings for the same advisory", () => {
    const result = evaluateWithExceptions(
      tmpAudit([
        { version: "0.0.33", paths: LHCI_TMP_PATH },
        { version: "0.0.33", paths: LHCI_TMP_PATH },
      ]),
      [FIXTURE_EXCEPTION]
    );
    expect(result.blocking).toEqual([]);
    expect(result.ignored.length).toBeGreaterThan(0);
  });

  it("does not apply an exception to a version it does not list", () => {
    const result = evaluateWithExceptions(tmpAudit([{ version: "0.1.0", paths: LHCI_TMP_PATH }]), [
      FIXTURE_EXCEPTION,
    ]);
    expect(result.blocking).toHaveLength(1);
  });

  it("does not let a duplicate lower-severity record hide a high finding", () => {
    const shared = {
      github_advisory_id: "GHSA-xxxx-yyyy-zzzz",
      module_name: "left-pad",
      title: "left-pad advisory",
      url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz",
    };
    for (const [first, second] of [
      ["moderate", "high"],
      ["high", "moderate"],
    ] as const) {
      const result = runAudit({
        advisories: {
          "1": {
            ...shared,
            severity: first,
            findings: [{ version: "1.0.0", paths: ["left-pad"] }],
          },
          "2": {
            ...shared,
            severity: second,
            findings: [{ version: "1.0.0", paths: ["left-pad"] }],
          },
        },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("left-pad@1.0.0");
      expect(result.stdout).not.toContain("No blocking high/critical advisories");
    }
  });

  it("does not apply an expired exception", () => {
    const result = evaluateWithExceptions(
      tmpAudit([{ version: "0.0.33", paths: LHCI_TMP_PATH }]),
      [FIXTURE_EXCEPTION],
      "2026-11-28"
    );
    expect(result.blocking).toHaveLength(1);
    expect(result.ignored).toEqual([]);
  });
});

describe("consumer security audit report validation", () => {
  function runSpawnedAudit(pnpmSource: string): { status: number; stdout: string; stderr: string } {
    const binDir = mkdtempSync(path.join(os.tmpdir(), "atlas-fake-pnpm-"));
    const pnpmPath = path.join(binDir, "pnpm");
    writeFileSync(pnpmPath, `#!/usr/bin/env node\n${pnpmSource}\n`);
    chmodSync(pnpmPath, 0o755);
    const result = spawnSync(process.execPath, [SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}` },
    });
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  it("rejects an exit-1 JSON error instead of treating it as a clean audit", () => {
    const result = runSpawnedAudit(`
process.stdout.write(JSON.stringify({
  error: { code: "ERR_PNPM_AUDIT", message: "registry unavailable" }
}) + "\\n");
process.exit(1);
`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pnpm audit returned an error");
    expect(result.stderr).toContain("registry unavailable");
    expect(result.stdout).not.toContain("No blocking high/critical advisories");
  });

  it("rejects a malformed or unrecognized report", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "atlas-security-audit-bad-"));
    const auditPath = path.join(cwd, "audit.json");
    writeFileSync(auditPath, "{not-json\n");
    const malformed = spawnSync(process.execPath, [SCRIPT, "--audit-json", auditPath], {
      encoding: "utf8",
    });
    expect(malformed.status ?? 1).toBe(1);
    expect(malformed.stderr ?? "").toMatch(/not valid JSON|malformed JSON/i);

    const unrecognized = runAudit({ foo: 1 });
    expect(unrecognized.status).toBe(1);
    expect(unrecognized.stderr).toContain("unrecognized audit report");
    expect(unrecognized.stdout).not.toContain("No blocking high/critical advisories");
  });

  it("accepts a valid clean vulnerability report", () => {
    const result = runAudit({
      vulnerabilities: {},
      metadata: { vulnerabilities: { high: 0, critical: 0 } },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No blocking high/critical advisories");
  });

  it("fails closed when metadata is null", () => {
    const result = runAudit({ metadata: null });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("metadata must be an object");
    expect(result.stdout).not.toContain("No blocking high/critical advisories");
  });

  it("fails closed when metadata reports high issues with no evaluable findings", () => {
    const result = runAudit({ metadata: { vulnerabilities: { high: 1, critical: 0 } } });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/no evaluable high\/critical findings/);
    expect(result.stdout).not.toContain("No blocking high/critical advisories");
  });

  it("fails closed on a malformed vulnerabilities entry", () => {
    const result = runAudit({
      vulnerabilities: { "left-pad": null },
      metadata: { vulnerabilities: { high: 0, critical: 0 } },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/malformed/);
    expect(result.stdout).not.toContain("No blocking high/critical advisories");
  });

  it("evaluates a valid vulnerability report returned with exit 1", () => {
    const result = runSpawnedAudit(`
process.stdout.write(JSON.stringify({
  vulnerabilities: {
    "left-pad": {
      name: "left-pad",
      severity: "high",
      via: [{
        name: "left-pad",
        title: "synthetic",
        url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz",
        severity: "high",
        range: "1.0.0"
      }],
      nodes: ["left-pad"]
    }
  },
  metadata: { vulnerabilities: { high: 1, critical: 0 } }
}) + "\\n");
process.exit(1);
`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("left-pad");
    expect(result.stderr).toContain("GHSA-xxxx-yyyy-zzzz");
    expect(result.stdout).not.toContain("No blocking high/critical advisories");
  });

  it("still honors documented advisory exceptions on a valid report", () => {
    const result = evaluateWithExceptions(
      {
        advisories: {
          "1": advisory({
            id: "GHSA-ph9p-34f9-6g65",
            module: "tmp",
            version: "0.0.33",
            paths: ["node_modules/@lhci/cli>tmp"],
          }),
        },
      },
      [FIXTURE_EXCEPTION]
    );
    expect(result.blocking).toEqual([]);
    expect(result.ignored).toHaveLength(1);
  });

  it("fails closed on an empty advisory record", () => {
    const result = runAudit({ advisories: { "1": {} } });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(
      /unknown severity|missing a package name|does not identify an advisory/
    );
    expect(result.stdout).not.toContain("No blocking high/critical advisories");
  });

  it("fails closed on a high vulnerability with no evaluable via entries", () => {
    const result = runAudit({
      vulnerabilities: { example: { severity: "high", via: [] } },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/no evaluable advisory entries/);
    expect(result.stdout).not.toContain("No blocking high/critical advisories");
  });

  it("fails closed on missing severity", () => {
    const result = runAudit({
      vulnerabilities: { example: { via: [] } },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/missing a known severity/);
    expect(result.stdout).not.toContain("No blocking high/critical advisories");
  });

  it("fails closed on unknown severity", () => {
    const result = runAudit({
      vulnerabilities: {
        example: {
          severity: "severe",
          via: [
            {
              name: "example",
              title: "synthetic",
              url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz",
              severity: "severe",
              range: "1.0.0",
            },
          ],
        },
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/unknown severity/);
    expect(result.stdout).not.toContain("No blocking high/critical advisories");
  });

  it("resolves valid transitive string via references", () => {
    const result = runAudit({
      vulnerabilities: {
        parent: { name: "parent", severity: "high", via: ["example"], nodes: ["parent"] },
        example: {
          name: "example",
          severity: "high",
          via: [
            {
              name: "example",
              title: "synthetic",
              url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz",
              severity: "high",
              range: "1.0.0",
            },
          ],
          nodes: ["example"],
        },
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("example@1.0.0");
    expect(result.stderr).toContain("GHSA-xxxx-yyyy-zzzz");
    expect(result.stdout).not.toContain("No blocking high/critical advisories");
  });

  it("fails closed on unresolved via references", () => {
    const result = runAudit({
      vulnerabilities: {
        parent: { severity: "high", via: ["missing"] },
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/unresolved via reference "missing"/);
    expect(result.stdout).not.toContain("No blocking high/critical advisories");
  });
});
