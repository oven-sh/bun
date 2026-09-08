// Timeouts are durations. A wait that hands the kernel an absolute CLOCK_REALTIME deadline instead
// gets longer or shorter when the system clock is set while it waits (an NTP step after a VM resume, a
// manual `date -s`, a board without an RTC getting its first sync). These tests put an LD_PRELOAD
// shim in the child that shifts what clock_gettime(CLOCK_REALTIME) returns. The kernel's clock is
// untouched, so "userspace reads realtime 30 s ahead of the kernel" is the same arithmetic as "the
// system clock stepped back 30 s right after the deadline was computed". CLOCK_MONOTONIC is left
// alone, so every elapsed time below is measured with performance.now().
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

int clock_gettime(clockid_t id, struct timespec *ts) {
    if (!real_clock_gettime) {
        real_clock_gettime = (int (*)(clockid_t, struct timespec *)) dlsym(RTLD_NEXT, "clock_gettime");
        const char *value = getenv("FAKE_REALTIME_OFFSET");
        offset_seconds = value ? atol(value) : 0;
        marker = getenv("FAKE_REALTIME_AFTER");
        armed = marker == NULL;
    }
    int result = real_clock_gettime(id, ts);
    if (result || !offset_seconds || (id != CLOCK_REALTIME && id != CLOCK_REALTIME_COARSE))
        return result;
    if (!armed && access(marker, F_OK) == 0)
        armed = 1;
    if (armed)
        ts->tv_sec += offset_seconds;
    return result;
}
`;

// Userspace realtime this far ahead of the kernel's. An unfixed wait lasts its timeout plus this.
const OFFSET_SECONDS = 30;
// Every timeout below is well under this, and OFFSET_SECONDS is well over it.
const LIMIT_MS = 10_000;

const fixtures = {
  "shim.c": SHIM_C,

  "atomics-wait.js": /* js */ `
    const start = performance.now();
    const result = Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    console.log(JSON.stringify({ result, elapsed: performance.now() - start }));
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
    console.log(JSON.stringify({ code, elapsed: performance.now() - start }));
  `,

  "worker-terminate.js": /* js */ `
    const { Worker } = require("node:worker_threads");
    const worker = new Worker(
      "require('node:worker_threads').parentPort.postMessage('up'); while (true) {}",
      { eval: true },
    );
    worker.once("message", async () => {
      const start = performance.now();
      await worker.terminate();
      console.log(JSON.stringify({ elapsed: performance.now() - start }));
    });
  `,

  "busy.js": /* js */ `
    function work(n) { let s = 0; for (let i = 0; i < n; i++) s += Math.sqrt(i); return s; }
    const start = performance.now();
    while (performance.now() - start < 200) work(1e4);
    if (process.env.FAKE_REALTIME_AFTER) {
      // Step the clock now, halfway through the profile.
      require("fs").writeFileSync(process.env.FAKE_REALTIME_AFTER, "");
      while (performance.now() - start < 400) work(1e4);
    }
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

async function run(args: string[], extra: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: dir,
    env: shimEnv(extra),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

describe.concurrent("a relative timeout does not follow the wall clock", () => {
  test.skipIf(!cc)("Atomics.wait", async () => {
    const { stdout, stderr, exitCode } = await run(["atomics-wait.js"]);
    expect(stderr).toBe("");
    const { result, elapsed } = JSON.parse(stdout);
    expect(result).toBe("timed-out");
    expect(elapsed).toBeGreaterThanOrEqual(200);
    expect(elapsed).toBeLessThan(LIMIT_MS);
    expect(exitCode).toBe(0);
  });

  test.skipIf(!cc)("node:vm timeout", async () => {
    const { stdout, stderr, exitCode } = await run(["vm-timeout.js"]);
    expect(stderr).toBe("");
    const { code, elapsed } = JSON.parse(stdout);
    expect(code).toBe("ERR_SCRIPT_EXECUTION_TIMEOUT");
    expect(elapsed).toBeGreaterThanOrEqual(200);
    expect(elapsed).toBeLessThan(LIMIT_MS);
    expect(exitCode).toBe(0);
  });

  test.skipIf(!cc)("worker.terminate() on a busy worker", async () => {
    const { stdout, stderr, exitCode } = await run(["worker-terminate.js"]);
    expect(stderr).toBe("");
    const { elapsed } = JSON.parse(stdout);
    expect(elapsed).toBeLessThan(LIMIT_MS);
    expect(exitCode).toBe(0);
  });

  test.skipIf(!cc)("--cpu-prof keeps sampling", async () => {
    const out = join(dir, "prof-sampling");
    const { stdout, stderr, exitCode } = await run(["--cpu-prof", "--cpu-prof-dir", out, "busy.js"]);
    expect({ stdout, stderr }).toEqual({ stdout: "", stderr: "" });
    expect(exitCode).toBe(0);
    const file = readdirSync(out).find(f => f.endsWith(".cpuprofile"));
    const profile = JSON.parse(readFileSync(join(out, file!), "utf-8"));
    // The sampler aims for one sample per millisecond over a 200 ms busy loop. Unfixed, its first
    // 1 ms sleep lasts OFFSET_SECONDS and the profile has no samples (or one).
    expect(profile.samples.length).toBeGreaterThan(20);
  });
});

// The .cpuprofile timeline is built from the samples' monotonic timestamps. Reading the wall clock
// for each of them instead put every sample taken after a backward step before the profile's start:
// DevTools drew an hour-long (or negative) flame chart for a 400 ms run.
test.skipIf(!cc)("--cpu-prof timeline survives a clock step in the middle of the profile", async () => {
  const out = join(dir, "prof-timeline");
  const { stdout, stderr, exitCode } = await run(["--cpu-prof", "--cpu-prof-dir", out, "busy.js"], {
    FAKE_REALTIME_OFFSET: "-3600",
    FAKE_REALTIME_AFTER: join(dir, "step-now"),
  });
  expect({ stdout, stderr }).toEqual({ stdout: "", stderr: "" });
  expect(exitCode).toBe(0);
  const file = readdirSync(out).find(f => f.endsWith(".cpuprofile"));
  const profile = JSON.parse(readFileSync(join(out, file!), "utf-8"));

  const spanMs = (profile.endTime - profile.startTime) / 1000;
  expect(spanMs).toBeGreaterThan(200);
  expect(spanMs).toBeLessThan(60_000);
  // Still microseconds on the Unix epoch, and no delta runs backwards.
  expect(profile.startTime).toBeGreaterThan(1e15);
  expect(profile.startTime).toBeLessThan(3e15);
  expect(Math.min(...profile.timeDeltas)).toBeGreaterThanOrEqual(0);
  expect(profile.timeDeltas.reduce((a: number, b: number) => a + b, 0) / 1000).toBeLessThan(60_000);
});
