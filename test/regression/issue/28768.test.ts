import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { bunExe, bunEnv, isLinux, tempDir } from "harness";

// Serve a minimal registry with a single package (no-deps@1.0.0)
const tgzPath = join(import.meta.dir, "..", "..", "cli", "install", "registry", "packages", "no-deps", "no-deps-1.0.0.tgz");
const tgzData = readFileSync(tgzPath);

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/no-deps") {
        return Response.json({
          name: "no-deps",
          "dist-tags": { latest: "1.0.0" },
          versions: {
            "1.0.0": {
              name: "no-deps",
              version: "1.0.0",
              dist: {
                tarball: `http://localhost:${server.port}/no-deps/-/no-deps-1.0.0.tgz`,
              },
            },
          },
        });
      }
      if (url.pathname === "/no-deps/-/no-deps-1.0.0.tgz") {
        return new Response(tgzData);
      }
      return new Response("not found", { status: 404 });
    },
  });
});

afterAll(() => {
  server.stop(true);
});

function writeBunfig(dir: string, cacheDir: string) {
  const bunfig = `[install]\ncache = "${cacheDir.replaceAll("\\", "\\\\")}"\nregistry = "http://localhost:${server.port}/"\n`;
  writeFileSync(join(dir, "bunfig.toml"), bunfig);
}

test.skipIf(!isLinux)("warns when hardlink falls back to copy on cross-filesystem", async () => {
  using dir = tempDir("crossfs-warn", {
    "package.json": JSON.stringify({ name: "cross-fs-test", dependencies: { "no-deps": "1.0.0" } }),
  });
  const packageDir = String(dir);
  // Cache on tmpfs (/dev/shm) — different filesystem from overlay /tmp
  const cacheDir = join("/dev/shm", `bun-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(cacheDir, { recursive: true });

  try {
    writeBunfig(packageDir, cacheDir);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: cacheDir, BUN_CONFIG_NO_VERIFY: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("falling back to full copy");
    expect(stderr).toContain("--backend=copyfile");
    expect(exitCode).toBe(0);
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test.skipIf(!isLinux)("no warning when --backend=copyfile is explicitly set", async () => {
  using dir = tempDir("crossfs-nowarn", {
    "package.json": JSON.stringify({ name: "cross-fs-nowarn", dependencies: { "no-deps": "1.0.0" } }),
  });
  const packageDir = String(dir);
  const cacheDir = join("/dev/shm", `bun-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(cacheDir, { recursive: true });

  try {
    writeBunfig(packageDir, cacheDir);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--backend", "copyfile"],
      cwd: packageDir,
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: cacheDir, BUN_CONFIG_NO_VERIFY: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("falling back to full copy");
    expect(exitCode).toBe(0);
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});
