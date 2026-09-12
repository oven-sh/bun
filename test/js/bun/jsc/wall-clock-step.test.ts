// Timeouts are durations. A wait that hands the kernel an absolute CLOCK_REALTIME deadline, or that
// re-checks a wall-clock copy of its deadline after waking, gets longer or shorter when the system
// clock is set while it waits (an NTP step after a VM resume, a manual `date -s`, a board without an
// RTC getting its first sync). These tests put an LD_PRELOAD shim in the child that shifts what
// clock_gettime(CLOCK_REALTIME) returns. The kernel's clock is untouched, so "userspace reads
// realtime 30 s ahead of the kernel" is the same arithmetic as "the system clock stepped back 30 s
// right after the deadline was computed". CLOCK_MONOTONIC is left alone, so every elapsed time below
// is measured with performance.now().
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "path";

const cc = isLinux ? Bun.which("cc") || Bun.which("gcc") || Bun.which("clang") : null;

// FAKE_REALTIME_OFFSET: seconds added to CLOCK_REALTIME / CLOCK_REALTIME_COARSE reads.
// FAKE_REALTIME_AFTER: if set, the offset only applies once this file exists (a step mid-run).
const SHIM_C = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdlib.h>
#include <time.h>
#include <unistd.h>

static int (*real_clock_gettime)(clockid_t, struct timespec *);
static long offset_seconds;
static const char *marker;
static int armed;

/* Runs when the loader maps the shim, before main() and before the process has a second thread. */
__attribute__((constructor)) static void init(void) {
    if (real_clock_gettime)
        return;
    const char *value = getenv("FAKE_REALTIME_OFFSET");
    offset_seconds = value ? atol(value) : 0;
    marker = getenv("FAKE_REALTIME_AFTER");
    armed = marker == NULL;
    real_clock_gettime = (int (*)(clockid_t, struct timespec *)) dlsym(RTLD_NEXT, "clock_gettime");
}

