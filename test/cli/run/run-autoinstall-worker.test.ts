import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Auto-install / global-cache resolution was never enabled inside Worker
// threads: the Worker's resolver was initialised with `global_cache = disable`
// (the `BundleOptions::from_api` default) and never inherited the parent VM's
// auto-install settings, so the same bare specifier that auto-installs and
// loads on the main thread failed with ERR_MODULE_NOT_FOUND in a Worker of the
// same process, even with the global cache already warm.

const tarballPath = join(import.meta.dir, "..", "install", "registry", "packages", "no-deps", "no-deps-2.0.0.tgz");
const tarball = readFileSync(tarballPath);

let registry: ReturnType<typeof Bun.serve>;
beforeAll(() => {
  registry = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/no-deps") {
        return Response.json({
          name: "no-deps",
          "dist-tags": { latest: "2.0.0" },
          versions: {
            "2.0.0": {
              name: "no-deps",
              version: "2.0.0",
              dist: {
                tarball: `http://localhost:${registry.port}/no-deps/-/no-deps-2.0.0.tgz`,
                integrity:
                  "sha512-W3duJKZPcMIG5rA1io5cSK/bhW9rWFz+jFxZsKS/3suK4qHDkQNxUTEXee9/hTaAoDCeHWQqogukWYKzfr6X4g==",
                shasum: "8d304fcfc3c743ed39a8afbaefa03f5cd2a42c98",
              },
            },
          },
        });
      }
      if (pathname === "/no-deps/-/no-deps-2.0.0.tgz") {
        return new Response(tarball, { headers: { "Content-Type": "application/octet-stream" } });
      }
      return new Response("not found", { status: 404 });
    },
  });
});

afterAll(() => {
  registry?.stop(true);
});

test("Worker resolves bare specifier from global cache warmed by main thread", async () => {
  using dir = tempDir("autoinstall-worker", {
    "bunfig.toml": `[install]\nregistry = "http://localhost:${registry.port}/"\n`,
    "index.ts": `
      const m = await import("no-deps");
      console.log("MAIN " + m.name + "@" + m.version);
      const w = new Worker(new URL("./worker.ts", import.meta.url).href);
      const msg = await new Promise<string>((resolve, reject) => {
        w.onmessage = e => resolve(String(e.data));
        w.onerror = e => reject(e.message ?? e);
      });
      console.log(msg);
      await w.terminate();
    `,
    "worker.ts": `
      try {
        const m = await import("no-deps");
        postMessage("WORKER OK " + m.name + "@" + m.version);
      } catch (e: any) {
        postMessage("WORKER FAILED " + (e?.code ?? "") + " " + String(e?.message ?? e).split("\\n")[0]);
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Cannot find package");
  expect(stdout).toContain("MAIN no-deps@2.0.0");
  expect(stdout).toContain("WORKER OK no-deps@2.0.0");
  expect(stdout).not.toContain("WORKER FAILED");
  expect(exitCode).toBe(0);
});

test("Worker auto-installs bare specifier when main thread has not", async () => {
  using dir = tempDir("autoinstall-worker-cold", {
    "bunfig.toml": `[install]\nregistry = "http://localhost:${registry.port}/"\n`,
    "index.ts": `
      const w = new Worker(new URL("./worker.ts", import.meta.url).href);
      const msg = await new Promise<string>((resolve, reject) => {
        w.onmessage = e => resolve(String(e.data));
        w.onerror = e => reject(e.message ?? e);
      });
      console.log(msg);
      await w.terminate();
    `,
    "worker.ts": `
      try {
        const m = await import("no-deps");
        postMessage("WORKER OK " + m.name + "@" + m.version);
      } catch (e: any) {
        postMessage("WORKER FAILED " + (e?.code ?? "") + " " + String(e?.message ?? e).split("\\n")[0]);
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Cannot find package");
  expect(stdout).toContain("WORKER OK no-deps@2.0.0");
  expect(stdout).not.toContain("WORKER FAILED");
  expect(exitCode).toBe(0);
});

test("Worker respects --install=force from parent process", async () => {
  using dir = tempDir("autoinstall-worker-force", {
    "bunfig.toml": `[install]\nregistry = "http://localhost:${registry.port}/"\n`,
    "node_modules/placeholder/package.json": JSON.stringify({ name: "placeholder", version: "0.0.0" }),
    "index.ts": `
      const w = new Worker(new URL("./worker.ts", import.meta.url).href);
      const msg = await new Promise<string>((resolve, reject) => {
        w.onmessage = e => resolve(String(e.data));
        w.onerror = e => reject(e.message ?? e);
      });
      console.log(msg);
      await w.terminate();
    `,
    "worker.ts": `
      try {
        const m = await import("no-deps");
        postMessage("WORKER OK " + m.name + "@" + m.version);
      } catch (e: any) {
        postMessage("WORKER FAILED " + (e?.code ?? "") + " " + String(e?.message ?? e).split("\\n")[0]);
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--install=force", "index.ts"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Cannot find package");
  expect(stdout).toContain("WORKER OK no-deps@2.0.0");
  expect(exitCode).toBe(0);
});
