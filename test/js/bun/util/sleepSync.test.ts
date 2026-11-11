import { sleepSync } from "bun";
import { describe, expect, it, jest } from "bun:test";
import { bunEnv, bunExe, compileFixture, isASAN, isLinux, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

it("sleepSync uses milliseconds", async () => {
  const start = performance.now();
  sleepSync(50);
  const end = performance.now();
  expect(end - start).toBeGreaterThanOrEqual(5);
  expect(end - start).toBeLessThan(1000);
});

it("sleepSync with no arguments throws", async () => {
  // @ts-expect-error
  expect(() => sleepSync()).toThrow(
    expect.objectContaining({
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: "milliseconds must be a number",
    }),
  );
});

it("sleepSync with non-numbers throws", async () => {
  const valueOf = jest.fn(() => 1);
  const invalidValues = [true, false, "hi", "1", 1n, {}, [], undefined, null, new Number(1), { valueOf }] as any[];
  for (const v of invalidValues) {
    expect(() => sleepSync(v)).toThrow(
      expect.objectContaining({
        name: "TypeError",
        code: "ERR_INVALID_ARG_TYPE",
        message: "milliseconds must be a number",
      }),
    );
  }
  expect(valueOf).not.toHaveBeenCalled();
});

it("sleepSync with negative number throws", async () => {
  for (const [v, got] of [
    [-10, -10],
    [-1.5, -1],
    [-Infinity, -2147483648],
  ]) {
    expect(() => sleepSync(v)).toThrow(
      expect.objectContaining({
        name: "TypeError",
        code: "ERR_INVALID_ARG_TYPE",
        message: `argument to sleepSync must not be negative, got ${got}`,
      }),
    );
  }
});

it("sleepSync takes -0, a fraction above -1 and NaN as 0", async () => {
  for (const v of [-0, -0.9, NaN]) expect(sleepSync(v)).toBeUndefined();
});

it("can map with sleepSync", async () => {
  [1, 2, 3].map(sleepSync);
});

// Free blocks inside pages that are still in use belong to the thread that owns the pages. They go back to the OS
// when that thread tells mimalloc that it is about to block.
it.skipIf(isASAN /* malloc is not mimalloc */)(
  "sleepSync lets mimalloc release this thread's free memory",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
      const { heapStats } = require("bun:jsc");
      const purgeCalls = () => heapStats().mimalloc.purge_calls;
      const spin = ms => { const start = performance.now(); while (performance.now() - start < ms); };

      // the characters of these strings are allocated and freed by this thread
      let strings = [];
      for (let i = 0; i < 100000; i++) strings.push(Buffer.alloc(900 + (i % 5) * 8, 97).toString("latin1"));
      // (far enough apart that whole OS pages are free in between, also where those are 16 KB)
      strings = strings.filter((_, i) => i % 64 === 0);
      Bun.gc(true);

      // what needs no idle thread settles first, without going idle
      let before = purgeCalls();
      for (let stable = 0, tries = 0; stable < 3 && tries < 50; tries++) {
        spin(60);
        const now = purgeCalls();
        stable = now === before ? stable + 1 : 0;
        before = now;
      }

      let released = 0;
      for (let i = 0; i < 20 && released < 500; i++) {
        Bun.sleepSync(100);
        released = purgeCalls() - before;
      }
      console.log(released >= 500, strings.length);
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "true 1563\n", stderr: "", exitCode: 0 });
  },
);

