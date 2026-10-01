// `bun pm pack`, `bun publish` and `bun pm diff <folder>` read each directory of a package with getdents64(2). A
// read that fails is not the end of the directory. They took it as the end: pack wrote a tarball without the
// files it did not read, printed that short count as `Total files` and exited 0, and publish sent that tarball to
// the registry. They report the read and exit 1, as they do for a directory that does not open.
//
// The short tarball needs a read that fails while the rest of the file system still answers: an error of one
// directory, or a transient one. An LD_PRELOAD library makes that: one chosen read of one directory, by one
// chosen reader, returns -1 with a chosen errno. bun issues getdents64 through libc's syscall(), which is the
// symbol the library interposes.
import { readTarball } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, normalizeBunSnapshot, tempDir } from "harness";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
const canFailDirRead = isLinux && !!cc;

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

static long (*next_syscall)(long, ...);
// A walk of the directory is a "reader". A read at offset 0 starts a new one.
static int reader, read_of_reader;

static int env_int(const char *name, int fallback) {
  const char *value = getenv(name);
  return value ? atoi(value) : fallback;
}

// One line for each read of the directory. A test reads them to know that the library interposed.
static void note(const char *what, long value) {
  const char *log = getenv("DIR_READ_FAULT_LOG");
  if (!log) return;
  char line[96];
  int len = snprintf(line, sizeof line, "reader %d read %d: %s %ld\\n", reader, read_of_reader, what, value);
  int fd = open(log, O_WRONLY | O_APPEND | O_CREAT, 0644);
  if (fd < 0) return;
  if (write(fd, line, len) < 0) {}
  close(fd);
}

static long fail(int code) {
  note("failed", code);
  errno = code;
  return -1;
}

