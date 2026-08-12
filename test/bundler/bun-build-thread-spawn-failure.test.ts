// Bun.build() (and HTML routes in Bun.serve) run on one lazily started
// "Bundler" thread. An LD_PRELOAD shim makes pthread_create fail for it with
// EAGAIN, which is what the kernel returns at the RLIMIT_NPROC / cgroup pids
// limit. That used to abort the whole process ("panic: Failed to spawn bun
// build thread"); it has to fail the build like any other build error, and a
// later build has to try starting the thread again.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
const skip = !isLinux || !cc;

// The "Bundler" thread is the only thread bun creates with Rust's default
// 2 MiB stack: JSC's helpers ask for their own sizes, the allocators pass no
// attributes at all, and bun's thread pools use 4 MiB. So this stack size
// singles out the bundle thread and everything else keeps working.
const BUNDLE_THREAD_STACK_SIZE = 2 * 1024 * 1024;

// BUNDLE_THREAD_SPAWN_PLAN has one letter per attempt to create such a thread:
// 'f' fails it with EAGAIN, 's' lets it through; the last letter repeats.
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
static size_t attempts;

__attribute__((constructor)) static void init(void) {
  real_pthread_create = dlsym(RTLD_NEXT, "pthread_create");
  plan = getenv("BUNDLE_THREAD_SPAWN_PLAN");
  plan_len = plan ? strlen(plan) : 0;
}

int pthread_create(pthread_t *thread, const pthread_attr_t *attr, void *(*start)(void *), void *arg) {
  size_t stack_size = 0;
  if (attr) pthread_attr_getstacksize(attr, &stack_size);
  if (stack_size == ${BUNDLE_THREAD_STACK_SIZE} && plan_len > 0) {
    size_t i = __sync_fetch_and_add(&attempts, 1);
    if (plan[i < plan_len ? i : plan_len - 1] == 'f') return EAGAIN;
  }
  return real_pthread_create(thread, attr, start, arg);
}
`;

const EXPECTED_ERROR =
  "Failed to start the bundler thread: EAGAIN. The process or thread limit may have been reached (ulimit -u, or the container's pids limit).";

// Prints one JSON line per Bun.build() call; `throw` is taken from argv so the
// same fixture covers the rejecting and the { success: false } flavors.
const BUILD_FIXTURE = /* js */ `
const [, , throwArg, count] = process.argv;
for (let i = 0; i < Number(count); i++) {
  let onEnd = "not called";
  const plugin = { name: "record", setup(build) { build.onEnd(result => { onEnd = result.success; }); } };
  try {
    const result = await Bun.build({
      entrypoints: [import.meta.dirname + "/entry.js"],
      throw: throwArg === "throw",
      plugins: [plugin],
    });
    console.log(JSON.stringify({ settled: "resolved", success: result.success, logs: result.logs.map(l => l.message), onEnd }));
  } catch (e) {
    console.log(JSON.stringify({ settled: "rejected", name: e.name, message: e.message, errors: e.errors.map(err => err.message), onEnd }));
  }
}
`;

// Without HMR an HTML route is bundled by the same bundle thread when it is
// requested. development: { hmr: false } (rather than false) rebundles on every
// request and writes a failed build's log to stderr, so the second request
// shows whether the thread gets started again.
const SERVE_FIXTURE = /* js */ `
import index from "./index.html";
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", development: { hmr: false }, routes: { "/": index } });
const first = await fetch(server.url);
const second = await fetch(server.url);
console.log(JSON.stringify({ first: first.status, second: second.status }));
server.stop(true);
`;

let dir: ReturnType<typeof tempDir> | undefined;
let shimPath: string;

beforeAll(async () => {
  if (skip) return;
  dir = tempDir("bundle-thread-spawn-failure", {
    "shim.c": SHIM_C,
    "entry.js": `import { a } from "./a.js";\nconsole.log(a);\n`,
    "a.js": `export const a = 1;\n`,
    "build.js": BUILD_FIXTURE,
    "serve.js": SERVE_FIXTURE,
    "index.html": `<!doctype html><script type="module" src="./entry.js"></script>`,
  });
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

async function runWithPlan(plan: string, ...args: string[]) {
  const existing = bunEnv.LD_PRELOAD;
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: String(dir),
    env: { ...bunEnv, LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath, BUNDLE_THREAD_SPAWN_PLAN: plan },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    results: stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line)),
    stderr: stderr.trim(),
    exitCode,
    signalCode: proc.signalCode,
  };
}

describe.skipIf(skip)("Bun.build() when the bundle thread cannot be started", () => {
  test.concurrent("rejects with the error in the AggregateError", async () => {
    expect(await runWithPlan("f", "build.js", "throw", "1")).toEqual({
      results: [
        {
          settled: "rejected",
          name: "AggregateError",
          message: "Bundle failed",
          errors: [EXPECTED_ERROR],
          onEnd: false,
        },
      ],
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test.concurrent("resolves with success: false and the error in the logs under throw: false", async () => {
    expect(await runWithPlan("f", "build.js", "nothrow", "1")).toEqual({
      results: [{ settled: "resolved", success: false, logs: [EXPECTED_ERROR], onEnd: false }],
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test.concurrent("the next build starts the thread again", async () => {
    expect(await runWithPlan("fs", "build.js", "nothrow", "2")).toEqual({
      results: [
        { settled: "resolved", success: false, logs: [EXPECTED_ERROR], onEnd: false },
        { settled: "resolved", success: true, logs: [], onEnd: true },
      ],
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test.concurrent("every build fails while the thread keeps failing to start", async () => {
    expect(await runWithPlan("f", "build.js", "nothrow", "2")).toEqual({
      results: [
        { settled: "resolved", success: false, logs: [EXPECTED_ERROR], onEnd: false },
        { settled: "resolved", success: false, logs: [EXPECTED_ERROR], onEnd: false },
      ],
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test.concurrent("an HTML route in Bun.serve answers 500, then builds once the thread starts", async () => {
    const { stderr, ...rest } = await runWithPlan("fs", "serve.js");
    expect({ ...rest, stderrLines: stderr.split("\n") }).toEqual({
      results: [{ first: 500, second: 200 }],
      // The failed first build's log, then the second request's bundle timing.
      stderrLines: [`error: ${EXPECTED_ERROR}`, expect.stringMatching(/^\[[\d.]+m?s\] bundle index\.html /)],
      exitCode: 0,
      signalCode: null,
    });
  });
});
