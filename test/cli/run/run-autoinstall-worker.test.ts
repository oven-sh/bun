import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/29018

const pkgDir = join(import.meta.dir, "..", "install", "registry", "packages", "no-deps");
const tarball = readFileSync(join(pkgDir, "no-deps-2.0.0.tgz"));

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

const workerTs = `
  try {
    const m = await import("no-deps");
    postMessage("WORKER OK " + m.name + "@" + m.version);
  } catch (e: any) {
    postMessage("WORKER FAILED " + (e?.code ?? "") + " " + String(e?.message ?? e).split("\\n")[0]);
  }
`;

const indexTs = ({ prelude = "", epilogue = "" } = {}) => `
  ${prelude}
  const w = new Worker(new URL("./worker.ts", import.meta.url).href);
  const msg = await new Promise<string>((resolve, reject) => {
    w.onmessage = e => resolve(String(e.data));
    w.onerror = e => reject(e.message ?? e);
  });
  console.log(msg);
  await w.terminate();
  ${epilogue}
`;

async function run(opts: { prefix: string; flags?: string[]; extraFiles?: Record<string, string>; index: string }) {
  using dir = tempDir(opts.prefix, {
    "bunfig.toml": `[install]\nregistry = "http://localhost:${registry.port}/"\n`,
    "worker.ts": workerTs,
    "index.ts": opts.index,
    ...(opts.extraFiles ?? {}),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...(opts.flags ?? []), "index.ts"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("Worker resolves bare specifier from global cache warmed by main thread", async () => {
  const { stdout, stderr, exitCode } = await run({
    prefix: "autoinstall-worker-warm",
    index: indexTs({
      prelude: `
        const m = await import("no-deps");
        console.log("MAIN " + m.name + "@" + m.version);
      `,
    }),
  });
  expect(stderr).not.toContain("Cannot find package");
  expect(stdout).toContain("MAIN no-deps@2.0.0");
  expect(stdout).toContain("WORKER OK no-deps@2.0.0");
  expect(stdout).not.toContain("WORKER FAILED");
  expect(exitCode).toBe(0);
});

test.concurrent("Worker auto-installs bare specifier when main thread has not", async () => {
  const { stdout, stderr, exitCode } = await run({
    prefix: "autoinstall-worker-cold",
    index: indexTs(),
  });
  expect(stderr).not.toContain("Cannot find package");
  expect(stdout).toContain("WORKER OK no-deps@2.0.0");
  expect(stdout).not.toContain("WORKER FAILED");
  expect(exitCode).toBe(0);
});

test.concurrent("Worker respects --install=force from parent process", async () => {
  const { stdout, stderr, exitCode } = await run({
    prefix: "autoinstall-worker-force",
    flags: ["--install=force"],
    extraFiles: {
      "node_modules/placeholder/package.json": JSON.stringify({ name: "placeholder", version: "0.0.0" }),
    },
    index: indexTs(),
  });
  expect(stderr).not.toContain("Cannot find package");
  expect(stdout).toContain("WORKER OK no-deps@2.0.0");
  expect(exitCode).toBe(0);
});

test.concurrent(
  "main-thread auto-install still works after a Worker that used auto-install is terminated",
  async () => {
    const { stdout, stderr, exitCode } = await run({
      prefix: "autoinstall-worker-after-terminate",
      flags: ["--install=force"],
      index: indexTs({
        epilogue: `
          const m = await import("no-deps");
          console.log("MAIN " + m.name + "@" + m.version);
        `,
      }),
    });
    expect(stderr).not.toContain("Cannot find package");
    expect(stdout).toContain("WORKER OK no-deps@2.0.0");
    expect(stdout).toContain("MAIN no-deps@2.0.0");
    expect(exitCode).toBe(0);
  },
);