int clock_gettime(clockid_t id, struct timespec *ts) {
    if (!real_clock_gettime)
        init(); /* called from an earlier constructor: still single-threaded */
    int result = real_clock_gettime(id, ts);
    if (result || !offset_seconds || (id != CLOCK_REALTIME && id != CLOCK_REALTIME_COARSE))
        return result;
    if (!__atomic_load_n(&armed, __ATOMIC_ACQUIRE) && access(marker, F_OK) == 0)
        __atomic_store_n(&armed, 1, __ATOMIC_RELEASE);
    if (__atomic_load_n(&armed, __ATOMIC_ACQUIRE))
        ts->tv_sec += offset_seconds;
    return result;
}
`;

// Userspace realtime this far ahead of the kernel's. An unfixed wait lasts its timeout plus this.
const OFFSET_SECONDS = 30;
// Every timeout below is well under this, and OFFSET_SECONDS is well over it.
const LIMIT_MS = 10_000;

// Every fixture reports Date.now() as the child sees it. The parent checks that it is OFFSET_SECONDS
// ahead of its own, which proves the shim reached the child's clock_gettime() before any timing
// assertion is trusted. (In ASAN builds the call goes through the sanitizer's interceptor first and
// only reaches the preloaded shim through its RTLD_NEXT lookup, so this is worth checking.)
const fixtures = {
  "shim.c": SHIM_C,

  "atomics-wait.js": /* js */ `
    const start = performance.now();
    const result = Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    console.log(JSON.stringify({ wallNow: Date.now(), result, elapsed: performance.now() - start }));
  `,

  // The clock steps back while the main thread is already parked: a child shell arms the shim 100 ms
  // into a 1 s wait. The kernel wakes the thread on time either way; what kept it waiting was the
  // re-check of a wall-clock copy of the deadline after the wakeup, which is not specific to Linux.
  "atomics-wait-step.js": /* js */ `
    require("node:child_process").spawn("sh", ["-c", 'sleep 0.1 && : > "$FAKE_REALTIME_AFTER"'], { stdio: "inherit" });
    const wallBefore = Date.now();
    const start = performance.now();
    const result = Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    const elapsed = performance.now() - start;
    console.log(JSON.stringify({ wallBefore, wallNow: Date.now(), result, elapsed }));
  `,

  "vm-timeout.js": /* js */ `
    const vm = require("node:vm");
    const start = performance.now();
    let code;
    try {
      vm.runInNewContext("while (true) {}", {}, { timeout: 200 });
    } catch (e) {
      code = e.code;
    }
    console.log(JSON.stringify({ wallNow: Date.now(), code, elapsed: performance.now() - start }));
  `,

  // Several workers at once: stopping a busy thread only rides a timed wait when the first trap
  // request does not land on its own, which is most runs but not every run. With four workers an
  // unfixed build misses LIMIT_MS in all but a small fraction of runs.
  "worker-terminate.js": /* js */ `
    const { Worker } = require("node:worker_threads");
    const workers = Array.from({ length: 4 }, () =>
      new Worker("require('node:worker_threads').parentPort.postMessage('up'); while (true) {}", { eval: true }),
    );
    let up = 0;
    for (const worker of workers) {
      worker.once("message", async () => {
        if (++up !== workers.length) return;
        const start = performance.now();
        await Promise.all(workers.map(w => w.terminate()));
        console.log(JSON.stringify({ wallNow: Date.now(), elapsed: performance.now() - start }));
      });
    }
  `,

  "busy.js": /* js */ `
    function work(n) { let s = 0; for (let i = 0; i < n; i++) s += Math.sqrt(i); return s; }
    const wallBefore = Date.now();
    const start = performance.now();
    while (performance.now() - start < 200) work(1e4);
    if (process.env.FAKE_REALTIME_AFTER) {
      // Step the clock now, halfway through the profile.
      require("fs").writeFileSync(process.env.FAKE_REALTIME_AFTER, "");
      while (performance.now() - start < 400) work(1e4);
    }
    console.log(JSON.stringify({ wallBefore, wallNow: Date.now() }));
  `,
};

let temp: ReturnType<typeof tempDir> | undefined;
let dir: string;
let shim: string;

beforeAll(async () => {
  if (!cc) return;
  temp = tempDir("wall-clock-step", fixtures);
  dir = String(temp);
  shim = join(dir, "shim.so");
  await using proc = Bun.spawn({
    cmd: [cc, "-shared", "-fPIC", "-O1", "-o", shim, join(dir, "shim.c"), "-ldl"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`failed to compile the clock shim:\n${stdout}${stderr}`);
});

afterAll(() => {
  temp?.[Symbol.dispose]();
});

function shimEnv(extra: Record<string, string> = {}) {
  return {
    ...bunEnv,
    LD_PRELOAD: bunEnv.LD_PRELOAD ? `${shim}:${bunEnv.LD_PRELOAD}` : shim,
    FAKE_REALTIME_OFFSET: String(OFFSET_SECONDS),
    ...extra,
  };
}

// Runs a fixture under the shim and returns the JSON object on its last stdout line. Fails right here
// if the child's wall clock does not show the offset, so an inert shim is a red test, not a pass.
async function run(args: string[], extra: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: dir,
    env: shimEnv(extra),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toStartWith("{");
  const output = JSON.parse(stdout.trim());
  const offsetSeconds = Number(extra.FAKE_REALTIME_OFFSET ?? OFFSET_SECONDS);
  const skewMs = output.wallNow - Date.now();
  if (offsetSeconds > 0) expect(skewMs).toBeGreaterThan(offsetSeconds * 1000 - LIMIT_MS);
  else expect(skewMs).toBeLessThan(offsetSeconds * 1000 + LIMIT_MS);
  expect(exitCode).toBe(0);
  return output;
}

function readProfile(out: string) {
  const file = readdirSync(out).find(f => f.endsWith(".cpuprofile"));
  expect(file).toBeString();
  return JSON.parse(readFileSync(join(out, file!), "utf-8"));
}

describe.concurrent("a relative timeout does not follow the wall clock", () => {
  test.skipIf(!cc)("Atomics.wait", async () => {
    const { result, elapsed } = await run(["atomics-wait.js"]);
    expect(result).toBe("timed-out");
    expect(elapsed).toBeGreaterThanOrEqual(200);
    expect(elapsed).toBeLessThan(LIMIT_MS);
  });

  test.skipIf(!cc)("Atomics.wait while the clock steps back mid-wait", async () => {
    const { wallBefore, wallNow, result, elapsed } = await run(["atomics-wait-step.js"], {
      FAKE_REALTIME_OFFSET: "-30",
      FAKE_REALTIME_AFTER: join(dir, "step-during-wait"),
    });
    // The step landed inside the wait: the clock read true when it began and 30 s behind after it.
    expect(Math.abs(wallBefore - Date.now())).toBeLessThan(LIMIT_MS * 6);
    expect(wallNow - wallBefore).toBeLessThan(LIMIT_MS - 30_000);
    expect(result).toBe("timed-out");
    expect(elapsed).toBeGreaterThanOrEqual(1000);
    expect(elapsed).toBeLessThan(LIMIT_MS);
  });

  test.skipIf(!cc)("node:vm timeout", async () => {
    const { code, elapsed } = await run(["vm-timeout.js"]);
    expect(code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
    expect(elapsed).toBeGreaterThanOrEqual(200);
    expect(elapsed).toBeLessThan(LIMIT_MS);
  });

  test.skipIf(!cc)("worker.terminate() on busy workers", async () => {
    const { elapsed } = await run(["worker-terminate.js"]);
    expect(elapsed).toBeLessThan(LIMIT_MS);
  });

  test.skipIf(!cc)("--cpu-prof keeps sampling", async () => {
    const out = join(dir, "prof-sampling");
    await run(["--cpu-prof", "--cpu-prof-dir", out, "busy.js"]);
    // The sampler sleeps before every sample. Unfixed, the first of those 1 ms sleeps lasts
    // OFFSET_SECONDS, longer than the process lives, so the profile has at most one sample. How many a
    // fixed build takes in 200 ms depends on how busy the machine is, so only ask for more than that.
    expect(readProfile(out).samples.length).toBeGreaterThan(1);
  });
});

// The .cpuprofile timeline is built from the samples' monotonic timestamps. Reading the wall clock
// for each of them instead put every sample taken after a backward step before the profile's start:
// DevTools drew an hour-long (or negative) flame chart for a 400 ms run.
test.skipIf(!cc)("--cpu-prof timeline survives a clock step in the middle of the profile", async () => {
  const out = join(dir, "prof-timeline");
  const { wallBefore, wallNow } = await run(["--cpu-prof", "--cpu-prof-dir", out, "busy.js"], {
    FAKE_REALTIME_OFFSET: "-3600",
    FAKE_REALTIME_AFTER: join(dir, "step-now"),
  });
  // The step happened while the profile was running: the clock read normally before the marker
  // was written (run() checked that it reads an hour behind afterwards).
  expect(Math.abs(wallBefore - Date.now())).toBeLessThan(LIMIT_MS * 6);
  expect(wallNow - wallBefore).toBeLessThan(-3500_000);

  const profile = readProfile(out);
  const spanMs = (profile.endTime - profile.startTime) / 1000;
  expect(spanMs).toBeGreaterThan(200);
  expect(spanMs).toBeLessThan(60_000);
  // Still microseconds on the Unix epoch, and no delta runs backwards.
  expect(profile.startTime).toBeGreaterThan(1e15);
  expect(profile.startTime).toBeLessThan(3e15);
  expect(Math.min(...profile.timeDeltas)).toBeGreaterThanOrEqual(0);
  expect(profile.timeDeltas.reduce((a: number, b: number) => a + b, 0) / 1000).toBeLessThan(60_000);
});