long syscall(long nr, ...) {
  va_list ap;
  va_start(ap, nr);
  long a1 = va_arg(ap, long), a2 = va_arg(ap, long), a3 = va_arg(ap, long);
  long a4 = va_arg(ap, long), a5 = va_arg(ap, long), a6 = va_arg(ap, long);
  va_end(ap);
  if (!next_syscall) next_syscall = dlsym(RTLD_NEXT, "syscall");

  const char *dir = nr == SYS_getdents64 ? getenv("DIR_READ_FAULT_DIR") : NULL;
  char path[PATH_MAX];
  if (dir) {
    char link[64];
    snprintf(link, sizeof link, "/proc/self/fd/%d", (int)a1);
    ssize_t n = readlink(link, path, sizeof path - 1);
    if (n <= 0) dir = NULL;
    else {
      path[n] = 0;
      if (strcmp(path, dir) != 0) dir = NULL;
    }
  }
  if (!dir) return next_syscall(nr, a1, a2, a3, a4, a5, a6);

  if (lseek((int)a1, 0, SEEK_CUR) == 0) {
    reader++;
    read_of_reader = 0;
  }
  read_of_reader++;

  // DIR_READ_FAULT_READ is a number (that read of the reader fails) or "end" (the read that reports the end of
  // the directory fails in its place). DIR_READ_FAULT_ERRNO is the errno, or "removed": the library removes the
  // empty directory and the kernel fails the read.
  const char *when = reader == env_int("DIR_READ_FAULT_READER", 1) ? getenv("DIR_READ_FAULT_READ") : NULL;
  const char *code = getenv("DIR_READ_FAULT_ERRNO");
  int removed = code && strcmp(code, "removed") == 0;
  int injected = code && !removed ? atoi(code) : EIO;
  if (when && atoi(when) == read_of_reader) {
    if (!removed) return fail(injected);
    rmdir(path);
  }
  long rc = next_syscall(nr, a1, a2, a3, a4, a5, a6);
  int answered = errno;
  if (when && strcmp(when, "end") == 0 && rc == 0) return fail(injected);
  note(rc < 0 ? "failed" : "ok", rc < 0 ? answered : rc);
  errno = answered;
  return rc;
}
`;

let shimDir: ReturnType<typeof tempDir> | undefined;
let shim: string;
let logs = 0;

beforeAll(async () => {
  if (!canFailDirRead) return;
  shimDir = tempDir("dir-read-fault", { "shim.c": SHIM_C });
  shim = join(String(shimDir), "shim.so");
  await using compile = Bun.spawn({
    cmd: [cc!, "-shared", "-fPIC", "-o", shim, join(String(shimDir), "shim.c"), "-ldl"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([compile.stdout.text(), compile.stderr.text(), compile.exited]);
  if (exitCode !== 0) throw new Error(`failed to compile the shim:\n${stdout}${stderr}`);
});

afterAll(() => {
  shimDir?.[Symbol.dispose]();
});

type Fault = {
  /** The directory whose read fails. */
  dir: string;
  /**
   * Which read of the directory fails, counted from 1 for each reader. "end" is the read that reports the end of
   * the directory. Leave it out for a run in which no read fails.
   */
  read?: number | "end";
  /** Which walk of the directory, counted from 1 in the process. A walk starts with a read at offset 0. */
  reader?: number;
  /** "removed": the directory, which is empty, is removed before the read and the kernel answers ENOENT. */
  errno?: "EIO" | "removed";
};

/** The environment of a bun process in which the read fails, and the reads of the directory that the process made. */
function failDirRead(fault: Fault) {
  const log = join(String(shimDir), `reads-${logs++}.log`);
  const preload = bunEnv.LD_PRELOAD;
  return {
    env: {
      ...bunEnv,
      LD_PRELOAD: preload ? `${shim}:${preload}` : shim,
      // The library compares with the link in /proc/self/fd, which is the real path.
      DIR_READ_FAULT_DIR: realpathSync(fault.dir),
      DIR_READ_FAULT_READ: fault.read === undefined ? undefined : String(fault.read),
      DIR_READ_FAULT_READER: String(fault.reader ?? 1),
      DIR_READ_FAULT_ERRNO: fault.errno === "removed" ? "removed" : String(constants.errno.EIO),
      DIR_READ_FAULT_LOG: log,
    },
    /** `ok`: the byte count of each read that the kernel answered (0 is the end). `failed`: the errno of each read that failed. */
    reads() {
      const reads = { ok: [] as number[], failed: [] as number[] };
      if (!existsSync(log)) return reads;
      for (const line of readFileSync(log, "utf8").split("\n")) {
        const match = line.match(/: (ok|failed) (-?\d+)$/);
        if (match) reads[match[1] as "ok" | "failed"].push(Number(match[2]));
      }
      return reads;
    },
  };
}

async function bun(args: string[], cwd: string, env: Record<string, string | undefined>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out: normalizeBunSnapshot(stdout, cwd), err: normalizeBunSnapshot(stderr, cwd), exitCode };
}

const names = (dir: string) => readdirSync(dir).sort();

const tarballEntries = (tarball: string) =>
  readTarball(tarball)
    .entries.map(entry => entry.pathname)
    .sort();

const readFailed = (subpath: string) =>
  `EIO: Input/output error: failed to read directory "${subpath}" for packing (getdents64)`;

describe.skipIf(!canFailDirRead)("bun pm pack, a directory read fails", () => {
  const index = "module.exports = 1;";
  test.concurrent.each([
    // One row for each loop that reads a directory. `dir` is the directory whose first read fails.
    { walk: "the default walk, a subdirectory", packageJson: {}, files: { "lib/index.js": index }, dir: "lib" },
    // The resolver reads the package root before pack does: pack is the second reader.
    { walk: "the default walk, the package root", packageJson: {}, files: { "index.js": index }, dir: "", reader: 2 },
    {
      walk: '"files" with a directory',
      packageJson: { files: ["lib"] },
      files: { "lib/index.js": index },
      dir: "lib",
    },
    {
      walk: '"files" with a glob',
      packageJson: { files: ["lib/*.js"] },
      files: { "lib/index.js": index },
      dir: "lib",
    },
    // npm does not read a directory that no "files" pattern names. pack reads every directory, and cannot know
    // that the entries it did not read match nothing.
    {
      walk: '"files", a directory that no pattern names',
      packageJson: { files: ["lib"] },
      files: { "lib/index.js": index, "other/index.js": index },
      dir: "other",
    },
    {
      walk: "bundledDependencies, node_modules",
      packageJson: { bundledDependencies: ["dep"] },
      files: { "node_modules/dep/package.json": "{}" },
      dir: "node_modules",
    },
    {
      walk: "bundledDependencies, a scope directory",
      packageJson: { bundledDependencies: ["@scope/dep"] },
      files: { "node_modules/@scope/dep/package.json": "{}" },
      dir: "node_modules/@scope",
    },
    {
      walk: "bundledDependencies, the dependency",
      packageJson: { bundledDependencies: ["dep"] },
      files: { "node_modules/dep/package.json": "{}" },
      dir: "node_modules/dep",
    },
    // Every entry was read when this read fails. pack cannot know that.
    {
      walk: "the read that reports the end of the directory",
      packageJson: {},
      files: { "lib/index.js": index },
      dir: "lib",
      read: "end" as const,
    },
    { walk: "--dry-run", packageJson: {}, files: { "lib/index.js": index }, dir: "lib", args: ["--dry-run"] },
  ])("$walk", async ({ packageJson, files, dir: subpath, reader, read = 1, args = [] }) => {
    using dir = tempDir("pack-read-fails", {
      "package.json": JSON.stringify({ name: "pack-read-fails", version: "1.0.0", ...packageJson }),
      ...files,
    });
    const before = names(dir);
    const fault = failDirRead({ dir: join(dir, subpath), read, reader });

    const { out, err, exitCode } = await bun(["pm", "pack", ...args], dir, fault.env);
    // If no read failed, the library did not interpose and this row shows nothing.
    expect(fault.reads().failed).toHaveLength(1);
    expect(err).toBe(readFailed(subpath || "<dir>"));
    expect(out).toBe("bun pack <version> (<revision>)");
    expect(names(dir)).toEqual(before);
    expect(exitCode).toBe(1);
  });

  test.concurrent("the second read of a directory of 300 files", async () => {
    // Before: a tarball with 255 of the 301 files, `Total files: 255`, exit 0.
    using dir = tempDir("pack-read-fails-300", {
      "package.json": JSON.stringify({ name: "pack-read-fails-300", version: "1.0.0" }),
      ...Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`lib/big/f${i}.js`, `${i}`])),
    });
    const fault = failDirRead({ dir: join(dir, "lib", "big"), read: 2 });

    const { out, err, exitCode } = await bun(["pm", "pack"], dir, fault.env);
    expect(fault.reads()).toEqual({ ok: [expect.any(Number)], failed: [constants.errno.EIO] });
    expect(err).toBe(readFailed("lib/big"));
    expect(out).toBe("bun pack <version> (<revision>)");
    expect(names(dir)).toEqual(["lib", "package.json"]);
    expect(exitCode).toBe(1);
  });

  // pack opens a directory when its parent lists it and reads it later. A directory that is removed in between
  // fails the read with ENOENT. That is an error too: pack cannot tell a directory that is gone from one that a
  // build replaced at the same path, whose files it would leave out.
  test.concurrent("a directory that is removed after pack opened it", async () => {
    using dir = tempDir("pack-read-removed", {
      "package.json": JSON.stringify({ name: "pack-read-removed", version: "1.0.0" }),
      "lib/index.js": "module.exports = 1;",
      "lib/gone": {},
    });
    const fault = failDirRead({ dir: join(dir, "lib", "gone"), read: 1, errno: "removed" });

    const { out, err, exitCode } = await bun(["pm", "pack"], dir, fault.env);
    expect(fault.reads()).toEqual({ ok: [], failed: [constants.errno.ENOENT] });
    expect(err).toBe(`ENOENT: No such file or directory: failed to read directory "lib/gone" for packing (getdents64)`);
    expect(out).toBe("bun pack <version> (<revision>)");
    expect({ root: names(dir), lib: names(join(dir, "lib")) }).toEqual({
      root: ["lib", "package.json"],
      lib: ["index.js"],
    });
    expect(exitCode).toBe(1);
  });

  test.concurrent("postpack does not run", async () => {
    using dir = tempDir("pack-read-fails-scripts", {
      "package.json": JSON.stringify({
        name: "pack-read-fails-scripts",
        version: "1.0.0",
        scripts: { prepack: "touch prepack.txt", postpack: "touch postpack.txt" },
      }),
      "lib/index.js": "module.exports = 1;",
    });
    const fault = failDirRead({ dir: join(dir, "lib"), read: 1 });

    const { out, err, exitCode } = await bun(["pm", "pack"], dir, fault.env);
    expect(fault.reads().failed).toHaveLength(1);
    expect(err.split("\n")).toEqual(["$ touch prepack.txt", readFailed("lib")]);
    expect(out).toBe("bun pack <version> (<revision>)");
    expect(names(dir)).toEqual(["lib", "package.json", "prepack.txt"]);
    expect(exitCode).toBe(1);
  });

  test.concurrent("no read fails: the library changes nothing", async () => {
    using dir = tempDir("pack-read-healthy", {
      "package.json": JSON.stringify({ name: "pack-read-healthy", version: "1.0.0" }),
      "lib/index.js": "module.exports = 1;",
    });
    const fault = failDirRead({ dir: join(dir, "lib") });

    const { out, err, exitCode } = await bun(["pm", "pack"], dir, fault.env);
    // One read with the entries, then the end of the directory.
    expect(fault.reads()).toEqual({ ok: [expect.any(Number), 0], failed: [] });
    expect(err).toBe("");
    expect(out).toContain("Total files: 2");
    expect(exitCode).toBe(0);
    expect(tarballEntries(join(dir, "pack-read-healthy-1.0.0.tgz"))).toEqual([
      "package/lib/index.js",
      "package/package.json",
    ]);
  });
});

// A registry that keeps the publish requests it receives.
function recordingRegistry() {
  const published: any[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.method === "PUT") published.push(await req.json());
      return new Response("OK", { status: 200 });
    },
  });
  return {
    published,
    bunfig: Bun.TOML.stringify({
      install: { cache: false, registry: { url: `http://localhost:${server.port}`, token: "unused" } },
    }),
    [Symbol.dispose]: () => void server.stop(true),
  };
}

