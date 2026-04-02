import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { tmpdir } from "os";
import { join } from "path";

// Serve a minimal registry with a single package (no-deps@1.0.0)
const tgzPath = join(
  import.meta.dir,
  "..",
  "..",
  "cli",
  "install",
  "registry",
  "packages",
  "no-deps",
  "no-deps-1.0.0.tgz",
);
const tgzData = readFileSync(tgzPath);

// Check that /dev/shm and the temp directory are on different devices.
// If they're on the same device, hardlinks would succeed and the warning
// wouldn't trigger, making the test meaningless.
const isCrossDevice = (() => {
  try {
    const shmDev = statSync("/dev/shm").dev;
    const tmpDev = statSync(tmpdir()).dev;
    return shmDev !== tmpDev;
  } catch {
    return false;
  }
})();

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

test.skipIf(!isLinux || !isCrossDevice)("warns when hardlink falls back to copy on cross-filesystem", async () => {
  using dir = tempDir("crossfs-warn", {
    "package.json": JSON.stringify({ name: "cross-fs-test", dependencies: { "no-deps": "1.0.0" } }),
  });
  const packageDir = String(dir);
  // Cache on tmpfs (/dev/shm) — different filesystem from the temp directory
  const cacheDir = join("/dev/shm", `bun-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(cacheDir, { recursive: true });

  try {
    writeBunfig(packageDir, cacheDir);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: cacheDir },
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

test.skipIf(!isLinux || !isCrossDevice)("no warning when --backend is explicitly set", async () => {
  using dir = tempDir("crossfs-nowarn", {
    "package.json": JSON.stringify({ name: "cross-fs-nowarn", dependencies: { "no-deps": "1.0.0" } }),
  });
  const packageDir = String(dir);
  const cacheDir = join("/dev/shm", `bun-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(cacheDir, { recursive: true });

  try {
    writeBunfig(packageDir, cacheDir);

    // Use --backend hardlink so the install still attempts hardlinking,
    // hits the cross-filesystem error, but suppresses the warning because
    // the backend was explicitly chosen.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "--backend", "hardlink"],
      cwd: packageDir,
      env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: cacheDir },
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
