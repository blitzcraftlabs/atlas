import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Tiny npm registry for one scoped package. Other packages stay on the default registry.
 *
 * @param {{
 *   name: string;
 *   versions: Array<{ version: string; tarballPath: string }>;
 *   latest?: string;
 * }} options
 */
function readPackedManifest(tarballPath) {
  const raw = execFileSync("tar", ["-xOf", tarballPath, "package/package.json"], {
    encoding: "utf8",
  });
  return JSON.parse(raw);
}

export function startLocalPackageRegistry(options) {
  const versions = options.versions.map((entry) => {
    const bytes = readFileSync(entry.tarballPath);
    const manifest = readPackedManifest(entry.tarballPath);
    return {
      version: entry.version,
      tarballPath: entry.tarballPath,
      tarballName: path.basename(entry.tarballPath),
      bytes,
      manifest,
      shasum: createHash("sha1").update(bytes).digest("hex"),
      integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    };
  });
  const latest = options.latest ?? versions.at(-1)?.version;
  if (!latest || !versions.some((entry) => entry.version === latest)) {
    throw new Error(`Local registry latest ${String(latest)} is not one of the served versions`);
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(url.pathname);
    const tarball = versions.find(
      (entry) =>
        pathname.endsWith(`/-/${entry.tarballName}`) || pathname.endsWith(entry.tarballName)
    );
    if (tarball && request.method === "GET") {
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(tarball.bytes.length),
      });
      response.end(tarball.bytes);
      return;
    }

    if (pathname.includes(options.name) && request.method === "GET") {
      const versionMap = {};
      const base = `http://127.0.0.1:${server.address().port}`;
      for (const entry of versions) {
        versionMap[entry.version] = {
          name: options.name,
          version: entry.version,
          dependencies: entry.manifest.dependencies ?? {},
          optionalDependencies: entry.manifest.optionalDependencies ?? {},
          peerDependencies: entry.manifest.peerDependencies ?? {},
          bin: entry.manifest.bin,
          dist: {
            tarball: `${base}/${options.name}/-/${entry.tarballName}`,
            shasum: entry.shasum,
            integrity: entry.integrity,
          },
        };
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          name: options.name,
          "dist-tags": { latest },
          versions: versionMap,
        })
      );
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found", path: pathname }));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Local registry did not bind a TCP port"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close() {
          return new Promise((done) => {
            server.close(() => done());
          });
        },
      });
    });
  });
}

const registryScriptPath = fileURLToPath(import.meta.url);

/**
 * Serve the registry in a child process so synchronous pnpm installs can still reach it.
 *
 * @param {{
 *   name: string;
 *   versions: Array<{ version: string; tarballPath: string }>;
 *   latest?: string;
 * }} options
 */
export function startLocalPackageRegistryProcess(options) {
  const child = spawn(process.execPath, [registryScriptPath, "--serve", JSON.stringify(options)], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const urlReady = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Local package registry did not start.\n${stderr}`));
    }, 10_000);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
      const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith("http://"));
      if (line) {
        clearTimeout(timeout);
        resolve(line.trim());
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Local package registry exited ${code ?? "null"}\n${stderr}\n${stdout}`));
    });
  });

  return urlReady.then((url) => ({
    url,
    async close() {
      if (child.exitCode !== null) {
        return;
      }
      await new Promise((resolve) => {
        child.once("exit", () => resolve());
        child.once("error", () => resolve());
        try {
          child.kill("SIGTERM");
        } catch {
          resolve();
        }
      });
    },
  }));
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === registryScriptPath &&
  process.argv[2] === "--serve"
) {
  const options = JSON.parse(process.argv[3] ?? "{}");
  const registry = await startLocalPackageRegistry(options);
  process.stdout.write(`${registry.url}\n`);
}
