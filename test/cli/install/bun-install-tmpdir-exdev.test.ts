// `bun install` checks whether $TMPDIR and the install cache are on the same
// filesystem by creating an empty `.<hex>-N.hm` probe in $TMPDIR and
// renaming it into the cache. When the rename fails with EXDEV, bun falls
// back to `<cache>/.tmp`; the probe it created in $TMPDIR must not be left
// behind. Forcing EXDEV needs a writable mount on a different device from
// the harness temp dir (/dev/shm on Linux).
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import { accessSync, constants, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function findCrossDeviceDir(): string | undefined {
  if (!isPosix) return undefined;
  const refDev = statSync(tmpdir()).dev;
  for (const candidate of ["/dev/shm", "/tmp"]) {
    try {
      if (statSync(candidate).dev === refDev) continue;
      accessSync(candidate, constants.W_OK | constants.X_OK);
      return candidate;
    } catch {}
  }
  return undefined;
}

const crossDeviceDir = findCrossDeviceDir();

test.skipIf(!crossDeviceDir)(
  "leaves nothing in $TMPDIR when it is on a different filesystem than the cache",
  async () => {
    using dir = tempDir("install-tmpdir-exdev", {
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { localdep: "file:./localdep" },
      }),
      "localdep/package.json": JSON.stringify({ name: "localdep", version: "1.0.0" }),
    });
    const cache = join(String(dir), "cache");
    const tmp = mkdtempSync(join(crossDeviceDir!, "bun-install-exdev-"));

    try {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: String(dir),
        env: {
          ...bunEnv,
          BUN_INSTALL_CACHE_DIR: cache,
          BUN_TMPDIR: tmp,
          TMPDIR: tmp,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("error:");
      expect(stdout).toContain("1 package installed");
      expect(exitCode).toBe(0);

      // The cross-device rename failed, so bun switched to <cache>/.tmp ...
      expect(existsSync(join(cache, ".tmp"))).toBe(true);
      // ... and must have removed the probe it had created in $TMPDIR first.
      expect(readdirSync(tmp)).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  },
);
