// Bun.build() (and HTML routes in Bun.serve) run on one lazily started
// "Bundler" thread. Starting it takes two OS resources, and an LD_PRELOAD shim
// fails either one: pthread_create with EAGAIN (what the kernel returns at the
// RLIMIT_NPROC / cgroup pids limit), or the eventfd the thread wakes up on with
// EMFILE (the open-files limit). Both used to abort the whole process ("panic:
// Failed to spawn bun build thread" / "panic: Failed to create waker"); they
// have to fail the build like any other build error, and a later build has to
// try starting the thread again.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
const skip = !isLinux || !cc;

// Nothing at pthread_create() time says which thread is being created (the name
// is set by the thread itself, and under ASAN every thread even gets the same
// entry point), so the shim goes by the requested stack size, and the fixtures
// are run with RUST_MIN_STACK set to a size nothing else asks for. Rust's std
// applies it to the threads spawned without an explicit size, and in these
// fixtures the bundle thread is the only one: bun's pools, its HTTP client
// thread and the Bun.file() IO thread pass explicit sizes, and JSC's and the
// allocators' threads are not created through std. (Matching std's default
// 2 MiB instead is ambiguous: JSC's threads use the attr default, which glibc
// derives from RLIMIT_STACK, and that is 2 MiB on agents running with an
// unlimited stack.) A multiple of 64 KiB so std's page rounding leaves it as is.
//
// eventfd() is easier to attribute: the bundle thread names itself "Bundler"
// before creating its waker, and no other thread with that name calls it.
const BUNDLE_THREAD_STACK_SIZE = 35 * 64 * 1024;

// The highest value Linux reserves for errnos; far beyond the ones bun names.
// Stands in for what Windows produces for most failed thread creations: an OS
// code with no errno equivalent.
const UNNAMED_ERRNO = 4095;

// A plan has one letter per intercepted attempt: 'f' fails it with the
// resource-limit errno (EAGAIN for pthread_create, EMFILE for eventfd), 'n'
// with ENOMEM, 'u' with a code bun has no errno name for, 's' lets it through;
// the last letter repeats. BUNDLE_THREAD_SPAWN_PLAN applies to pthread_create
// calls for the bundle thread, BUNDLE_THREAD_WAKER_PLAN to eventfd() calls
// made by the bundle thread.
const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>

static int (*real_pthread_create)(pthread_t *, const pthread_attr_t *, void *(*)(void *), void *);
static int (*real_eventfd)(unsigned int, int);
static const char *spawn_plan, *waker_plan;
static size_t spawn_attempts, waker_attempts;

__attribute__((constructor)) static void init(void) {
  real_pthread_create = dlsym(RTLD_NEXT, "pthread_create");
  real_eventfd = dlsym(RTLD_NEXT, "eventfd");
  spawn_plan = getenv("BUNDLE_THREAD_SPAWN_PLAN");
  waker_plan = getenv("BUNDLE_THREAD_WAKER_PLAN");
}

// 0 when the plan is unset or the step is 's' (let it through).
static char plan_step(const char *plan, size_t *attempts) {
  size_t len = plan ? strlen(plan) : 0;
  if (len == 0) return 0;
  size_t i = __sync_fetch_and_add(attempts, 1);
  char step = plan[i < len ? i : len - 1];
  return step == 's' ? 0 : step;
}

int pthread_create(pthread_t *thread, const pthread_attr_t *attr, void *(*start)(void *), void *arg) {
  size_t stack_size = 0;
  if (attr) pthread_attr_getstacksize(attr, &stack_size);
  if (stack_size == ${BUNDLE_THREAD_STACK_SIZE}) {
    switch (plan_step(spawn_plan, &spawn_attempts)) {
      case 'f': return EAGAIN;
      case 'n': return ENOMEM;
      case 'u': return ${UNNAMED_ERRNO};
    }
  }
  return real_pthread_create(thread, attr, start, arg);
}

int eventfd(unsigned int initval, int flags) {
  char name[16] = {0};
  if (prctl(PR_GET_NAME, name) == 0 && strcmp(name, "Bundler") == 0) {
    switch (plan_step(waker_plan, &waker_attempts)) {
      case 'f': errno = EMFILE; return -1;
      case 'n': errno = ENOMEM; return -1;
    }
  }
  return real_eventfd(initval, flags);
}
`;

const MODES = [
  {
    name: "pthread_create fails",
    planEnv: "BUNDLE_THREAD_SPAWN_PLAN",
    error:
      "Failed to start the bundler thread: EAGAIN. The process or thread limit may have been reached (ulimit -u, or the container's pids limit).",
  },
  {
    name: "creating its waker fails",
    planEnv: "BUNDLE_THREAD_WAKER_PLAN",
    error:
      "Failed to start the bundler thread: EMFILE. The open file limit may have been reached (ulimit -n, or the system-wide limit).",
  },
];

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

// Bun.build() tries to start the thread before returning its promise; this
// exits while the failed build's completion is still queued. Run with
// BUN_DESTRUCT_VM_ON_EXIT, the exit tears the VM down the way a finished
// Worker's is, which has to release that completion like any other build's
// instead of hanging on it or freeing it twice.
const EXIT_FIXTURE = /* js */ `
Bun.build({ entrypoints: [import.meta.dirname + "/entry.js"], throw: false });
console.log(JSON.stringify({ exiting: true }));
process.exit(0);
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
    "exit.js": EXIT_FIXTURE,
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

