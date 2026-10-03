// A read of a package's `directories.bin` folder can fail after the folder was
// opened (EIO from a failing disk, a network filesystem or FUSE). The bin
// linker took that error for the end of the folder: `bun install` and
// `bun link` reported success with some or none of the bins linked, and
// `bun unlink` reported success with links left behind.
//
// bun reads a folder with getdents64 through libc's syscall(), so an
// LD_PRELOAD shim can fail one chosen read. glibc only: bun-musl is statically
// linked.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isGlibc, isWindows, tempDir } from "harness";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// BIN_DIR_FAULT_SUFFIX  the reads of a folder whose path ends with this are counted.
// BIN_DIR_FAULT_READ    "1", "2", ...: that read of each open of the folder fails with EIO.
//                       "end": the read that would report the end of the folder fails with EIO.
//                       "none": no read fails.
// BIN_DIR_FAULT_LOG     one line for each counted read: "<index> ok" or "<index> EIO".
const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

#define MAX_FD 65536

static long (*next_syscall)(long, ...);
static unsigned char reads[MAX_FD];

static void note(int index, const char *result) {
  const char *path = getenv("BIN_DIR_FAULT_LOG");
  if (!path) return;
  int log = open(path, O_WRONLY | O_CREAT | O_APPEND, 0644);
  if (log < 0) return;
  char line[32];
  int len = snprintf(line, sizeof line, "%d %s\\n", index, result);
  if (write(log, line, len) != len) abort();
  close(log);
}

static int is_watched(int fd) {
  const char *suffix = getenv("BIN_DIR_FAULT_SUFFIX");
  if (!suffix || fd < 0 || fd >= MAX_FD) return 0;
  char link[64], target[PATH_MAX];
  snprintf(link, sizeof link, "/proc/self/fd/%d", fd);
  ssize_t len = readlink(link, target, sizeof target);
  size_t suffix_len = strlen(suffix);
  return len >= (ssize_t)suffix_len && memcmp(target + len - suffix_len, suffix, suffix_len) == 0;
}

