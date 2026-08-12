// An LD_PRELOAD shim makes pthread_create fail with EAGAIN (what the kernel
// returns at the RLIMIT_NPROC / cgroup pids limit) for the thread pool's worker
// threads. A pool that cannot get a single worker used to leave its tasks
// queued forever: `bun build`, `Bun.build()`, `bun install` and every node:fs
// promise hung instead of reporting the error.
//
// The tests are sequential on purpose: the regression is a hang, and bun test
// only kills a timed-out test's dangling children for non-concurrent tests.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { constants } from "node:os";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
const skip = !isLinux || !cc;

// DEFAULT_THREAD_STACK_SIZE in src/threading/ThreadPool.rs: every bun_threading
// pool worker (the runtime's WorkPool, the bundler's and bun install's pools) is
// created with this stack size. Bun's other threads (the "Bundler" thread,
// allocator and JSC helpers) request other sizes and keep working, so the
// fixtures below get as far as the pool itself. The one exception is the HTTP
// client thread, which also uses this size; see the install test.
const POOL_WORKER_STACK_SIZE = 4 * 1024 * 1024;

// POOL_SPAWN_PLAN is one letter per spawn attempt of such a thread, 'f' = fail,
// 's' = succeed; the last letter repeats for every further attempt. Failures
// return EAGAIN unless POOL_SPAWN_ERRNO names another errno value.
const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <stdlib.h>
#include <string.h>

static int (*real_pthread_create)(pthread_t *, const pthread_attr_t *, void *(*)(void *), void *);
static const char *plan;
static size_t plan_len;
static int fail_errno = EAGAIN;
static int attempts;

__attribute__((constructor)) static void init(void) {
  real_pthread_create = dlsym(RTLD_NEXT, "pthread_create");
  plan = getenv("POOL_SPAWN_PLAN");
  plan_len = plan ? strlen(plan) : 0;
  const char *err = getenv("POOL_SPAWN_ERRNO");
  if (err) fail_errno = atoi(err);
}

int pthread_create(pthread_t *thread, const pthread_attr_t *attr, void *(*start)(void *), void *arg) {
  size_t stack_size = 0;
  if (attr) pthread_attr_getstacksize(attr, &stack_size);
  if (stack_size == ${POOL_WORKER_STACK_SIZE} && plan_len > 0) {
    size_t i = __sync_fetch_and_add(&attempts, 1);
    if (plan[i < plan_len ? i : plan_len - 1] == 'f') return fail_errno;
  }
  return real_pthread_create(thread, attr, start, arg);
}
`;

const BUILD_API_FIXTURE = /* js */ `
try {
  const result = await Bun.build({ entrypoints: [import.meta.dirname + "/entry.js"] });
  console.log(JSON.stringify({ settled: "resolved", success: result.success, logs: result.logs.map(String) }));
} catch (e) {
  console.log(JSON.stringify({ settled: "rejected", name: e.name, message: e.message, errors: e.errors.map(err => err.message) }));
}
`;

// fs.promises.readFile runs on the runtime's WorkPool, which is created lazily
// by its first task; nothing warms it up front.
const READ_FILE_FIXTURE = /* js */ `
import { readFile } from "node:fs/promises";
const text = await readFile(import.meta.dirname + "/a.js", "utf8");
console.log("read:", text.trim());
`;

// The dev server bundles a route on its first request, on the shared WorkPool.
const DEV_SERVER_FIXTURE = /* js */ `
import index from "./index.html";
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", development: true, routes: { "/": index } });
console.log("PORT " + server.port);
`;

let dir: ReturnType<typeof tempDir> | undefined;
let shimPath: string;

beforeAll(async () => {
  if (skip) return;
  dir = tempDir("thread-pool-spawn-failure", {
    "shim.c": SHIM_C,
    "entry.js": `import { a } from "./a.js";\nconsole.log(a);\n`,
    "a.js": `export const a = 1;\n`,
    "build-api.js": BUILD_API_FIXTURE,
    "read-file.js": READ_FILE_FIXTURE,
    "dev-server.js": DEV_SERVER_FIXTURE,
    "index.html": `<!doctype html><script type="module" src="./a.js"></script>`,
    "install/package.json": JSON.stringify({ name: "app", dependencies: { dep: "file:./dep.tgz" } }),
  });
  await Bun.Archive.write(
    join(String(dir), "install", "dep.tgz"),
    { "package/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }) },
    { compress: "gzip" },
  );
  shimPath = join(String(dir), "shim.so");
  await using ccProc = Bun.spawn({
    cmd: [cc!, "-shared", "-fPIC", "-o", shimPath, join(String(dir), "shim.c"), "-ldl"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [ccOut, ccErr, ccExit] = await Promise.all([ccProc.stdout.text(), ccProc.stderr.text(), ccProc.exited]);
  if (ccExit !== 0) {
    throw new Error(`shim compile failed: ${ccErr || ccOut}`);
  }
});

afterAll(() => {
  dir?.[Symbol.dispose]();
});

function spawnWithPlan(plan: string, args: string[], errno?: number) {
  const existing = bunEnv.LD_PRELOAD;
  return Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: String(dir),
    env: {
      ...bunEnv,
      LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath,
      POOL_SPAWN_PLAN: plan,
      ...(errno === undefined ? {} : { POOL_SPAWN_ERRNO: String(errno) }),
    },
    stdout: "pipe",
    stderr: "pipe",
    // Kill switch: without the fix every 'f'-only run below waits forever for
    // tasks that no thread will ever pick up.
    timeout: 20_000,
    killSignal: "SIGKILL",
  });
}

async function runWithPlan(plan: string, args: string[], errno?: number) {
  await using proc = spawnWithPlan(plan, args, errno);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode, signalCode: proc.signalCode };
}

// The bundler warms its pool before scheduling anything, so it can report the
// failure through its own log.
function bundlerError(errno: string) {
  return `Failed to create a worker thread for the bundler: ${errno}. The process or thread limit may have been reached (ulimit -u, or the container's pids limit).`;
}