async function runWithPlan(planEnv: string, plan: string, args: string[], env: Record<string, string> = {}) {
  const existing = bunEnv.LD_PRELOAD;
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: String(dir),
    env: {
      ...bunEnv,
      LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath,
      RUST_MIN_STACK: String(BUNDLE_THREAD_STACK_SIZE),
      [planEnv]: plan,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
    // A teardown that waits for a completion that never comes hangs the fixture;
    // turn that into a failure the concurrent tests do not leave behind.
    timeout: 30_000,
    killSignal: "SIGKILL",
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

describe.skipIf(skip)("Bun.build() when the bundle thread cannot be started because", () => {
  describe.each(MODES)("$name", ({ planEnv, error }) => {
    test.concurrent("rejects with the error in the AggregateError", async () => {
      expect(await runWithPlan(planEnv, "f", ["build.js", "throw", "1"])).toEqual({
        results: [
          {
            settled: "rejected",
            name: "AggregateError",
            message: "Bundle failed",
            errors: [error],
            onEnd: false,
          },
        ],
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });

    test.concurrent("resolves with success: false and the error in the logs under throw: false", async () => {
      expect(await runWithPlan(planEnv, "f", ["build.js", "nothrow", "1"])).toEqual({
        results: [{ settled: "resolved", success: false, logs: [error], onEnd: false }],
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });

    test.concurrent("reports other errors without the resource-limit hint", async () => {
      expect(await runWithPlan(planEnv, "n", ["build.js", "nothrow", "1"])).toEqual({
        results: [
          { settled: "resolved", success: false, logs: ["Failed to start the bundler thread: ENOMEM."], onEnd: false },
        ],
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });

    test.concurrent("the next build starts the thread again", async () => {
      expect(await runWithPlan(planEnv, "fs", ["build.js", "nothrow", "2"])).toEqual({
        results: [
          { settled: "resolved", success: false, logs: [error], onEnd: false },
          { settled: "resolved", success: true, logs: [], onEnd: true },
        ],
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });

    test.concurrent("every build fails while the thread keeps failing to start", async () => {
      expect(await runWithPlan(planEnv, "f", ["build.js", "nothrow", "2"])).toEqual({
        results: [
          { settled: "resolved", success: false, logs: [error], onEnd: false },
          { settled: "resolved", success: false, logs: [error], onEnd: false },
        ],
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });

    test.concurrent("a VM torn down before the failed build's completion ran releases it", async () => {
      expect(await runWithPlan(planEnv, "f", ["exit.js"], { BUN_DESTRUCT_VM_ON_EXIT: "1" })).toEqual({
        results: [{ exiting: true }],
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });

    test.concurrent("an HTML route in Bun.serve answers 500, then builds once the thread starts", async () => {
      const { stderr, ...rest } = await runWithPlan(planEnv, "fs", ["serve.js"]);
      expect({ ...rest, stderrLines: stderr.split("\n") }).toEqual({
        results: [{ first: 500, second: 200 }],
        // The failed first build's log, then the second request's bundle timing.
        stderrLines: [`error: ${error}`, expect.stringMatching(/^\[[\d.]+m?s\] bundle index\.html /)],
        exitCode: 0,
        signalCode: null,
      });
    });
  });

  // pthread_create only: an eventfd error always comes from the OS with an
  // errno, so the unnamed-code path is reachable just for the thread spawn.
  test.concurrent("reports an error bun has no errno name for as the OS describes it", async () => {
    expect(await runWithPlan("BUNDLE_THREAD_SPAWN_PLAN", "u", ["build.js", "nothrow", "1"])).toEqual({
      results: [
        {
          settled: "resolved",
          success: false,
          // The text is the libc's; glibc and musl word it differently.
          logs: [
            expect.stringMatching(
              new RegExp(String.raw`^Failed to start the bundler thread: .+ \(os error ${UNNAMED_ERRNO}\)$`),
            ),
          ],
          onEnd: false,
        },
      ],
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
});