// The program of a child that sleeps until a `sh` loop has sent it SIGUSR2 `signals` times. The loop sends a signal
// only when /proc shows the main thread blocked. Most of them interrupt a sleep. One can find the thread in another
// wait, or arrive after the sleep ended, so nothing here counts them. The sleeps take 100 and 101 ms in turn: a
// library under the child can then tell the next sleep from one that starts again. `sleeps` gets how long each took.
const sleepsWhileSignalled = (signals: number) => `
      const sleeps = [];
      {
        const fs = require("node:fs");
        // The state is the field after the command name: "S" is blocked, "Z" has ended.
        const state = file => {
          const stat = fs.readFileSync(file, "latin1");
          return stat[stat.lastIndexOf(")") + 2];
        };
        const sender = Bun.spawn({
          cmd: [
            "sh",
            "-c",
            // It ends when the process it signals is gone.
            "sent=0; while [ $sent -lt ${signals} ]; do read -r stat < /proc/$1/task/$1/stat || exit; " +
              'stat=\${stat##*) }; if [ "\${stat%% *}" = S ]; then kill -USR2 $1; sent=$((sent + 1)); fi; done',
            "sh",
            String(process.pid),
          ],
          env: { PATH: process.env.PATH },
          stdio: ["ignore", "ignore", "inherit"],
        });
        const senderEnded = () => {
          try {
            return state("/proc/" + sender.pid + "/stat") === "Z";
          } catch (error) {
            // Another thread can take the ended process away first.
            if (error.code === "ENOENT" || error.code === "ESRCH") return true;
            throw error;
          }
        };
        do {
          const start = performance.now();
          Bun.sleepSync(100 + (sleeps.length % 2));
          sleeps.push(performance.now() - start);
        } while (!senderEnded());
      }
`;

// A sleep that goes on for the time the kernel reports as left after a signal ends late. That time leaves out what
// the handler takes, and on Linux it has the thread's timer slack added: 50 us by default, 200 ms here, so ten signals
// add two seconds. Only Linux has /proc/self/timerslack_ns.
it.skipIf(!isLinux)("sleepSync ends at its deadline when signals interrupt it", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      let heard = 0;
      const { promise: heardAll, resolve } = Promise.withResolvers();
      process.on("SIGUSR2", () => {
        if (++heard === 10) resolve();
      });
      require("node:fs").writeFileSync("/proc/self/timerslack_ns", "200000000");
      const slack = require("node:fs").readFileSync("/proc/self/timerslack_ns", "utf8").trim();
      ${sleepsWhileSignalled(10)}
      await heardAll;
      // A sleep that is on time ends between its deadline and one slack later. The rest is room for a busy machine.
      const onTime = sleeps.every(elapsed => elapsed >= 100 && elapsed < 1500);
      console.log(JSON.stringify({ slack, heard, sleeps: onTime ? "on time" : sleeps }));
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: JSON.stringify({ slack: "200000000", heard: 10, sleeps: "on time" }) + "\n",
    stderr: "",
    exitCode: 0,
  });
});

// The kernel blocks a thread for its timer slack even for a sleep of zero, so a zero duration must not reach it.
// Linux counts one voluntary context switch each time a thread blocks.
it.skipIf(!isLinux)("sleepSync(0) does not block the thread", () => {
  const timesBlocked = () =>
    Number(/^voluntary_ctxt_switches:\s*(\d+)$/m.exec(readFileSync("/proc/thread-self/status", "utf8"))![1]);
  const before = timesBlocked();
  for (let i = 0; i < 1000; i++) sleepSync(0);
  expect(timesBlocked() - before).toBeLessThan(100);
});

// Each case changes one thing under the main thread of the child and says so on stderr, once. Without that line a
// case proves nothing: the library did not load, or the sleep no longer goes through clock_nanosleep. SLEEP_SHIM
// names the case.
const sleepShim = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

static int on_main_thread(void) { return syscall(SYS_gettid) == getpid(); }
static int is(const char *mode) {
  const char *set = getenv("SLEEP_SHIM");
  return set && !strcmp(set, mode);
}
static void say_once(int *said, const char *line) {
  if (*said) return;
  *said = 1;
  if (write(2, line, strlen(line)) < 0) abort();
}

static volatile sig_atomic_t handler_ran;

