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

// Nothing at pthread_create() time says which thread is being created (the name
// is set by the thread itself, and under ASAN every thread even gets the same
// entry point), so the shim narrows it down three ways. The thread has to be
// created by the main thread, the one running Bun.build() / the request handler,
// with Rust's default 2 MiB stack (bun's pools and its HTTP client thread use
// 4 MiB, the allocators pass no attributes), and only while the fixture has the
// BUNDLE_THREAD_SPAWN_ARMED_FILE in place, which it is exactly around the calls
// that start the bundle thread. JSC's on-demand threads also use 2 MiB on ASAN
// builds; the fixtures run a GC right before arming so those are already up.
// Other std-spawned 2 MiB threads (file watchers, the Bun.file() IO thread)
// would be caught too, so the fixtures must not use fs.watch or Bun.file()
// while armed.
const BUNDLE_THREAD_STACK_SIZE = 2 * 1024 * 1024;

// The highest value Linux reserves for errnos; far beyond the ones bun names.
// Stands in for what Windows produces for most failed thread creations: an OS
// code with no errno equivalent.
const UNNAMED_ERRNO = 4095;

// BUNDLE_THREAD_SPAWN_PLAN has one letter per such attempt: 'f' fails it with
// EAGAIN (a thread limit), 'n' with ENOMEM, 'u' with a code bun has no errno
// name for, 's' lets it through; the last letter repeats.
const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

static int (*real_pthread_create)(pthread_t *, const pthread_attr_t *, void *(*)(void *), void *);
static const char *armed_file;
static const char *plan;
static size_t plan_len;
static size_t attempts;

__attribute__((constructor)) static void init(void) {
  real_pthread_create = dlsym(RTLD_NEXT, "pthread_create");
  armed_file = getenv("BUNDLE_THREAD_SPAWN_ARMED_FILE");
  plan = getenv("BUNDLE_THREAD_SPAWN_PLAN");
  plan_len = plan ? strlen(plan) : 0;
}