long syscall(long nr, ...) {
  va_list ap;
  va_start(ap, nr);
  long a1 = va_arg(ap, long), a2 = va_arg(ap, long), a3 = va_arg(ap, long);
  long a4 = va_arg(ap, long), a5 = va_arg(ap, long), a6 = va_arg(ap, long);
  va_end(ap);
  if (!next_syscall) next_syscall = (long (*)(long, ...))dlsym(RTLD_NEXT, "syscall");

  const char *fail = getenv("BIN_DIR_FAULT_READ");
  int fd = (int)a1;
  if (nr != SYS_getdents64 || !fail || !is_watched(fd)) {
    return next_syscall(nr, a1, a2, a3, a4, a5, a6);
  }

  // The offset of a folder that was just opened is 0: this is a new reader.
  if (lseek(fd, 0, SEEK_CUR) == 0) reads[fd] = 0;
  int index = ++reads[fd];

  if (strcmp(fail, "end") == 0) {
    long rc = next_syscall(nr, a1, a2, a3, a4, a5, a6);
    if (rc != 0) {
      note(index, "ok");
      return rc;
    }
  } else if (index != atoi(fail)) {
    note(index, "ok");
    return next_syscall(nr, a1, a2, a3, a4, a5, a6);
  }
  note(index, "EIO");
  errno = EIO;
  return -1;
}
`;

// One read returns at most 8192 bytes of entries and an entry with a name of
// 8 bytes takes 32, so 300 entries need at least two reads before the read
// that reports the end.
const binNames = Array.from({ length: 300 }, (_, i) => `tool-${String(i).padStart(3, "0")}`);
const binFiles = Object.fromEntries(binNames.map(name => [name, "#!/bin/sh\n"]));

let shimDir: ReturnType<typeof tempDir> | undefined;
let shimPath: string;

beforeAll(async () => {
  if (!isGlibc || !cc) return;
  shimDir = tempDir("bin-dir-read-error-shim", { "shim.c": SHIM_C });
  shimPath = join(String(shimDir), "shim.so");
  await using compile = Bun.spawn({
    cmd: [cc, "-shared", "-fPIC", "-o", shimPath, join(String(shimDir), "shim.c"), "-ldl"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, exitCode] = await Promise.all([compile.stdout.text(), compile.stderr.text(), compile.exited]);
  if (exitCode !== 0) throw new Error(`shim compile failed: ${err || out}`);
});

afterAll(() => {
  shimDir?.[Symbol.dispose]();
});

type Fault = "1" | "2" | "end" | "none";

/** Runs bun. With `shim`, the reads of the folder whose path ends with `shim.suffix` are counted and `shim.fault` fails. */
async function run(args: string[], cwd: string, root: string, shim?: { suffix: string; fault: Fault }) {
  const log = join(root, `reads-${args[0]}-${shim?.fault}.log`);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: join(root, "cache"),
      BUN_INSTALL: join(root, "bun-install"),
      BUN_INSTALL_GLOBAL_DIR: join(root, "global"),
      BUN_INSTALL_BIN: join(root, "global-bin"),
      ...(shim && {
        LD_PRELOAD: bunEnv.LD_PRELOAD ? `${shimPath}:${bunEnv.LD_PRELOAD}` : shimPath,
        BIN_DIR_FAULT_SUFFIX: shim.suffix,
        BIN_DIR_FAULT_READ: shim.fault,
        BIN_DIR_FAULT_LOG: log,
      }),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const reads = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
  return { stdout, stderr, exitCode, reads };
}

const linkCount = (dir: string) => (existsSync(dir) ? readdirSync(dir).length : 0);

// `bun link` registers the package in the global node_modules and links its
// bins into the global bin folder. `bun unlink` removes both.
function linkedPackage(binDir: string, files: Record<string, string | Record<string, string>>) {
  const dir = tempDir("bin-dir-read-error-link", {
    "linked-pkg": {
      "package.json": JSON.stringify({ name: "linked-pkg", version: "1.0.0", directories: { bin: binDir } }),
      ...files,
    },
  });
  const root = String(dir);
  return {
    dir,
    root,
    cwd: join(root, "linked-pkg"),
    globalBin: join(root, "global-bin"),
    registered: () => lstatSync(join(root, "global", "node_modules", "linked-pkg"), { throwIfNoEntry: false }) != null,
  };
}

describe.skipIf(!isGlibc || !cc)("a read of a `directories.bin` folder fails", () => {
  describe.each(["hoisted", "isolated"] as const)("bun install --linker %s", linker => {
    const error =
      linker === "hoisted" ? "error: Failed to link dep: EIO" : "EIO: failed to link binaries for package: dep@dep";

    async function install(fault: Fault, ...flags: string[]) {
      const dir = tempDir(`bin-dir-read-error-${linker}`, {
        "package.json": JSON.stringify({ name: "root", version: "1.0.0", dependencies: { dep: "file:./dep" } }),
        dep: {
          "package.json": JSON.stringify({ name: "dep", version: "1.0.0", directories: { bin: "bin" } }),
          bin: binFiles,
        },
      });
      const root = String(dir);
      const shim = { suffix: "/node_modules/dep/bin", fault };
      const result = await run(["install", "--linker", linker, ...flags], root, root, shim);
      return { dir, ...result, links: linkCount(join(root, "node_modules", ".bin")) };
    }

    test.concurrent("no read fails: every bin is linked", async () => {
      const { dir, stdout, stderr, exitCode, reads, links } = await install("none");
      using _ = dir;
      expect(stderr).not.toContain("EIO");
      expect(stdout).toContain("1 package installed");
      expect(links).toBe(binNames.length);
      expect(reads.length).toBeGreaterThanOrEqual(3);
      expect(reads.filter(line => !line.endsWith(" ok"))).toEqual([]);
      expect(exitCode).toBe(0);
    });

    test.concurrent("the first read fails: the install fails and links nothing", async () => {
      const { dir, stdout, stderr, exitCode, reads, links } = await install("1");
      using _ = dir;
      expect(reads).toContain("1 EIO");
      expect(stderr).toContain(error);
      expect(stdout).not.toContain("package installed");
      expect(links).toBe(0);
      expect(exitCode).toBe(1);
    });

    test.concurrent("the second read fails: the install fails", async () => {
      const { dir, stdout, stderr, exitCode, reads, links } = await install("2");
      using _ = dir;
      expect(reads).toContain("2 EIO");
      expect(stderr).toContain(error);
      expect(stdout).not.toContain("package installed");
      // The bins of the first read are linked before the second read fails.
      expect(links).toBeGreaterThan(0);
      expect(links).toBeLessThan(binNames.length);
      expect(exitCode).toBe(1);
    });

    test.concurrent("the read that reports the end fails: the install fails", async () => {
      const { dir, stdout, stderr, exitCode, reads, links } = await install("end");
      using _ = dir;
      expect(reads.filter(line => line.endsWith(" EIO")).length).toBeGreaterThan(0);
      expect(stderr).toContain(error);
      expect(stdout).not.toContain("package installed");
      expect(links).toBe(binNames.length);
      expect(exitCode).toBe(1);
    });

    test.concurrent("--silent: the install fails", async () => {
      const { dir, stdout, exitCode, reads } = await install("1", "--silent");
      using _ = dir;
      expect(reads).toContain("1 EIO");
      expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
    });
  });

  const shim = (fault: Fault) => ({ suffix: "/linked-pkg/bin", fault });

  test.concurrent.each(["1", "2"] as const)("bun link: read %s fails, the command fails", async fault => {
    const { dir, root, cwd, globalBin } = linkedPackage("bin", { bin: binFiles });
    using _ = dir;
    const { stdout, stderr, exitCode, reads } = await run(["link"], cwd, root, shim(fault));
    expect(reads).toContain(`${fault} EIO`);
    expect(stderr).toContain("error: failed to link bin due to error EIO");
    expect(stdout).not.toContain("Success!");
    expect(linkCount(globalBin)).toBeLessThan(binNames.length);
    expect(exitCode).toBe(1);
  });

  test.concurrent.each(["1", "2"] as const)(
    "bun unlink: read %s fails, the command fails and a second run removes every link",
    async fault => {
      const { dir, root, cwd, globalBin, registered } = linkedPackage("bin", { bin: binFiles });
      using _ = dir;

      const linked = await run(["link"], cwd, root, shim("none"));
      expect(linked.stdout).toContain(`Success! Registered "linked-pkg"`);
      expect(linkCount(globalBin)).toBe(binNames.length);
      expect(linked.exitCode).toBe(0);

      const failed = await run(["unlink"], cwd, root, shim(fault));
      expect(failed.reads).toContain(`${fault} EIO`);
      expect(failed.stderr).toContain("error: failed to unlink bin due to error EIO");
      expect(failed.stdout).not.toContain("success:");
      // The package stays registered, so the command can run again.
      expect(registered()).toBe(true);
      expect(failed.exitCode).toBe(1);

      const again = await run(["unlink"], cwd, root, shim("none"));
      expect(again.stderr).not.toContain("error:");
      expect(again.stdout).toContain(`success: unlinked package "linked-pkg"`);
      expect(linkCount(globalBin)).toBe(0);
      expect(registered()).toBe(false);
      expect(again.exitCode).toBe(0);
    },
  );
});

// `bun link` makes no link from a `directories.bin` path that it cannot open as
// a folder, and still registers the package. `bun unlink` has nothing to
// remove from the bin folder then, and must unregister the package.
describe.skipIf(isWindows)("bun unlink when `directories.bin` is not a folder", () => {
  test.concurrent.each([
    ["a path that does not exist", "bin", {}, `Success! Registered "linked-pkg"`, 0],
    ["a regular file", "bin", { bin: "not a folder" }, "error: failed to link bin due to error ENOTDIR", 1],
    [
      "a name longer than a file name can be",
      Buffer.alloc(300, "b").toString(),
      {},
      "error: failed to link bin due to error ENAMETOOLONG",
      1,
    ],
  ] as const)("%s", async (_what, binDir, files, linkOutput, linkExitCode) => {
    const { dir, root, cwd, globalBin, registered } = linkedPackage(binDir, files);
    using _ = dir;

    const linked = await run(["link"], cwd, root);
    expect(linked.stdout + linked.stderr).toContain(linkOutput);
    expect(registered()).toBe(true);
    expect(linked.exitCode).toBe(linkExitCode);

    const unlinked = await run(["unlink"], cwd, root);
    expect(unlinked.stderr).not.toContain("error:");
    expect(unlinked.stdout).toContain(`success: unlinked package "linked-pkg"`);
    expect(linkCount(globalBin)).toBe(0);
    expect(registered()).toBe(false);
    expect(unlinked.exitCode).toBe(0);
  });
});
