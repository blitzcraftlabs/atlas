import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureRoot = path.join(repoRoot, "scripts", "fixtures", "next-standalone-adapter");

function readCanonicalNextVersion() {
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, "apps/web/package.json"), "utf8"));
  const version = manifest.dependencies?.next;
  assert.equal(typeof version, "string", "apps/web must pin next in dependencies");
  return version;
}

function copyFixture(projectDir) {
  cpSync(fixtureRoot, projectDir, { recursive: true });
  writeFileSync(
    path.join(projectDir, "package.json"),
    `${JSON.stringify({ name: "next-standalone-adapter-regression", private: true }, null, 2)}\n`,
    "utf8",
  );
}

function run(command, args, options) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  return result;
}

async function waitForHttpOk(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const status = await new Promise((resolve, reject) => {
        const request = http.get(url, (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        });
        request.on("error", reject);
        request.setTimeout(2_000, () => {
          request.destroy();
          reject(new Error("timeout"));
        });
      });
      if (status >= 200 && status < 500) {
        return status;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

describe("Next.js standalone output with a build adapter", () => {
  it(
    "emits whole-app server NFT traces and standalone output (Vercel ENOENT regression)",
    { timeout: 10 * 60 * 1000 },
    async () => {
      const nextVersion = readCanonicalNextVersion();
      const projectDir = mkdtempSync(path.join(os.tmpdir(), "atlas-next-standalone-"));
      copyFixture(projectDir);

      const install = run(
        "pnpm",
        ["add", `next@${nextVersion}`, "react@19.0.0", "react-dom@19.0.0"],
        { cwd: projectDir, env: process.env },
      );
      assert.equal(
        install.status,
        0,
        `pnpm add failed:\n${install.stdout}\n${install.stderr}`,
      );

      const adapterPath = path.join(projectDir, "stub-adapter.js");
      const build = run("pnpm", ["exec", "next", "build"], {
        cwd: projectDir,
        env: {
          ...process.env,
          NODE_ENV: "production",
          NEXT_TELEMETRY_DISABLED: "1",
          NEXT_ADAPTER_PATH: adapterPath,
        },
      });
      assert.equal(
        build.status,
        0,
        `next build failed:\n${build.stdout}\n${build.stderr}`,
      );

      const nftPath = path.join(projectDir, ".next", "next-server.js.nft.json");
      const standaloneDir = path.join(projectDir, ".next", "standalone");
      const serverEntry = path.join(standaloneDir, "server.js");

      assert.equal(existsSync(nftPath), true, "expected .next/next-server.js.nft.json");
      assert.equal(existsSync(standaloneDir), true, "expected .next/standalone directory");
      assert.equal(existsSync(serverEntry), true, "expected standalone server.js");

      const installedNext = JSON.parse(
        readFileSync(path.join(projectDir, "node_modules/next/package.json"), "utf8"),
      ).version;
      assert.equal(installedNext, nextVersion);

      const port = 19_000 + Math.floor(Math.random() * 1000);
      const server = spawn(process.execPath, [serverEntry], {
        cwd: standaloneDir,
        env: {
          ...process.env,
          PORT: String(port),
          HOSTNAME: "127.0.0.1",
        },
        stdio: "ignore",
      });

      try {
        const status = await waitForHttpOk(`http://127.0.0.1:${port}/`);
        assert.equal(status, 200);
      } finally {
        server.kill("SIGTERM");
        await new Promise((resolve) => server.on("exit", resolve));
        rmSync(projectDir, { recursive: true, force: true });
      }
    },
  );
});
