// Recursive fs.rm must report the errno the kernel actually returned, not
// EFAULT. The original field repro was overlayfs at 100% disk: deleting a
// lower-layer file requires writing a whiteout in the upper layer, which fails
// with ENOSPC. An LD_PRELOAD shim reproduces that (and a handful of other
// errnos the errno→name table did not list) deterministically.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { constants as osConstants } from "node:os";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>

static int (*real_unlinkat)(int, const char *, int);

int unlinkat(int dirfd, const char *path, int flags) {
  if (!real_unlinkat) real_unlinkat = dlsym(RTLD_NEXT, "unlinkat");
  const char *needle = getenv("FAIL_UNLINKAT_NEEDLE");
  if (needle && path && strstr(path, needle)) {
    const char *e = getenv("FAIL_UNLINKAT_ERRNO");
    errno = e ? atoi(e) : ENOSPC;
    return -1;
  }
  return real_unlinkat(dirfd, path, flags);
}
`;

// The child builds a small tree under $TREE_ROOT (inside the parent test's
// tempDir, so afterAll cleans up whatever the failing rm leaves behind), calls
// all three rm entry points with { recursive: true, force: true }, and prints
// each result as `<label> <code> <errno>`.
const FIXTURE = /* js */ `
import fs from "node:fs";
import { join } from "node:path";

const make = name => {
  const root = join(process.env.TREE_ROOT, name);
  fs.mkdirSync(join(root, "sub"), { recursive: true });
  fs.writeFileSync(join(root, "sub", "POISON_FILE"), "x");
  fs.writeFileSync(join(root, "sub", "ok.txt"), "x");
  return root;
};
const report = (label, e) => console.log(label, e ? e.code + " " + e.errno : "ok");

let root = make("sync");
try { fs.rmSync(root, { recursive: true, force: true }); report("sync", null); }
catch (e) { report("sync", e); }

root = make("promise");
await fs.promises.rm(root, { recursive: true, force: true })
  .then(() => report("promise", null), e => report("promise", e));

root = make("callback");
await new Promise(done => fs.rm(root, { recursive: true, force: true },
  e => { report("callback", e); done(); }));
`;

let dir: ReturnType<typeof tempDir>;
let shimPath: string;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  dir = tempDir("rm-errno-fault", {
    "shim.c": SHIM_C,
    "fixture.js": FIXTURE,
  });
  shimPath = join(String(dir), "shim.so");
  await using ccProc = Bun.spawn({
    cmd: [cc, "-shared", "-fPIC", "-o", shimPath, join(String(dir), "shim.c"), "-ldl"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, ccErr, ccExit] = await Promise.all([ccProc.stdout.text(), ccProc.stderr.text(), ccProc.exited]);
  if (ccExit !== 0) throw new Error(`shim compile failed: ${ccErr}`);
});

afterAll(() => {
  dir?.[Symbol.dispose]();
});

const run = async (errno: number) => {
  const existing = bunEnv.LD_PRELOAD;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.js"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath,
      FAIL_UNLINKAT_NEEDLE: "POISON_FILE",
      FAIL_UNLINKAT_ERRNO: String(errno),
      TREE_ROOT: join(String(dir), `trees-${errno}`),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
};

describe.skipIf(!isLinux || !cc)("rm({recursive:true}) reports the kernel errno, not EFAULT", () => {
  // First five were collapsed to EFAULT on main; EACCES/EBUSY/EROFS already
  // worked and are here as a regression guard. Defined on every Linux target
  // CI runs; the filter is defensive.
  const cases = (
    [
      ["ENOSPC", osConstants.errno.ENOSPC],
      ["ETXTBSY", osConstants.errno.ETXTBSY],
      ["EDQUOT", osConstants.errno.EDQUOT],
      ["ESTALE", osConstants.errno.ESTALE],
      ["ENODEV", osConstants.errno.ENODEV],
      ["EACCES", osConstants.errno.EACCES],
      ["EBUSY", osConstants.errno.EBUSY],
      ["EROFS", osConstants.errno.EROFS],
    ] as const
  ).filter(([, n]) => typeof n === "number");

  test.concurrent.each(cases)("%s", async (name, errno) => {
    const line = `${name} ${-errno}`;
    expect(await run(errno)).toEqual({
      stdout: `sync ${line}\npromise ${line}\ncallback ${line}\n`,
      stderr: "",
      exitCode: 0,
    });
  });
});
