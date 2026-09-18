// An LD_PRELOAD shim makes pthread_create fail with EAGAIN (what the kernel
// returns at a pids cgroup limit or RLIMIT_NPROC). When the thread pool cannot
// start a worker and no worker exists, the queued tasks never run. Bun must
// report the failure and exit instead of waiting forever.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

// FAIL_PTHREAD_CREATE_AFTER=N: the first N pthread_create calls made by the
// main thread with a thread attribute succeed, every later one fails with
// EAGAIN. Rust's std::thread always passes an attribute (it sets the stack
// size). Calls with no attribute (the mimalloc scavenger, debug helper
// threads) and calls from other threads always pass through.
const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <stdlib.h>
#include <sys/syscall.h>
#include <unistd.h>

static int (*real_pthread_create)(pthread_t *, const pthread_attr_t *, void *(*)(void *), void *);
static int allowed = -1;
static int count = 0;

int pthread_create(pthread_t *thread, const pthread_attr_t *attr, void *(*start)(void *), void *arg) {
    if (!real_pthread_create) {
        real_pthread_create = dlsym(RTLD_NEXT, "pthread_create");
        const char *n = getenv("FAIL_PTHREAD_CREATE_AFTER");
        allowed = n ? atoi(n) : 0;
    }
    if (attr && (long)getpid() == syscall(SYS_gettid) && count++ >= allowed) {
        errno = EAGAIN;
        return EAGAIN;
    }
    return real_pthread_create(thread, attr, start, arg);
}
`;

const REGISTRY_FIXTURE = /* js */ `
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const { origin, pathname } = new URL(req.url);
    const name = decodeURIComponent(pathname.slice(1));
    return Response.json({
      name,
      "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": { name, version: "1.0.0", dist: { tarball: origin + "/" + name + "-1.0.0.tgz" } } },
    });
  },
});
console.log(server.port);
`;

let shimPath: string;
let dir: ReturnType<typeof tempDir> | undefined;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  dir = tempDir("thread-pool-spawn-fail", {
    "shim.c": SHIM_C,
    "registry.js": REGISTRY_FIXTURE,
    "build/entry.js": `import { a } from "./a.js"; console.log(a);`,
    "build/a.js": `export const a = 1;`,
    "install/package.json": JSON.stringify({ name: "p", version: "1.0.0", dependencies: { dep: "1.0.0" } }),
  });
  shimPath = join(String(dir), "shim.so");
  await using ccProc = Bun.spawn({
    cmd: [cc, "-shared", "-fPIC", "-o", shimPath, join(String(dir), "shim.c"), "-ldl"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [ccOut, ccErr, ccExit] = await Promise.all([ccProc.stdout.text(), ccProc.stderr.text(), ccProc.exited]);
  if (ccExit !== 0) {
    throw new Error(`shim compile failed: ${ccErr || ccOut}`);
  }
});

afterAll(() => {
  dir?.[Symbol.dispose]();
});

async function runWithShim(cmd: string[], cwd: string, allowed: number) {
  const existing = bunEnv.LD_PRELOAD;
  await using proc = Bun.spawn({
    cmd,
    cwd,
    env: {
      ...bunEnv,
      LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath,
      FAIL_PTHREAD_CREATE_AFTER: String(allowed),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent.skipIf(!isLinux || !cc)("bun build exits with an error when no worker thread can start", async () => {
  const { stderr, exitCode } = await runWithShim(
    [bunExe(), "build", "entry.js", "--outdir", "out"],
    join(String(dir), "build"),
    0,
  );
  expect(stderr).toContain("Failed to spawn a worker thread");
  expect(stderr).toContain("Resource temporarily unavailable");
  expect(exitCode).toBe(1);
});

// The first thread `bun install` starts is the HTTP client thread. The second
// one is the first worker of the install thread pool. That is the thread
// that fails at the pids limit in the report.
test.concurrent.skipIf(!isLinux || !cc)("bun install exits with an error when no worker thread can start", async () => {
  await using registry = Bun.spawn({
    cmd: [bunExe(), "registry.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = registry.stdout.getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  const port = new TextDecoder().decode(value).trim();
  const installDir = join(String(dir), "install");
  await Bun.write(
    join(installDir, "bunfig.toml"),
    `[install]\ncache = false\nregistry = "http://localhost:${port}/"\n`,
  );

  const { stderr, exitCode } = await runWithShim([bunExe(), "install", "--lockfile-only"], installDir, 1);
  expect(stderr).toContain("Failed to spawn a worker thread");
  expect(stderr).toContain("Resource temporarily unavailable");
  expect(exitCode).toBe(1);
});
