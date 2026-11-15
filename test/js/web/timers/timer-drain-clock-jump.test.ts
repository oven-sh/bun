// One CLOCK_MONOTONIC reading that is seconds too high (a resumed VM returns the
// old time plus the pause for about a millisecond) must not keep the timer drain
// from returning to the poll. An LD_PRELOAD shim adds CLOCK_JUMP_S seconds to the
// readings the main thread makes between process.getuid() and process.getgid().
// The fixture arms it at the end of one callback, so the drain's own reading of
// the clock is too high, and disarms it at the start of the next callback, so
// the deadline of the timer that callback sets comes from the real clock.
import { beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <unistd.h>
#include <sys/syscall.h>
#include <sys/types.h>

static int (*real_clock_gettime)(clockid_t, struct timespec *);
static uid_t (*real_getuid)(void);
static gid_t (*real_getgid)(void);
static int armed = 0;
static int bumped = 0;

static int on_main_thread(void) { return syscall(SYS_gettid) == getpid(); }

int clock_gettime(clockid_t id, struct timespec *ts) {
    if (!real_clock_gettime) real_clock_gettime = (int (*)(clockid_t, struct timespec *)) dlsym(RTLD_NEXT, "clock_gettime");
    int r = real_clock_gettime(id, ts);
    if (r != 0 || id != CLOCK_MONOTONIC || !armed || !on_main_thread()) return r;
    ts->tv_sec += atol(getenv("CLOCK_JUMP_S"));
    bumped++;
    return r;
}

uid_t getuid(void) {
    if (!real_getuid) real_getuid = (uid_t (*)(void)) dlsym(RTLD_NEXT, "getuid");
    if (on_main_thread()) armed = 1;
    return real_getuid();
}

gid_t getgid(void) {
    if (!real_getgid) real_getgid = (gid_t (*)(void)) dlsym(RTLD_NEXT, "getgid");
    if (on_main_thread() && armed) {
        armed = 0;
        char line[64];
        int n = snprintf(line, sizeof line, "[shim] bumped %d readings\\n", bumped);
        write(2, line, (size_t) n);
    }
    return real_getgid();
}
`;

// Callback 3 arms the shim after it sets timer 4. Callback 4 disarms it, then
// sets timer 5 from a real reading: due by the drain's too-high reading, so the
// unfixed drain fires it at once, again and again. Callback 5 reports how long
// after callback 4 it ran. With NESTED=1, callback 4 first runs a nested event
// loop: Bun.build waits for an async plugin setup before it returns.
const FIXTURE = /* js */ `
let n = 0;
let t4 = 0;
let nestedFired = 0;
function tick() {
  n++;
  if (n > 3) process.getgid();
  if (n === 4) {
    t4 = performance.now();
    if (process.env.NESTED) {
      Bun.build({
        entrypoints: ["./entry.js"],
        plugins: [{ name: "sleep", setup: async () => { await Bun.sleep(5); nestedFired++; } }],
      });
    }
  }
  if (n === 5) console.log("gap5=" + (performance.now() - t4).toFixed(1));
  setTimeout(tick, 20);
  if (n === 3) process.getuid();
}
setTimeout(tick, 20);
process.on("SIGTERM", () => {
  console.log("callbacks=" + n + " nestedFired=" + nestedFired);
  process.exit(0);
});
`;

let dir: ReturnType<typeof tempDir>;
let shimPath: string;

beforeAll(async () => {
  if (!isLinux || !cc) return;
  dir = tempDir("timer-clock-jump", { "shim.c": SHIM_C, "tick.js": FIXTURE, "entry.js": "export default 1;" });
  shimPath = join(String(dir), "shim.so");
  await using ccProc = Bun.spawn({
    cmd: [cc, "-shared", "-fPIC", "-o", shimPath, join(String(dir), "shim.c"), "-ldl"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [ccOut, ccErr, ccExit] = await Promise.all([ccProc.stdout.text(), ccProc.stderr.text(), ccProc.exited]);
  if (ccExit !== 0) throw new Error(`shim compile failed: ${ccErr || ccOut}`);
});

async function runWithJump(nested: boolean) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "tick.js"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      LD_PRELOAD: bunEnv.LD_PRELOAD ? `${shimPath}:${bunEnv.LD_PRELOAD}` : shimPath,
      CLOCK_JUMP_S: "2",
      ...(nested ? { NESTED: "1" } : {}),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  // Callback 5 runs at once inside the unfixed drain (the spin), and one turn
  // later with the fix. Either way the signal arrives during the spin, if any.
  const stderr = proc.stderr.text();
  let stdout = "";
  let signalled = false;
  for await (const chunk of proc.stdout) {
    stdout += new TextDecoder().decode(chunk);
    if (!signalled && stdout.includes("gap5=")) {
      signalled = true;
      proc.kill("SIGTERM");
    }
  }
  const exitCode = await proc.exited;
  const callbacks = Number(/callbacks=(\d+)/.exec(stdout)?.[1]);
  const gap5 = Number(/gap5=([\d.]+)/.exec(stdout)?.[1]);
  return {
    stderr: await stderr,
    callbacks: callbacks < 100 ? "few" : callbacks,
    gap5: gap5 < 1000 ? "under a second" : gap5,
    nestedFired: Number(/nestedFired=(\d+)/.exec(stdout)?.[1]),
    exitCode,
  };
}

test.skipIf(!isLinux || !cc)(
  "a timer drain with one clock reading seconds too high still returns to the poll",
  async () => {
    expect(await runWithJump(false)).toEqual({
      stderr: expect.stringMatching(/\[shim\] bumped [1-9]\d* readings/),
      callbacks: "few",
      gap5: "under a second",
      nestedFired: 0,
      exitCode: 0,
    });
  },
);

test.skipIf(!isLinux || !cc)(
  "a timer set after a nested event loop in the callback waits for the next turn too",
  async () => {
    expect(await runWithJump(true)).toEqual({
      stderr: expect.stringMatching(/\[shim\] bumped [1-9]\d* readings/),
      callbacks: "few",
      gap5: "under a second",
      nestedFired: 1,
      exitCode: 0,
    });
  },
);