int clock_nanosleep(clockid_t clock, int flags, const struct timespec *request, struct timespec *remain) {
  typedef int sleep_fn(clockid_t, int, const struct timespec *, struct timespec *);
  static sleep_fn *real;
  static int refused, said_interrupted, said_went_on;
  static long interrupted;
  if (!real) real = (sleep_fn *)dlsym(RTLD_NEXT, "clock_nanosleep");
  if (!on_main_thread() || (flags & TIMER_ABSTIME)) return real(clock, flags, request, remain);

  // "refused-once": the first sleep of 123 ms fails.
  if (is("refused-once") && request->tv_sec == 0 && request->tv_nsec == 123000000 && !refused) {
    say_once(&refused, "sleep-shim: refused a sleep\\n");
    return EINVAL;
  }

  // "slow-handler": the handler takes longer than a sleep, so the sleep it interrupts has no time left. The next
  // request is the next sleep: a whole one, of the other length.
  long ns = request->tv_sec * 1000000000L + request->tv_nsec;
  if (interrupted && (ns == interrupted || (ns != 100000000L && ns != 101000000L)))
    say_once(&said_went_on, "sleep-shim: a sleep went on after the handler\\n");
  handler_ran = 0;
  int result = real(clock, flags, request, remain);
  interrupted = result == EINTR && handler_ran ? ns : 0;
  if (interrupted) say_once(&said_interrupted, "sleep-shim: the handler interrupted a sleep\\n");
  return result;
}

// "slow-handler": the handler of SIGUSR2 keeps its thread busy for 110 ms.
static void spend_110_ms(int signal) {
  struct timespec start, now;
  (void)signal;
  clock_gettime(CLOCK_MONOTONIC, &start);
  do clock_gettime(CLOCK_MONOTONIC, &now);
  while ((now.tv_sec - start.tv_sec) * 1000000000L + (now.tv_nsec - start.tv_nsec) < 110000000L);
  handler_ran = 1;
}

__attribute__((constructor)) static void install(void) {
  if (!is("slow-handler")) return;
  struct sigaction action;
  memset(&action, 0, sizeof action);
  action.sa_handler = spend_110_ms;
  sigemptyset(&action.sa_mask);
  sigaction(SIGUSR2, &action, NULL);
}
`;

// Built while the file loads: a hook has five seconds, and the first compile on a cold machine can take longer.
const shim = (() => {
  if (!isLinux || !(Bun.which("cc") || Bun.which("clang") || Bun.which("gcc"))) return;
  using dir = tempDir("sleep-sync-shim", { "sleep-shim.c": sleepShim });
  return compileFixture(join(String(dir), "sleep-shim.c"), { flags: ["-ldl"] });
})();

// Not concurrent: these measure time.
describe.skipIf(!shim)("sleepSync under a preloaded library", () => {
  async function run(mode: string, program: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", program],
      env: { ...bunEnv, SLEEP_SHIM: mode, LD_PRELOAD: [shim, bunEnv.LD_PRELOAD].filter(Boolean).join(":") },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // The kernel takes the time that is left when the signal wakes the thread, before the handler runs. A sleep that
  // goes on for that time ends one handler later per signal.
  it("sleepSync ends at its deadline when a signal handler is slow", async () => {
    const program = `
      ${sleepsWhileSignalled(5)}
      console.log(sleeps.every(elapsed => elapsed >= 100) ? "slept" : JSON.stringify(sleeps));
    `;
    expect(await run("slow-handler", program)).toEqual({
      stdout: "slept\n",
      stderr: "sleep-shim: the handler interrupted a sleep\n",
      exitCode: 0,
    });
  });

  it("sleepSync sleeps the whole time when the kernel refuses one sleep", async () => {
    const program = `
      const start = performance.now();
      Bun.sleepSync(123);
      console.log(performance.now() - start >= 123 ? "slept" : "returned early");
    `;
    expect(await run("refused-once", program)).toEqual({
      stdout: "slept\n",
      stderr: "sleep-shim: refused a sleep\n",
      exitCode: 0,
    });
  });
});
