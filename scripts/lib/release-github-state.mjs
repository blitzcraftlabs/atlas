import { execFileSync } from "node:child_process";

export const PUBLIC_PACKAGE = "@blitzcraftlabs/atlas";

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** All published npm versions of the public CLI package (empty when the package is absent). */
export function readNpmVersions() {
  try {
    const parsed = JSON.parse(run("npm", ["view", PUBLIC_PACKAGE, "versions", "--json"]) || "[]");
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    if (String(error?.stderr ?? "").includes("E404")) return [];
    throw error;
  }
}

/** Tags and Releases (including drafts, which need contents access) for a repository. */
export function readGithubReleaseState(ownerRepo) {
  const tags = JSON.parse(
    run("gh", ["api", `repos/${ownerRepo}/tags?per_page=100`, "--paginate", "--jq", "[.[].name]"])
      .trim()
      .replace(/\]\s*\[/g, ",") || "[]"
  );
  const releases = JSON.parse(
    run("gh", [
      "api",
      `repos/${ownerRepo}/releases?per_page=100`,
      "--paginate",
      "--jq",
      "[.[] | {tagName: .tag_name, draft: .draft, prerelease: .prerelease}]",
    ])
      .trim()
      .replace(/\]\s*\[/g, ",") || "[]"
  );
  return { tags, releases };
}

export function runGh(args) {
  return run("gh", args);
}