// Pools that are only ever fed through fire-and-forget schedule() calls have
// nobody to return the error to; the process exits with it instead of hanging.
const STRANDED_TASKS_STDERR = [
  "EAGAIN: failed to create a worker thread for the thread pool; the work already queued on it could never run",
  "note: the process or thread limit may have been reached (ulimit -u, or the container's pids limit); raise it or reduce concurrency",
].join("\n");

test.skipIf(skip)("bun build reports a bundler pool that cannot spawn any worker and exits", async () => {
  expect(await runWithPlan("f", ["build", "entry.js"])).toEqual({
    stdout: "",
    stderr: `error: ${bundlerError("EAGAIN")}`,
    exitCode: 1,
    signalCode: null,
  });
});

test.skipIf(skip)("the error names the errno the OS returned", async () => {
  expect(await runWithPlan("f", ["build", "entry.js"], constants.errno.EPERM)).toEqual({
    stdout: "",
    stderr: `error: ${bundlerError("EPERM")}`,
    exitCode: 1,
    signalCode: null,
  });
});

// The failure happens before the watcher exists, so a watch build has nothing
// left to wait for; it must exit like a plain build instead of parking.
test.skipIf(skip)("bun build --watch exits too when the pool cannot spawn any worker", async () => {
  expect(await runWithPlan("f", ["build", "--watch", "entry.js"])).toEqual({
    stdout: "",
    stderr: `error: ${bundlerError("EAGAIN")}`,
    exitCode: 1,
    signalCode: null,
  });
});

test.skipIf(skip)("Bun.build() rejects when the pool cannot spawn any worker", async () => {
  expect(await runWithPlan("f", ["build-api.js"])).toEqual({
    stdout: JSON.stringify({
      settled: "rejected",
      name: "AggregateError",
      message: "Bundle failed",
      errors: [bundlerError("EAGAIN")],
    }),
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

test.skipIf(skip)("the dev server exits with the error when the pool cannot spawn any worker", async () => {
  await using proc = spawnWithPlan("f", ["dev-server.js"]);
  const stderr = proc.stderr.text();
  const decoder = new TextDecoder();
  let stdout = "";
  let requested = false;
  for await (const chunk of proc.stdout) {
    stdout += decoder.decode(chunk, { stream: true });
    const port = /^PORT (\d+)$/m.exec(stdout)?.[1];
    if (port !== undefined && !requested) {
      requested = true;
      // Triggers the bundle. The server exits before answering, so the
      // request itself fails; the server's output is what is asserted.
      fetch(`http://127.0.0.1:${port}/`).catch(() => {});
    }
  }
  const exitCode = await proc.exited;
  expect({ stdout: stdout.trim(), stderr: (await stderr).trim(), exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: expect.stringMatching(/^PORT \d+$/),
    stderr: `error: ${bundlerError("EAGAIN")}`,
    exitCode: 1,
    signalCode: null,
  });
});

test.skipIf(skip)("a node:fs promise whose WorkPool cannot spawn any worker exits with the error", async () => {
  expect(await runWithPlan("f", ["read-file.js"])).toEqual({
    stdout: "",
    stderr: STRANDED_TASKS_STDERR,
    exitCode: 1,
    signalCode: null,
  });
});

// bun install starts the HTTP client thread (the 's': it uses the same stack
// size) before scheduling the tarball extraction on its own, never warmed pool.
test.skipIf(skip)("bun install exits with the error when its pool cannot spawn any worker", async () => {
  expect(await runWithPlan("sf", ["install", "--cwd", "install"])).toEqual({
    stdout: expect.stringContaining("bun install v1."),
    stderr: STRANDED_TASKS_STDERR,
    exitCode: 1,
    signalCode: null,
  });
});

test.skipIf(skip)("the pool's first worker is retried after a transient spawn failure", async () => {
  expect(await runWithPlan("fs", ["read-file.js"])).toEqual({
    stdout: "read: export const a = 1;",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

test.skipIf(skip)("a pool that got one worker keeps working when the remaining spawns fail", async () => {
  expect(await runWithPlan("sf", ["build", "entry.js"])).toEqual({
    stdout: ["// a.js", "var a = 1;", "", "// entry.js", "console.log(a);"].join("\n"),
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});
