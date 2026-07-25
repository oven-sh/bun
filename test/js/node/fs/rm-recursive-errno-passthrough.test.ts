// Recursive fs.rm must report the errno the kernel actually returned, not
// EFAULT. The original field repro was overlayfs at 100% disk: deleting a
// lower-layer file requires writing a whiteout in the upper layer, which fails
// with ENOSPC. An LD_PRELOAD shim reproduces that (and a handful of other
// errnos the errno→name table did not list) deterministically.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { constants as osConstants } from "node:os";

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

// The child builds a small tree, calls all three rm entry points (sync / promise /
// callback) with { recursive: true, force: true }, and prints each error code.
const FIXTURE = /* js */ `
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const make = () => {
  const root = fs.mkdtempSync(join(tmpdir(), "rm-errno-"));
  fs.mkdirSync(join(root, "sub"));
  fs.writeFileSync(join(root, "sub", "POISON_FILE"), "x");
  fs.writeFileSync(join(root, "sub", "ok.txt"), "x");
  return root;
};
const report = e => JSON.stringify({ code: e?.code ?? null, errno: e?.errno ?? null });

let root = make();
try { fs.rmSync(root, { recursive: true, force: true }); console.log("sync", report(null)); }
catch (e) { console.log("sync", report(e)); }

root = make();
await fs.promises.rm(root, { recursive: true, force: true })
  .then(() => console.log("promise", report(null)), e => console.log("promise", report(e)));

root = make();
await new Promise(done => fs.rm(root, { recursive: true, force: true },
  e => { console.log("callback", report(e)); done(); }));
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
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines: Record<string, { code: string | null; errno: number | null }> = {};
  for (const line of stdout.trim().split("\n")) {
    const [label, json] = line.split(" ", 2);
    lines[label] = JSON.parse(json);
  }
  return { lines, stderr, exitCode };
};

describe.skipIf(!isLinux || !cc)("rm({recursive:true}) reports the kernel errno, not EFAULT", () => {
  // ENOSPC / ETXTBSY are defined on every Linux; EDQUOT / ESTALE are present on
  // every glibc/musl target CI runs but guarded for completeness.
  const cases = (
    [
      ["ENOSPC", osConstants.errno.ENOSPC],
      ["ETXTBSY", osConstants.errno.ETXTBSY],
      ["EDQUOT", osConstants.errno.EDQUOT],
      ["ESTALE", osConstants.errno.ESTALE],
    ] as const
  ).filter(([, n]) => typeof n === "number");

  test.concurrent.each(cases)("%s", async (name, errno) => {
    const { lines, stderr, exitCode } = await run(errno);
    const want = { code: name, errno: -errno };
    expect({ lines, stderr, exitCode }).toEqual({
      lines: { sync: want, promise: want, callback: want },
      stderr: "",
      exitCode: 0,
    });
  });

  // Errnos that already had a named variant must keep round-tripping unchanged.
  const namedCases = [
    ["ENOENT", osConstants.errno.ENOENT, null], // force:true swallows ENOENT
    ["EACCES", osConstants.errno.EACCES, "EACCES"],
    ["EBUSY", osConstants.errno.EBUSY, "EBUSY"],
    ["EROFS", osConstants.errno.EROFS, "EROFS"],
  ] as const;

  test.concurrent.each(namedCases)("%s (named variant still round-trips)", async (_name, errno, wantCode) => {
    const { lines, stderr, exitCode } = await run(errno);
    const want = wantCode === null ? { code: null, errno: null } : { code: wantCode, errno: -errno };
    expect({ lines, stderr, exitCode }).toEqual({
      lines: { sync: want, promise: want, callback: want },
      stderr: "",
      exitCode: 0,
    });
  });
});
