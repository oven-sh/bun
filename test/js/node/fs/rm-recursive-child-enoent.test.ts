// A child that disappears between readdir() and unlinkat() must not abort the
// recursive walk. Before this fix rm({force}) returned success with the tree
// still on disk; without force it reported a misleading top-level ENOENT.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
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
