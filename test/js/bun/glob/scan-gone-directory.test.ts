// The walker reads a directory and opens the directories it listed later. One of them can
// be removed, or replaced by a file, in between. The walk continues without it, like Node's
// fs.glob (fast-glob does the same for ENOENT). The directory a walk starts in is not
// skipped, and neither is a directory that fails in another way.
import { Glob } from "bun";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import * as fs from "node:fs";
import * as path from "node:path";

// Linux fails the read of a directory that was removed after it was opened with ENOENT. A
// descriptor keeps such a directory reachable, and /proc/self/fd/<n> names it.
test.skipIf(!isLinux)("a followed link to a directory that was removed after its open is skipped", async () => {
  using dir = tempDir("glob-scan-removed-after-open", {
    "tree/top.txt": "",
    "tree/a/a.txt": "",
    "tree/z/z.txt": "",
  });
  const tree = path.join(String(dir), "tree");
  const removed = path.join(String(dir), "removed");
  fs.mkdirSync(removed);
  const fd = fs.openSync(removed, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try {
    fs.rmdirSync(removed);
    const removedDirectory = `/proc/self/fd/${fd}`;
    fs.symlinkSync(removedDirectory, path.join(tree, "link"));

    for (const throwErrorOnBrokenSymlink of [false, true]) {
      const options = { cwd: tree, followSymlinks: true, throwErrorOnBrokenSymlink };
      expect({
        scanSync: Array.from(new Glob("**/*.txt").scanSync(options)).sort(),
        scan: (await Array.fromAsync(new Glob("**/*.txt").scan(options))).sort(),
      }).toEqual({
        scanSync: ["a/a.txt", "top.txt", "z/z.txt"],
        scan: ["a/a.txt", "top.txt", "z/z.txt"],
      });
    }

    // The directory a walk starts in: the same read error still ends the scan.
    const errorOf = (scan: () => unknown) => {
      try {
        scan();
      } catch (e: any) {
        return { code: e.code, syscall: e.syscall };
      }
    };
    expect({
      cwd: errorOf(() => Array.from(new Glob("*.txt").scanSync({ cwd: removedDirectory }))),
      absolutePattern: errorOf(() => Array.from(new Glob(`${removedDirectory}/*.txt`).scanSync())),
    }).toEqual({
      cwd: { code: "ENOENT", syscall: "getdents64" },
      absolutePattern: { code: "ENOENT", syscall: "getdents64" },
    });
  } finally {
    fs.closeSync(fd);
  }
});

// A concurrent remover is a race, so a shim plays it from inside getdents64(2). Below the
// directory in SCAN_GONE_ROOT it really removes, replaces or renames the directories with
// the names below, and the kernel itself produces the errors. bun issues getdents64 through
// libc's syscall(), which LD_PRELOAD can interpose.
const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
const shimSource = /* c */ `
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

// Removes the sub-directory "name" of the directory that "fd" refers to.
static int remove_child(int fd, const char *name) {
  char file[NAME_MAX];
  snprintf(file, sizeof file, "%s/v.txt", name);
  unlinkat(fd, file, 0);
  snprintf(file, sizeof file, "%s/package.json", name);
  unlinkat(fd, file, 0);
  return unlinkat(fd, name, AT_REMOVEDIR);
}

long syscall(long nr, ...) {
  va_list ap;
  va_start(ap, nr);
  long a1 = va_arg(ap, long), a2 = va_arg(ap, long), a3 = va_arg(ap, long);
  long a4 = va_arg(ap, long), a5 = va_arg(ap, long), a6 = va_arg(ap, long);
  va_end(ap);
  if (!next_syscall) next_syscall = dlsym(RTLD_NEXT, "syscall");
  if (nr != SYS_getdents64) return next_syscall(nr, a1, a2, a3, a4, a5, a6);

  int fd = (int)a1;
  char link[64], target[PATH_MAX];
  snprintf(link, sizeof link, "/proc/self/fd/%d", fd);
  ssize_t n = readlink(link, target, sizeof target - 1);
  const char *root = getenv("SCAN_GONE_ROOT");
  if (n <= 0 || !root) return next_syscall(nr, a1, a2, a3, a4, a5, a6);
  target[n] = 0;
  if (strncmp(target, root, strlen(root)) != 0) return next_syscall(nr, a1, a2, a3, a4, a5, a6);
  const char *base = strrchr(target, '/');
  base = base ? base + 1 : target;

  // Removed after it was opened and before its first read: that read fails with ENOENT.
  if (strcmp(base, "removed-before-read") == 0) rmdir(target);
  // A read that fails in another way.
  if (strcmp(base, "fails-to-read") == 0) {
    errno = EIO;
    return -1;
  }

  long rc = next_syscall(nr, a1, a2, a3, a4, a5, a6);

  if (rc > 0) {
    // This read listed the directory. These children change before anything opens them.
    remove_child(fd, "removed-after-list");
    if (remove_child(fd, "replaced-by-file") == 0)
      close(openat(fd, "replaced-by-file", O_CREAT | O_WRONLY, 0644));
    // A link to itself: the open fails with ELOOP.
    if (remove_child(fd, "replaced-by-loop") == 0) symlinkat("replaced-by-loop", fd, "replaced-by-loop");
    // Removed once a read handed out its entries: the read that would report the end of
    // the directory fails with ENOENT. (After the rmdir the link reads "... (deleted)".)
    if (strcmp(base, "removed-mid-read") == 0) {
      unlinkat(fd, "inner.txt", 0);
      rmdir(target);
    }
  } else if (rc == 0 && strcmp(base, "renamed-after-list") == 0) {
    // The whole directory was listed. It gets another name before anything in it is opened.
    char renamed[PATH_MAX];
    snprintf(renamed, sizeof renamed, "%.*srenamed", (int)(base - target), target);
    rename(target, renamed);
  }
  return rc;
}
`;

let shimDir: ReturnType<typeof tempDir> | undefined;
let shim = "";

beforeAll(async () => {
  if (!isLinux || !cc) return;
  shimDir = tempDir("glob-scan-gone-directory-shim", { "shim.c": shimSource });
  shim = path.join(String(shimDir), "shim.so");
  await using compile = Bun.spawn({
    cmd: [cc, "-shared", "-fPIC", "-o", shim, path.join(String(shimDir), "shim.c"), "-ldl"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, exitCode] = await Promise.all([compile.stderr.text(), compile.exited]);
  if (exitCode !== 0) throw new Error(`Failed to build the shim:\n${output}`);
});

afterAll(() => {
  shimDir?.[Symbol.dispose]();
});

// Runs bun with the shim preloaded. The shim acts below `root` only.
async function runWithShim(args: string[], cwd: string, root: string, env: typeof bunEnv = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: {
      ...bunEnv,
      ...env,
      SCAN_GONE_ROOT: fs.realpathSync(root),
      LD_PRELOAD: bunEnv.LD_PRELOAD ? `${shim}:${bunEnv.LD_PRELOAD}` : shim,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// What the shim does to the directory "parent/<kind>" of a tree. The walk skips the first four.
const gone = ["removed-after-list", "replaced-by-file", "removed-before-read", "removed-mid-read"];
const failing = { "replaced-by-loop": ["ELOOP", "open"], "fails-to-read": ["EIO", "getdents64"] };
const kinds = [...gone, ...Object.keys(failing)];

test.concurrent.skipIf(!isLinux || !cc)("Bun.Glob returns every match that is left", async () => {
  using dir = tempDir("glob-scan-gone-directory", {
    "glob-fixture.js": `
import { Glob } from "bun";
import fs from "node:fs";
import path from "node:path";

const write = (root, files) => {
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), "");
  }
};
// What a scan gave, and what is at the path of the directory the shim acts on afterwards.
const outcome = async (root, marked, scan) => {
  let result;
  try {
    result = (await scan()).map(match => path.relative(root, path.resolve(root, match))).sort();
  } catch (e) {
    result = { code: e.code, syscall: e.syscall };
  }
  const stat = fs.lstatSync(marked, { throwIfNoEntry: false });
  const after = !stat ? "missing" : stat.isDirectory() ? "directory" : stat.isSymbolicLink() ? "link" : "file";
  return { scan: result, after };
};
const styles = {
  "relative": root => ["**/*.txt", { cwd: root }],
  "absolute": root => ["**/*.txt", { cwd: root, absolute: true }],
  "absolute pattern": root => [root + "/**/*.txt", {}],
  "directories": root => ["**", { cwd: root, onlyFiles: false }],
  "dot-dot": root => ["../" + path.basename(root) + "/**/*.txt", { cwd: root }],
};
const modes = {
  scanSync: (pattern, options) => Array.from(new Glob(pattern).scanSync(options)),
  scan: (pattern, options) => Array.fromAsync(new Glob(pattern).scan(options)),
};
// "removed-before-read" is removed with one rmdir, so it is empty.
const inside = {
  "removed-after-list": "v.txt",
  "replaced-by-file": "v.txt",
  "replaced-by-loop": "v.txt",
  "removed-mid-read": "inner.txt",
  "fails-to-read": "v.txt",
};

const out = {};
let trees = 0;
for (const [mode, scan] of Object.entries(modes)) {
  for (const [style, args] of Object.entries(styles)) {
    for (const kind of ${JSON.stringify(kinds)}) {
      const root = path.resolve("tree-" + trees++);
      const marked = path.join(root, "parent", kind);
      write(root, ["top.txt", "keep/k.txt", "parent/p.txt"]);
      fs.mkdirSync(marked);
      if (inside[kind]) fs.writeFileSync(path.join(marked, inside[kind]), "");
      out[[mode, style, kind].join(", ")] = await outcome(root, marked, () => scan(...args(root)));
    }
  }

  // The directory a walk starts in is not skipped.
  let root = path.resolve("tree-" + trees++, "removed-before-read");
  fs.mkdirSync(root, { recursive: true });
  out[mode + ", start removed"] = await outcome(root, root, () => scan("**/*.txt", { cwd: root }));

  // The walk holds a descriptor of the directory it starts in. A directory in it that does
  // not open by its absolute path any more still opens through that descriptor.
  for (const style of ["relative", "absolute", "absolute pattern"]) {
    root = path.resolve("tree-" + trees++, "renamed-after-list");
    write(root, ["top.txt", "keep/k.txt"]);
    out[[mode, "start renamed", style].join(", ")] = await outcome(root, root, () => scan(...styles[style](root)));
  }
}
console.log(JSON.stringify(out));
`,
  });

  const { stdout, stderr, exitCode } = await runWithShim(["glob-fixture.js"], String(dir), String(dir));
  expect(stderr).toBe("");

  const expected: Record<string, { scan: unknown; after: string }> = {};
  for (const mode of ["scanSync", "scan"]) {
    for (const style of ["relative", "absolute", "absolute pattern", "directories", "dot-dot"]) {
      for (const kind of gone) {
        const matches = ["top.txt", "keep/k.txt", "parent/p.txt"];
        // Its first read listed this file. The directory was removed after that.
        if (kind === "removed-mid-read") matches.push("parent/removed-mid-read/inner.txt");
        // The listing of "parent" reported the directory, so it is a match itself.
        if (style === "directories") matches.push("keep", "parent", `parent/${kind}`);
        expected[`${mode}, ${style}, ${kind}`] = {
          scan: matches.sort(),
          // If the shim did not act, the directory is still there.
          after: kind === "replaced-by-file" ? "file" : "missing",
        };
      }
      for (const [kind, [code, syscall]] of Object.entries(failing)) {
        const after = kind === "replaced-by-loop" ? "link" : "directory";
        expected[`${mode}, ${style}, ${kind}`] = { scan: { code, syscall }, after };
      }
    }
    // The kernel resolves a ".." through a symlink, and the walker joins it as text. With
    // one in the pattern, a path that does not open can be a wrong path, so the error stays.
    expected[`${mode}, dot-dot, removed-after-list`].scan = { code: "ENOENT", syscall: "open" };
    expected[`${mode}, dot-dot, replaced-by-file`].scan = { code: "ENOTDIR", syscall: "open" };

    expected[`${mode}, start removed`] = { scan: { code: "ENOENT", syscall: "getdents64" }, after: "missing" };
    for (const style of ["relative", "absolute", "absolute pattern"]) {
      expected[`${mode}, start renamed, ${style}`] = { scan: ["keep/k.txt", "top.txt"], after: "missing" };
    }
  }
  expect(JSON.parse(stdout)).toEqual(expected);
  expect(exitCode).toBe(0);
});

// The shell and bun install drive the same walker.
test.concurrent.skipIf(!isLinux || !cc)("the shell expands a glob to every match that is left", async () => {
  // Two directories each lose a sub-directory after it was listed. A walk that stops at the
  // first one leaves out the file next to the second one.
  using dir = tempDir("glob-shell-gone-directory", {
    "shell-fixture.js": `
import { $ } from "bun";

const { stdout, stderr, exitCode } = await $\`echo **/*.txt\`.cwd("tree").nothrow().quiet();
console.log(JSON.stringify({ words: stdout.toString().trim().split(" ").sort(), stderr: stderr.toString(), exitCode }));
`,
    "tree/one/1.txt": "",
    "tree/one/removed-after-list/v.txt": "",
    "tree/two/2.txt": "",
    "tree/two/removed-after-list/v.txt": "",
  });

  const { stdout, stderr, exitCode } = await runWithShim(["shell-fixture.js"], String(dir), String(dir));
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ words: ["one/1.txt", "two/2.txt"], stderr: "", exitCode: 0 });
  expect(fs.readdirSync(path.join(String(dir), "tree", "one"))).toEqual(["1.txt"]);
  expect(fs.readdirSync(path.join(String(dir), "tree", "two"))).toEqual(["2.txt"]);
  expect(exitCode).toBe(0);
});

test.concurrent.skipIf(!isLinux || !cc)("bun install resolves the workspaces that are left", async () => {
  using dir = tempDir("glob-install-gone-directory", {
    "project/package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
    "project/packages/a/package.json": JSON.stringify({ name: "a", version: "1.0.0" }),
    "project/packages/removed-after-list/package.json": JSON.stringify({ name: "removed", version: "1.0.0" }),
    "project/packages/z/package.json": JSON.stringify({ name: "z", version: "1.0.0" }),
  });
  const project = path.join(String(dir), "project");

  const { stderr, exitCode } = await runWithShim(["install"], project, project, {
    BUN_INSTALL_CACHE_DIR: path.join(String(dir), "cache"),
  });
  expect(stderr).not.toContain("error:");
  expect(fs.readdirSync(path.join(project, "packages")).sort()).toEqual(["a", "z"]);
  const lockfile = fs.readFileSync(path.join(project, "bun.lock"), "utf8");
  expect(lockfile.match(/"packages\/[^"]+"/g)?.sort()).toEqual(['"packages/a"', '"packages/z"']);
  expect(exitCode).toBe(0);
});
