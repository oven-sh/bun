// A child that disappears between readdir() and unlinkat() must not abort the
// recursive walk. Before this fix rm({force}) returned success with the tree
// still on disk; without force it reported a misleading top-level ENOENT.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// Simulate the readdir/unlink race: unlinkat() on the ENOENT_NEEDLE entry
// performs the real call (so the parent rmdir that follows can succeed) and
// then reports ENOENT anyway. A STUCK_NEEDLE entry reports ENOENT without
// being removed: it stays listed, so the parent rmdir keeps failing with
// ENOTEMPTY. That is what a Windows name with a lone surrogate does, since
// the listing replaces it with U+FFFD and the re-encoded name never matches.
// A LATE_NEEDLE directory gets a new file and an ENOTEMPTY on each of its
// first LATE_COUNT rmdir calls: the re-walk removes that file, so each retry
// makes progress and the walk must keep retrying until the real rmdir.
const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <unistd.h>

static int (*real_unlinkat)(int, const char *, int);
static int late_calls = 0;

int unlinkat(int dirfd, const char *path, int flags) {
  if (!real_unlinkat) real_unlinkat = dlsym(RTLD_NEXT, "unlinkat");
  const char *needle = getenv("ENOENT_NEEDLE");
  if (needle && path && strstr(path, needle)) {
    real_unlinkat(dirfd, path, flags);
    errno = ENOENT;
    return -1;
  }
  const char *stuck = getenv("STUCK_NEEDLE");
  if (stuck && path && strstr(path, stuck)) {
    errno = ENOENT;
    return -1;
  }
  const char *late = getenv("LATE_NEEDLE");
  if (late && path && (flags & AT_REMOVEDIR) && strstr(path, late) && late_calls < atoi(getenv("LATE_COUNT"))) {
    char child[64];
    snprintf(child, sizeof child, "%s/late%d", path, late_calls++);
    close(openat(dirfd, child, O_CREAT | O_WRONLY, 0644));
    errno = ENOTEMPTY;
    return -1;
  }
  return real_unlinkat(dirfd, path, flags);
}
`;

// Tree: root/keep-a.txt, root/keep-b.txt, root/<depth dirs>/sub/{keep-c.txt,
// GHOST, keep-d.txt}. GHOST is a file or a directory with one file in it.
// A depth of 16 or more sends the walk into the fixed-stack fallback variant.
const FIXTURE = /* js */ `
import fs from "node:fs";
import { join } from "node:path";

const [, , which, root, force, depth, ghost] = process.argv;
let sub = root;
for (let i = 0; i < Number(depth); i++) sub = join(sub, "d" + i);
sub = join(sub, "sub");
fs.mkdirSync(sub, { recursive: true });
fs.writeFileSync(join(root, "keep-a.txt"), "x");
fs.writeFileSync(join(root, "keep-b.txt"), "x");
fs.writeFileSync(join(sub, "keep-c.txt"), "x");
if (ghost === "dir") {
  fs.mkdirSync(join(sub, "GHOST"));
  fs.writeFileSync(join(sub, "GHOST", "inner"), "x");
} else {
  fs.writeFileSync(join(sub, "GHOST"), "x");
}
fs.writeFileSync(join(sub, "keep-d.txt"), "x");

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

type Case = {
  which?: "sync" | "promise" | "cb";
  force: boolean;
  depth?: number;
  ghost?: "file" | "dir";
  env: Record<string, string>;
};

const run = async (name: string, { which = "sync", force, depth = 0, ghost = "file", env }: Case) => {
  const root = join(String(dir), `tree-${name.replaceAll(/[^a-z0-9]+/g, "-")}`);
  const existing = bunEnv.LD_PRELOAD;
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(String(dir), "fixture.mjs"), which, root, force ? "force" : "noforce", String(depth), ghost],
    env: {
      ...bunEnv,
      LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
    // A walk that loops forever (the bug the STUCK cases guard against) must
    // not outlive the test.
    timeout: 20_000,
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

// Not run on Windows: the collision rate of this race has only been measured
// on Linux and macOS, and a run where the two walks never meet proves nothing.
// The shim suite below covers the same arms deterministically.
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

const removed = { stdout: JSON.stringify({ err: null, exists: false }), stderr: "", exitCode: 0 };
const notEmpty = { stdout: JSON.stringify({ err: "ENOTEMPTY", exists: true }), stderr: "", exitCode: 0 };

describe.skipIf(!isLinux || !cc)("rm({recursive}) continues past a child that raced to ENOENT", () => {
  for (const which of ["sync", "promise", "cb"] as const) {
    for (const force of [true, false]) {
      const name = `${which} force:${force} removes the whole tree`;
      test.concurrent(name, async () => {
        expect(await run(name, { which, force, env: { ENOENT_NEEDLE: "GHOST" } })).toEqual(removed);
      });
    }
  }

  for (const force of [true, false]) {
    // The fallback variant restarts its walk after every directory it removes.
    // A directory whose rmdir races to ENOENT is gone too, so the restart
    // that follows must not count as a pass that removed nothing.
    const deep = `force:${force} depth 20: a directory whose rmdir raced to ENOENT`;
    test.concurrent(deep, async () => {
      expect(await run(deep, { force, depth: 20, ghost: "dir", env: { ENOENT_NEEDLE: "GHOST" } })).toEqual(removed);
    });

    // An entry that stays listed but whose unlink keeps reporting ENOENT must
    // end the walk with the parent's ENOTEMPTY, not re-walk the directory
    // forever. Depth 20 covers the fallback variant, which looped on this
    // before the bound.
    for (const depth of [0, 20]) {
      const stuck = `force:${force} depth ${depth}: ENOTEMPTY for an entry that cannot be removed`;
      test.concurrent(stuck, async () => {
        expect(await run(stuck, { force, depth, env: { STUCK_NEEDLE: "GHOST" } })).toEqual(notEmpty);
      });

      // Two ENOTEMPTY retries in a row, each re-walk removing one new file:
      // a retry that made progress is not the end of the walk.
      const late = `force:${force} depth ${depth}: retries while each re-walk removes something`;
      test.concurrent(late, async () => {
        expect(await run(late, { force, depth, env: { LATE_NEEDLE: "sub", LATE_COUNT: "2" } })).toEqual(removed);
      });
    }
  }
});