describe.skipIf(!canFailDirRead)("bun publish, a directory read fails", () => {
  test.concurrent("the walk of the package", async () => {
    using registry = recordingRegistry();
    using dir = tempDir("publish-read-fails", {
      "package.json": JSON.stringify({ name: "publish-read-fails", version: "1.0.0" }),
      "bunfig.toml": registry.bunfig,
      "lib/index.js": "module.exports = 1;",
    });
    const before = names(dir);
    const fault = failDirRead({ dir: join(dir, "lib"), read: 1 });

    const { out, err, exitCode } = await bun(["publish"], dir, fault.env);
    expect(fault.reads().failed).toHaveLength(1);
    expect(err).toBe(readFailed("lib"));
    expect(out).toBe("bun publish <version> (<revision>)");
    expect(registry.published).toEqual([]);
    expect(names(dir)).toEqual(before);
    expect(exitCode).toBe(1);
  });

  // `directories.bin` is read twice: the walk packs its files, then publish lists them as the `bin` entries of
  // the manifest. Before: the registry received a manifest without the entries that the second read did not
  // return.
  test.concurrent("the `bin` entries of directories.bin", async () => {
    using registry = recordingRegistry();
    using dir = tempDir("publish-bin-read-fails", {
      "package.json": JSON.stringify({
        name: "publish-bin-read-fails",
        version: "1.0.0",
        directories: { bin: "bin" },
      }),
      "bunfig.toml": registry.bunfig,
      "bin/cli.js": "#!/usr/bin/env node",
    });
    const fault = failDirRead({ dir: join(dir, "bin"), read: 1, reader: 2 });

    const { err, exitCode } = await bun(["publish"], dir, fault.env);
    expect(fault.reads().failed).toHaveLength(1);
    expect(err).toBe(`EIO: Input/output error: failed to read bin directory: 'bin' (getdents64)`);
    expect(registry.published).toEqual([]);
    expect(exitCode).toBe(1);
  });

  test.concurrent("the `bin` entries of directories.bin, publish of a tarball", async () => {
    using registry = recordingRegistry();
    using dir = tempDir("publish-tarball-bin-read-fails", {
      "package.json": JSON.stringify({
        name: "publish-tarball-bin-read-fails",
        version: "1.0.0",
        directories: { bin: "bin" },
      }),
      "bin/cli.js": "#!/usr/bin/env node",
    });
    const packed = await bun(["pm", "pack", "--quiet"], dir, bunEnv);
    expect(packed).toEqual({ out: "publish-tarball-bin-read-fails-1.0.0.tgz", err: "", exitCode: 0 });
    await Bun.write(join(dir, "bunfig.toml"), registry.bunfig);
    const before = names(dir);
    const fault = failDirRead({ dir: join(dir, "bin"), read: 1 });

    const { err, exitCode } = await bun(["publish", "./publish-tarball-bin-read-fails-1.0.0.tgz"], dir, fault.env);
    expect(fault.reads().failed).toHaveLength(1);
    expect(err).toBe(`EIO: Input/output error: failed to read bin directory: 'bin' (getdents64)`);
    expect(registry.published).toEqual([]);
    expect(names(dir)).toEqual(before);
    expect(exitCode).toBe(1);
  });

  // The README is optional registry metadata. npm publishes without it when its scan fails, and so does bun.
  test.concurrent("the README scan: the package is published without a readme", async () => {
    using registry = recordingRegistry();
    using dir = tempDir("publish-readme-read-fails", {
      "package.json": JSON.stringify({ name: "publish-readme-read-fails", version: "1.0.0" }),
      "bunfig.toml": registry.bunfig,
      "README.md": "# publish-readme-read-fails",
      "lib/index.js": "module.exports = 1;",
    });
    // The resolver reads the package root first, then the README scan.
    const fault = failDirRead({ dir: String(dir), read: 1, reader: 2 });

    const { err, exitCode } = await bun(["publish"], dir, fault.env);
    expect(fault.reads().failed).toHaveLength(1);
    expect(err).toBe("");
    expect(exitCode).toBe(0);

    expect(registry.published).toHaveLength(1);
    const [manifest] = registry.published;
    expect(manifest.versions["1.0.0"].readme).toBeUndefined();
    const tarball = join(dir, "received.tgz");
    await Bun.write(tarball, Buffer.from(manifest._attachments["publish-readme-read-fails-1.0.0.tgz"].data, "base64"));
    expect(tarballEntries(tarball)).toEqual(["package/README.md", "package/lib/index.js", "package/package.json"]);
  });
});

// A folder with a package.json is read as `bun pm pack` would publish it. The diff listed the files it did not
// read as added or removed and exited 0.
test.concurrent.skipIf(!canFailDirRead)("bun pm diff, a directory read fails: a folder", async () => {
  using dir = tempDir("pm-diff-read-fails", {
    "a/package.json": JSON.stringify({ name: "p", version: "1.0.0" }),
    "a/lib/index.js": "module.exports = 1;\n",
    "b/package.json": JSON.stringify({ name: "p", version: "1.0.0" }),
    "b/lib/index.js": "module.exports = 1;\n",
  });
  const fault = failDirRead({ dir: join(dir, "a", "lib"), read: 1 });

  const { out, err, exitCode } = await bun(["pm", "diff", "./a", "./b", "--name-only"], dir, {
    ...fault.env,
    NO_COLOR: "1",
  });
  expect(fault.reads().failed).toHaveLength(1);
  expect(err).toBe(readFailed("lib"));
  expect(out).toBe("");
  expect(exitCode).toBe(1);
});
