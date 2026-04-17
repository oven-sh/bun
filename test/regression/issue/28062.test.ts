import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { basename, join } from "path";

// Minimal tarballs for testing - we reuse the ones from the install test fixtures
const tgzDir = join(import.meta.dir, "..", "..", "cli", "install");

let server: ReturnType<typeof Bun.serve>;
let registryUrl: string;

beforeAll(() => {
  // Start a minimal registry server that serves package manifests and tarballs
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // Serve tarball files
      if (path.endsWith(".tgz")) {
        const tgzPath = join(tgzDir, basename(path));
        const file = Bun.file(tgzPath);
        if (await file.exists()) {
          return new Response(file);
        }
        return new Response("Not found", { status: 404 });
      }

      // Serve package manifests
      if (path === "/baz") {
        return Response.json({
          name: "baz",
          "dist-tags": { latest: "0.0.3" },
          versions: {
            "0.0.3": {
              name: "baz",
              version: "0.0.3",
              dist: {
                tarball: `${registryUrl}/baz-0.0.3.tgz`,
                integrity: "",
              },
            },
          },
        });
      }

      if (path === "/bar") {
        return Response.json({
          name: "bar",
          "dist-tags": { latest: "0.0.2" },
          versions: {
            "0.0.2": {
              name: "bar",
              version: "0.0.2",
              dist: {
                tarball: `${registryUrl}/bar-0.0.2.tgz`,
                integrity: "",
              },
            },
          },
        });
      }

      return new Response("Not found", { status: 404 });
    },
  });
  registryUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server?.stop(true);
});

test("parallel bun install with shared cache dir should not ENOENT", async () => {
  using sharedCache = tempDir("shared-cache-", {});
  const cacheDir = join(String(sharedCache), "install-cache");

  const pkg = JSON.stringify({
    name: "test-pkg",
    private: true,
    dependencies: {
      bar: "0.0.2",
      baz: "0.0.3",
    },
  });

  const bunfig = `
[install]
registry = "${registryUrl}"
`;

  // Create two project directories with identical dependencies
  using dirA = tempDir("project-a-", {
    "package.json": pkg,
    "bunfig.toml": bunfig,
  });
  using dirB = tempDir("project-b-", {
    "package.json": pkg,
    "bunfig.toml": bunfig,
  });

  const runInstall = async (cwd: string) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: cacheDir,
      },
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return { stdout, stderr, exitCode };
  };

  // Run both installs in parallel with the same shared cache directory.
  // On Windows, this previously caused ENOENT when one process's collision
  // handler deleted a cache entry that another process had already resolved.
  const results = await Promise.all([runInstall(String(dirA)), runInstall(String(dirB))]);

  for (const result of results) {
    expect(result.stderr).not.toContain("ENOENT");
    expect(result.stderr).not.toContain("failed opening cache");
    expect(result.stderr).not.toContain("failed to verify cache dir");
    expect(result.exitCode).toBe(0);
  }
}, 30_000);
