// An LD_PRELOAD shim makes inotify_add_watch fail with ENOSPC for directory
// watches (IN_ONLYDIR in the mask), simulating fs.inotify.max_user_watches
// exhaustion. Under --watch, every imported file's parent directory is opened
// via open() and then passed to inotify_add_watch; if the add fails the fd
// must be closed, not leaked.
//
// The test compares the count of open directory fds between a baseline run
// (inotify succeeds, the watchlist intentionally holds the fd) and a shimmed
// run (inotify fails). With the fix, the shimmed run holds DIR_COUNT fewer
// directory fds because the fd is closed on the error path. Without the fix,
// the shimmed run holds the same number of fds as the baseline because the
// fd is leaked instead of being closed.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isLinux, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
const DIR_COUNT = 20;

const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdint.h>
#include <sys/inotify.h>

static int (*real)(int, const char *, uint32_t);

int inotify_add_watch(int fd, const char *path, uint32_t mask) {
    if (!real) real = (int (*)(int, const char *, uint32_t)) dlsym(RTLD_NEXT, "inotify_add_watch");
    if (mask & IN_ONLYDIR) {
        errno = ENOSPC;
        return -1;
    }
    return real(fd, path, mask);
}
`;

function makeEntry(n: number) {
  let s = "";
  for (let i = 0; i < n; i++) s += `import "./d${i}/m.ts";\n`;
  s += `import { readdirSync, readlinkSync } from "node:fs";\n`;
  s += `let count = 0;\n`;
  s += `for (const name of readdirSync("/proc/self/fd")) {\n`;
  s += `  try {\n`;
  s += `    const target = readlinkSync("/proc/self/fd/" + name);\n`;
  s += `    if (/\\/d\\d+$/.test(target)) count++;\n`;
  s += `  } catch {}\n`;
  s += `}\n`;
  s += `console.log("DIR_FDS=" + count);\n`;
  s += `setInterval(() => {}, 1 << 30);\n`;
  return s;
}

let shimPath: string;
let dir: ReturnType<typeof tempDir> | undefined;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  const files: Record<string, string> = {
    "shim.c": SHIM_C,
    "entry.ts": makeEntry(DIR_COUNT),
  };
  for (let i = 0; i < DIR_COUNT; i++) files[`d${i}/m.ts`] = `export const x = ${i};\n`;
  dir = tempDir("inotify-fail-leak", files);
  shimPath = join(String(dir), "shim.so");
  await using ccProc = Bun.spawn({
    cmd: [cc, "-shared", "-fPIC", "-o", shimPath, join(String(dir), "shim.c"), "-ldl"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [ccOut, ccErr, ccExit] = await Promise.all([ccProc.stdout.text(), ccProc.stderr.text(), ccProc.exited]);
  if (ccExit !== 0) throw new Error(`shim compile failed: ${ccErr || ccOut}`);
});

afterAll(() => {
  dir?.[Symbol.dispose]();
});

async function runAndCount(env: Record<string, string | undefined>): Promise<number> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--watch", "entry.ts"],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  let line: string | undefined;
  for await (const l of forEachLine(proc.stdout)) {
    if (l.startsWith("DIR_FDS=")) {
      line = l;
      break;
    }
  }
  proc.kill("SIGKILL");
  await proc.exited;
  if (!line) {
    const stderr = await proc.stderr.text();
    throw new Error(`child produced no DIR_FDS line; stderr:\n${stderr}`);
  }
  return Number(line.slice("DIR_FDS=".length));
}

test.skipIf(!isLinux || !cc)(
  "--watch closes the directory fd when inotify_add_watch fails with ENOSPC",
  async () => {
    const existing = bunEnv.LD_PRELOAD;
    const shimEnv = { ...bunEnv, LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath };

    const [baseline, failing] = await Promise.all([runAndCount(bunEnv), runAndCount(shimEnv)]);

    // When inotify succeeds the watchlist holds one dir fd per directory; when
    // inotify fails that fd must be closed, so the failing run should hold
    // DIR_COUNT fewer directory fds than the baseline. Without the fix the fd
    // is leaked and the two counts are equal.
    expect({ baseline, failing, released: baseline - failing }).toEqual({
      baseline: expect.any(Number),
      failing: expect.any(Number),
      released: DIR_COUNT,
    });
  },
);
