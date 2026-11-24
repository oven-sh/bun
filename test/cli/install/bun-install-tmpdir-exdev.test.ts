// `bun install` checks whether $TMPDIR and the install cache are on the same
// filesystem by creating an empty `.<hex>-N.hm` probe in $TMPDIR and
// renaming it into the cache. When the rename fails with EXDEV, bun falls
// back to `<cache>/.tmp`; the probe it created in $TMPDIR must not be left
// behind. Forcing EXDEV needs a writable mount on a different device from
// the harness temp dir (/dev/shm on Linux).
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix, tempDir } from "harness";
import { accessSync, constants, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
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

// Every rename of a `.hm` file is recorded in $PROBE_RENAME_LOG and takes 150ms longer.
const stallShim = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static void stall(const char *from) {
  size_t len = strlen(from);
  if (len < 3 || strcmp(from + len - 3, ".hm") != 0) return;
  int fd = open(getenv("PROBE_RENAME_LOG"), O_WRONLY | O_CREAT | O_APPEND, 0644);
  if (fd >= 0) {
    if (write(fd, "rename\\n", 7) != 7) abort();
    close(fd);
  }
  struct timespec left = {0, 150 * 1000 * 1000};
  while (nanosleep(&left, &left) != 0) {}
}

int rename(const char *from, const char *to) {
  static int (*real)(const char *, const char *);
  if (!real) real = dlsym(RTLD_NEXT, "rename");
  stall(from);
  return real(from, to);
}

int renameat(int fromfd, const char *from, int tofd, const char *to) {
  static int (*real)(int, const char *, int, const char *);
  if (!real) real = dlsym(RTLD_NEXT, "renameat");
  stall(from);
  return real(fromfd, from, tofd, to);
}

int renameat2(int fromfd, const char *from, int tofd, const char *to, unsigned flags) {
  static int (*real)(int, const char *, int, const char *, unsigned);
  if (!real) real = dlsym(RTLD_NEXT, "renameat2");
  stall(from);
  return real(fromfd, from, tofd, to, flags);
}
`;
const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

describe.skipIf(!isLinux || !cc)("a probe whose renames take a long time", () => {
  /** Runs `bun install` with the shim. `$TMPDIR` is a new directory in `tmpParent`, or else in the project. */
  async function install(tmpParent?: string) {
    using dir = tempDir("install-tmpdir-stall", {
      "shim.c": stallShim,
      "package.json": JSON.stringify({
        name: "app",
        dependencies: { localdep: "file:./localdep" },
      }),
      "localdep/package.json": JSON.stringify({ name: "localdep", version: "1.0.0" }),
    });
    {
      await using compile = Bun.spawn({
        cmd: [cc!, "-shared", "-fPIC", "-o", "shim.so", "shim.c", "-ldl"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([compile.stderr.text(), compile.exited]);
      expect(exitCode, stderr).toBe(0);
    }
    const log = join(String(dir), "renames.log");
    const tmp = mkdtempSync(join(tmpParent ?? String(dir), "bun-install-stall-"));

    try {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: String(dir),
        env: {
          ...bunEnv,
          BUN_INSTALL_CACHE_DIR: join(String(dir), "cache"),
          BUN_TMPDIR: tmp,
          TMPDIR: tmp,
          PROBE_RENAME_LOG: log,
          LD_PRELOAD: [join(String(dir), "shim.so"), bunEnv.LD_PRELOAD].filter(Boolean).join(":"),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode, renames: readFileSync(log, "utf8") };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  test("$TMPDIR on the filesystem of the cache: the install prints what it always prints", async () => {
    const { stdout, stderr, exitCode, renames } = await install();
    expect({ stderr, renames }).toEqual({ stderr: "Saved lockfile\n", renames: "rename\n" });
    expect(stdout).toContain("1 package installed");
    expect(exitCode).toBe(0);
  });

  test.skipIf(!crossDeviceDir)(
    "$TMPDIR on a different filesystem than the cache: the install prints what it always prints",
    async () => {
      const { stdout, stderr, exitCode, renames } = await install(crossDeviceDir);
      expect({ stderr, renames }).toEqual({ stderr: "Saved lockfile\n", renames: "rename\nrename\n" });
      expect(stdout).toContain("1 package installed");
      expect(exitCode).toBe(0);
    },
  );
});