int pthread_create(pthread_t *thread, const pthread_attr_t *attr, void *(*start)(void *), void *arg) {
  size_t stack_size = 0;
  if (attr) pthread_attr_getstacksize(attr, &stack_size);
  if (stack_size == ${BUNDLE_THREAD_STACK_SIZE} && plan_len > 0 && armed_file &&
      syscall(SYS_gettid) == getpid() && access(armed_file, F_OK) == 0) {
    size_t i = __sync_fetch_and_add(&attempts, 1);
    switch (plan[i < plan_len ? i : plan_len - 1]) {
      case 'f': return EAGAIN;
      case 'n': return ENOMEM;
      case 'u': return ${UNNAMED_ERRNO};
    }
  }
  return real_pthread_create(thread, attr, start, arg);
}
`;

const EXPECTED_ERROR =
  "Failed to start the bundler thread: EAGAIN. The process or thread limit may have been reached (ulimit -u, or the container's pids limit).";

// The sync fs calls arm and disarm the shim without creating threads themselves.
const ARM_HELPERS = /* js */ `
import { unlinkSync, writeFileSync } from "node:fs";
function arm() {
  Bun.gc(true);
  writeFileSync(process.env.BUNDLE_THREAD_SPAWN_ARMED_FILE, "");
}
function disarm() {
  unlinkSync(process.env.BUNDLE_THREAD_SPAWN_ARMED_FILE);
}
`;

// Prints one JSON line per Bun.build() call; `throw` is taken from argv so the
// same fixture covers the rejecting and the { success: false } flavors.
// Bun.build() starts the bundle thread before it returns its promise.
const BUILD_FIXTURE = /* js */ `
${ARM_HELPERS}
const [, , throwArg, count] = process.argv;
for (let i = 0; i < Number(count); i++) {
  let onEnd = "not called";
  const plugin = { name: "record", setup(build) { build.onEnd(result => { onEnd = result.success; }); } };
  arm();
  let build;
  try {
    build = Bun.build({
      entrypoints: [import.meta.dirname + "/entry.js"],
      throw: throwArg === "throw",
      plugins: [plugin],
    });
  } finally {
    disarm();
  }
  try {
    const result = await build;
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
${ARM_HELPERS}
import index from "./index.html";
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", development: { hmr: false }, routes: { "/": index } });
arm();
let first, second;
try {
  first = await fetch(server.url);
  second = await fetch(server.url);
} finally {
  disarm();
}
console.log(JSON.stringify({ first: first.status, second: second.status }));
server.stop(true);
`;

// Exits while the failed build's completion is still queued. Run with
// BUN_DESTRUCT_VM_ON_EXIT, the exit tears the VM down the way a finished
// Worker's is, which has to release that completion like any other build's
// instead of hanging on it or freeing it twice.
const EXIT_FIXTURE = /* js */ `
${ARM_HELPERS}
arm();
try {
  Bun.build({ entrypoints: [import.meta.dirname + "/entry.js"], throw: false });
} finally {
  disarm();
}
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

let runs = 0;

async function runWithPlan(plan: string, args: string[], env: Record<string, string> = {}) {
  const existing = bunEnv.LD_PRELOAD;
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: String(dir),
    env: {
      ...bunEnv,
      LD_PRELOAD: existing ? `${shimPath}:${existing}` : shimPath,
      BUNDLE_THREAD_SPAWN_PLAN: plan,
      // Per run: a fixture that crashes while armed must not arm the others.
      BUNDLE_THREAD_SPAWN_ARMED_FILE: join(String(dir), `armed-${runs++}`),
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

describe.skipIf(skip)("Bun.build() when the bundle thread cannot be started", () => {
  test.concurrent("rejects with the error in the AggregateError", async () => {
    expect(await runWithPlan("f", ["build.js", "throw", "1"])).toEqual({
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
    expect(await runWithPlan("f", ["build.js", "nothrow", "1"])).toEqual({
      results: [{ settled: "resolved", success: false, logs: [EXPECTED_ERROR], onEnd: false }],
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test.concurrent("reports other errors without the thread-limit hint", async () => {
    expect(await runWithPlan("n", ["build.js", "nothrow", "1"])).toEqual({
      results: [
        { settled: "resolved", success: false, logs: ["Failed to start the bundler thread: ENOMEM."], onEnd: false },
      ],
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test.concurrent("reports an error bun has no errno name for as the OS describes it", async () => {
    expect(await runWithPlan("u", ["build.js", "nothrow", "1"])).toEqual({
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

  test.concurrent("the next build starts the thread again", async () => {
    expect(await runWithPlan("fs", ["build.js", "nothrow", "2"])).toEqual({
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
    expect(await runWithPlan("f", ["build.js", "nothrow", "2"])).toEqual({
      results: [
        { settled: "resolved", success: false, logs: [EXPECTED_ERROR], onEnd: false },
        { settled: "resolved", success: false, logs: [EXPECTED_ERROR], onEnd: false },
      ],
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test.concurrent("a VM torn down before the failed build's completion ran releases it", async () => {
    expect(await runWithPlan("f", ["exit.js"], { BUN_DESTRUCT_VM_ON_EXIT: "1" })).toEqual({
      results: [{ exiting: true }],
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test.concurrent("an HTML route in Bun.serve answers 500, then builds once the thread starts", async () => {
    const { stderr, ...rest } = await runWithPlan("fs", ["serve.js"]);
    expect({ ...rest, stderrLines: stderr.split("\n") }).toEqual({
      results: [{ first: 500, second: 200 }],
      // The failed first build's log, then the second request's bundle timing.
      stderrLines: [`error: ${EXPECTED_ERROR}`, expect.stringMatching(/^\[[\d.]+m?s\] bundle index\.html /)],
      exitCode: 0,
      signalCode: null,
    });
  });
});
