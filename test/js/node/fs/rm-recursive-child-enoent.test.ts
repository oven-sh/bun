// A child that disappears between readdir() and unlinkat() must not abort the
// recursive walk. Before this fix rm({force}) returned success with the tree
// still on disk; without force it reported a misleading top-level ENOENT.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// Simulate the readdir/unlink race: unlinkat() on the marked child performs
// the real call (so the parent rmdir that follows can succeed) and then
// reports ENOENT anyway.
const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <string.h>
#include <stdlib.h>

static int (*real_unlinkat)(int, const char *, int);

int unlinkat(int dirfd, const char *path, int flags) {
  if (!real_unlinkat) real_unlinkat = dlsym(RTLD_NEXT, "unlinkat");
  const char *needle = getenv("ENOENT_NEEDLE");
  if (needle && path && strstr(path, needle)) {
    real_unlinkat(dirfd, path, flags);
    errno = ENOENT;
    return -1;
  }
  return real_unlinkat(dirfd, path, flags);
}
`;

const FIXTURE = /* js */ `
import fs from "node:fs";
import { join } from "node:path";

const [, , which, root, force] = process.argv;
fs.mkdirSync(join(root, "sub"), { recursive: true });
fs.writeFileSync(join(root, "keep-a.txt"), "x");
fs.writeFileSync(join(root, "keep-b.txt"), "x");
fs.writeFileSync(join(root, "sub", "keep-c.txt"), "x");
fs.writeFileSync(join(root, "sub", "GHOST"), "x");
fs.writeFileSync(join(root, "sub", "keep-d.txt"), "x");

const opts = { recursive: true, force: force === "force" };
let err;
try {
  if (which === "sync") fs.rmSync(root, opts);
  else if (which === "promise") await fs.promises.rm(root, opts);
  else await new Promise((res, rej) =>
    fs.rm(root, opts, e => (e ? rej(e) : res())));
} catch (e) { err = e; }

console.log(JSON.stringify({
  err: err ? err.code || String(err) : null,
  exists: fs.existsSync(root),
}));
`;

let dir: ReturnType<typeof tempDir>;
let shimPath: string;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  dir = tempDir("rm-child-enoent", {
    "shim.c": SHIM_C,
    "fixture.mjs": FIXTURE,
  });
  shimPath = join(String(dir), "shim.so");
  await using p = Bun.spawn({
    cmd: [cc, "-shared", "-fPIC", "-o", shimPath, join(String(dir), "shim.c"), "-ldl"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, code] = await Promise.all([p.stdout.text(), p.stderr.text(), p.exited]);
  if (code !== 0) throw new Error(`shim compile failed: ${stderr}`);
});

afterAll(() => dir?.[Symbol.dispose]());

const run = async (which: string, force: "force" | "noforce") => {
  const root = join(String(dir), `tree-${which}-${force}`);
  const existing = bunEnv.LD_PRELOAD;
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(String(dir), "fixture.mjs"), which, root, force],
    env: {
      ...bunEnv,
      LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath,
      ENOENT_NEEDLE: "GHOST",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
};

// The real race, no shim: a second process removes entries while rm walks the
// tree. rm takes the subdirectories in readdir order and the other process
// takes them in reverse order, so the two meet in the middle and rm finds a
// subdirectory (openat) or a file (unlinkat) already gone.
// The deleter lists the tree, prints "ready", waits for "go", then removes
// what it listed. The "go" line and the rm() call are issued back to back so
// both walks start at about the same time.
const DELETER = /* js */ `
import { readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
const root = process.argv[2];
const subs = readdirSync(root).reverse();
console.log("ready");
await console[Symbol.asyncIterator]().next(); // "go"
for (const sub of subs) {
  const dir = join(root, sub);
  for (const name of ["a", "b"]) {
    try { unlinkSync(join(dir, name)); } catch {}
  }
  try { rmdirSync(dir); } catch {}
}
`;

describe.skipIf(isWindows)("rm({recursive}) while another process removes entries in the tree", () => {
  for (const force of [true, false]) {
    test.concurrent(`force:${force} removes the whole tree`, async () => {
      using dir = tempDir(`rm-race-${force}`, { "deleter.mjs": DELETER });
      const root = join(String(dir), "tree");
      for (let n = 0; n < 200; n++) {
        const sub = join(root, `d${n}`);
        mkdirSync(sub, { recursive: true });
        writeFileSync(join(sub, "a"), "x");
        writeFileSync(join(sub, "b"), "x");
      }
      await using deleter = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "deleter.mjs"), root],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
      });
      const reader = deleter.stdout.getReader();
      const { value } = await reader.read();
      expect(new TextDecoder().decode(value)).toBe("ready\n");
      deleter.stdin.write("go\n");
      deleter.stdin.flush();
      let outcome: string;
      try {
        await rm(root, { recursive: true, force });
        outcome = existsSync(root) ? "resolved, tree still on disk" : "removed";
      } catch (e: any) {
        outcome = `rejected: ${e.code} on ${e.path === root ? "root" : "child"}`;
      }
      deleter.stdin.end();
      expect(outcome).toBe("removed");
      expect(await deleter.exited).toBe(0);
    });
  }
});

describe.skipIf(!isLinux || !cc)("rm({recursive}) continues past a child that raced to ENOENT", () => {
  for (const which of ["sync", "promise", "cb"] as const) {
    for (const force of ["force", "noforce"] as const) {
      test.concurrent(`${which} force:${force === "force"} removes the whole tree`, async () => {
        expect(await run(which, force)).toEqual({
          stdout: JSON.stringify({ err: null, exists: false }),
          stderr: "",
          exitCode: 0,
        });
      });
    }
  }
});
