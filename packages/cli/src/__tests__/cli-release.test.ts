import {
  atlasDlxForEnable,
  cliReleaseIncludesEnable,
  FIRST_CLI_RELEASE_WITH_ENABLE,
} from "../init/cli-release";

describe("atlas enable CLI version selection", () => {
  it("pins the first enable-capable release for baselines that lack enable", () => {
    expect(cliReleaseIncludesEnable("1.1.0")).toBe(false);
    expect(atlasDlxForEnable("1.1.0")).toBe(
      `pnpm dlx @blitzcraftlabs/atlas@${FIRST_CLI_RELEASE_WITH_ENABLE}`
    );
    expect(atlasDlxForEnable("1.1.0", { runningCliVersion: "1.1.0" })).toBe(
      `pnpm dlx @blitzcraftlabs/atlas@${FIRST_CLI_RELEASE_WITH_ENABLE}`
    );
  });

  it("treats 1.2.0 as the first published release with enable", () => {
    expect(FIRST_CLI_RELEASE_WITH_ENABLE).toBe("1.2.0");
    expect(cliReleaseIncludesEnable(FIRST_CLI_RELEASE_WITH_ENABLE)).toBe(true);
  });

  it("pins enable to a running CLI that includes the command, not the consumer baseline", () => {
    expect(cliReleaseIncludesEnable("99.0.0")).toBe(true);
    expect(atlasDlxForEnable("1.1.0", { runningCliVersion: "99.0.0" })).toBe(
      "pnpm dlx @blitzcraftlabs/atlas@99.0.0"
    );
  });

  it("uses the init/CLI version when that release includes enable", () => {
    expect(atlasDlxForEnable("99.0.0")).toBe("pnpm dlx @blitzcraftlabs/atlas@99.0.0");
  });
});
