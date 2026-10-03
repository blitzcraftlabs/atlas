import { formatInitResult } from "../commands/init";
import { ENABLE_CLI_RELEASE_PLACEHOLDER } from "../init/cli-release";
import { buildConsumerPackageManifest, buildConsumerReadme } from "../init/consumer-files";

describe("generated consumer workspace files", () => {
  it("keeps api:gen and omits dangling Atlas CLI and git-dependent scripts", () => {
    const manifest = JSON.parse(
      buildConsumerPackageManifest({
        projectName: "my-app",
        atlasVersion: "0.3.0",
      })
    ) as { version: string; scripts: Record<string, string> };

    expect(manifest.version).toBe("0.1.0");
    expect(
      (
        JSON.parse(
          buildConsumerPackageManifest({
            projectName: "my-app",
            atlasVersion: "0.3.0",
          })
        ) as { devDependencies: Record<string, string> }
      ).devDependencies["@blitzcraftlabs/atlas"]
    ).toBe("0.3.0");
    expect(manifest.scripts["api:gen"]).toBe("pnpm --filter @atlas/web api:gen");
    expect(manifest.scripts.atlas).toBe("atlas");
    expect(manifest.scripts["template:check"]).toBeUndefined();
    expect(manifest.scripts["template:sync"]).toBeUndefined();
    expect(manifest.scripts["api:check"]).toBeUndefined();
    expect(JSON.stringify(manifest.scripts)).not.toContain("git diff");
  });

  it("adds a root start script when performance commands are included", () => {
    const manifest = JSON.parse(
      buildConsumerPackageManifest({
        projectName: "my-app",
        atlasVersion: "1.1.0",
        includePerfCommands: true,
      })
    ) as { scripts: Record<string, string> };

    expect(manifest.scripts.start).toBe("pnpm --filter @atlas/web start");
    expect(manifest.scripts["perf:lhci"]).toBe("pnpm --filter @atlas/web perf:lhci");
  });

  it("documents only commands the generated project owns", () => {
    const atlasVersion = "0.3.0";
    const readme = buildConsumerReadme({
      projectName: "my-app",
      atlasVersion,
    });

    expect(readme).toContain("pnpm install");
    expect(readme).toContain("pnpm dev");
    expect(readme).toContain("pnpm atlas doctor");
    expect(readme).toContain("pnpm atlas context --json");
    expect(readme).toContain("pnpm atlas enable list --json");
    expect(readme).toContain("pnpm dlx @blitzcraftlabs/atlas init <name>");
    expect(readme).not.toContain(`pnpm dlx @blitzcraftlabs/atlas@${atlasVersion} doctor`);
    expect(readme).toContain(".github/workflows/ci.yml");
    expect(readme).toContain("GitHub-hosted Ubuntu");
    expect(readme).toContain("does not use BlitzCraft infrastructure");
    expect(readme).toContain(
      "https://github.com/blitzcraftlabs/atlas/blob/main/docs/public/README.md"
    );
    expect(readme).not.toContain("pnpm atlas -- doctor");
    expect(readme).toContain("pnpm atlas");
    expect(readme).not.toContain("package publication path is finalized");
    expect(readme).not.toContain("template:check");
    expect(readme).not.toContain("template:sync");
    expect(readme).not.toContain("api:check");
  });

  it("pins enable to a running CLI that includes the command, not the 1.1.0 baseline", () => {
    const readme = buildConsumerReadme({
      projectName: "my-app",
      atlasVersion: "1.1.0",
      runningCliVersion: "99.0.0",
    });
    const lines = formatInitResult(
      {
        repoRoot: "/tmp/my-app",
        atlasVersion: "1.1.0",
        initMode: "bootstrap",
        actions: [],
        warnings: [],
      },
      false
    ).join("\n");

    expect(readme).toContain("pnpm atlas doctor");
    expect(readme).toContain("pnpm atlas context --json");
    expect(readme).toContain("pnpm atlas enable list --json");
    expect(readme).not.toContain("pnpm dlx @blitzcraftlabs/atlas@1.1.0 doctor");
    expect(readme).not.toContain("pnpm dlx @blitzcraftlabs/atlas@99.0.0 enable");
    expect(readme).not.toContain(`@${ENABLE_CLI_RELEASE_PLACEHOLDER} enable list`);
    expect(lines).toContain("pnpm atlas doctor");
    expect(lines).toContain("pnpm atlas context --json");
    expect(lines).toContain("pnpm atlas enable list --json");
    expect(lines).not.toContain("pnpm dlx @blitzcraftlabs/atlas@99.0.0");
    expect(lines).not.toContain(`@${ENABLE_CLI_RELEASE_PLACEHOLDER} enable list`);
  });

  it("points enable at the upcoming-release placeholder when the running CLI lacks enable", () => {
    const readme = buildConsumerReadme({
      projectName: "my-app",
      atlasVersion: "1.1.0",
      runningCliVersion: "1.1.0",
    });
    const lines = formatInitResult(
      {
        repoRoot: "/tmp/my-app",
        atlasVersion: "1.1.0",
        initMode: "bootstrap",
        actions: [],
        warnings: [],
      },
      false
    ).join("\n");
    const enableCommand = "pnpm atlas enable list --json";

    expect(readme).toContain("pnpm atlas doctor");
    expect(readme).toContain("pnpm atlas context --json");
    expect(readme).toContain(enableCommand);
    expect(readme).not.toContain(`@${ENABLE_CLI_RELEASE_PLACEHOLDER} enable list`);
    expect(readme).not.toContain("pnpm dlx @blitzcraftlabs/atlas@1.1.0 enable");
    expect(lines).toContain("pnpm atlas doctor");
    expect(lines).toContain("pnpm atlas context --json");
    expect(lines).toContain(enableCommand);
    expect(lines).not.toContain("pnpm dlx @blitzcraftlabs/atlas@1.1.0 enable");
  });

  it("does not advertise an unsupported atlas command after bootstrap init", () => {
    const atlasVersion = "0.3.0";
    const lines = formatInitResult(
      {
        repoRoot: "/tmp/my-app",
        atlasVersion,
        initMode: "bootstrap",
        actions: [],
        warnings: [],
      },
      false
    ).join("\n");

    expect(lines).toContain("pnpm install");
    expect(lines).toContain("pnpm dev");
    expect(lines).toContain("pnpm atlas doctor");
    expect(lines).toContain("pnpm atlas context --json");
    expect(lines).toContain("pnpm atlas enable list --json");
    expect(lines).not.toContain(`pnpm dlx @blitzcraftlabs/atlas@${atlasVersion} doctor`);
    expect(lines).not.toContain("package publication path is finalized");
    expect(lines).not.toContain("pnpm atlas -- doctor");
  });
});
