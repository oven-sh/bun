import { expect, it } from "bun:test";
import { bunEnv, bunRun, isASAN, isDebug, isLinux } from "harness";
import { join } from "path";

// A timer never runs before a timer that is due earlier. To prove that a timer did not run, these
// tests wait for a timer that is due later. No assertion depends on how long something takes.

it("setInterval", async () => {
  const { promise, resolve } = Promise.withResolvers();
  const calls = [];
  const start = performance.now();
  const id = setInterval(
    function (...args) {
      calls.push({ args, thisIsTheTimer: this === id });
      if (calls.length === 10) {
        clearInterval(id);
        resolve(performance.now() - start);
      }
    },
    1,
    "foo",
  );

  // Ten runs of a 1 ms interval take 10 ms or more.
  expect(await promise).toBeGreaterThan(9);
  // An 11th run was due before this timer.
  await new Promise(resolve => setTimeout(resolve, 2));
  expect(calls).toEqual(Array.from({ length: 10 }, () => ({ args: ["foo"], thisIsTheTimer: true })));
});

it("clearInterval", async () => {
  let calls = 0;
  const id = setInterval(() => {
    calls++;
  }, 1);
  clearInterval(id);
  // The cleared interval was due before this timer.
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(calls).toBe(0);
});

it("async setInterval", async () => {
  const { promise, resolve } = Promise.withResolvers();
  let started = 0;
  let finished = 0;
  queueMicrotask(() => {
    const id = setInterval(async () => {
      started++;
      await 1;
      if (++finished === 5) {
        clearInterval(id);
        resolve();
      }
    }, 1);
  });
  await promise;
  // A sixth run was due before this timer.
  await new Promise(resolve => setTimeout(resolve, 2));
  expect({ started, finished }).toEqual({ started: 5, finished: 5 });
});

it("refreshed setInterval should not reschedule again", async () => {
  // Each run keeps the callback busy for one interval and then calls refresh(). The next run is due
  // one interval after the START of the run, which is the moment the callback returns. It is not due
  // one interval after the refresh() call, and the refresh() call does not add a second run.
  //
  // A witness timer of half an interval, armed right after refresh(), tells the two apart. It is due
  // after the next run (one interval after the start) and before the run after that.
  const interval = 20;
  const events = [];
  const startedAt = [];
  const refreshed = [];
  const { promise, resolve } = Promise.withResolvers();

  const armedAt = performance.now();
  const timer = setInterval(() => {
    startedAt.push(performance.now());
    const run = startedAt.length;
    events.push(`run ${run}`);

    const busyUntil = performance.now() + interval;
    while (performance.now() < busyUntil) {}

    refreshed.push(timer.refresh() === timer);
    setTimeout(() => events.push(`witness ${run}`), interval / 2);

    if (run === 3) {
      clearInterval(timer);
      // Any run that refresh() or the interval still has armed is due before this timer.
      setTimeout(resolve, interval);
    }
  }, interval);

  await promise;
  expect(events).toEqual(["run 1", "run 2", "witness 1", "run 3", "witness 2", "witness 3"]);
  expect(refreshed).toEqual([true, true, true]);
  // Run N is due N intervals after the timer was armed.
  for (const [i, at] of startedAt.entries()) expect(at - armedAt).toBeGreaterThan((i + 1) * interval - 1);
});

// The leak and cancel fixtures arm thousands of timers, and an ASAN or debug build arms a timer
// several hundred times slower than a release build. Those builds get a smaller workload. They do
// not need the large one: the checks they rely on count objects, so they flag a leak of any size.
const fullWorkload = !isASAN && !isDebug;

// LeakSanitizer reports each native allocation that nothing points to when the child exits. The CI
// runner turns it on for the ASAN lane, which is Linux. Turn it on here too, with the same
// suppressions, so that `bun bd test` on Linux does the same.
const leakSanitizerEnv =
  isASAN && isLinux
    ? {
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS:
          bunEnv.LSAN_OPTIONS ?? `print_suppressions=0:suppressions=${join(import.meta.dir, "../../../leaksan.supp")}`,
      }
    : undefined;

it.concurrent("setInterval runs with at least the delay time", async () => {
  const { stdout, stderr, exitCode } = await bunRun([join(import.meta.dir, "setInterval-fixture.js")]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ ticks: 100, early: [] });
  expect(exitCode).toBe(0);
});

it.concurrent("setInterval canceling with unref, close, _idleTimeout, and _onTimeout", async () => {
  // The fixture prints nothing unless a callback ran more or less often than it must.
  expect(await bunRun([join(import.meta.dir, "timers-fixture-unref.js"), "setInterval"])).toSpawn("");
});

it.concurrent(
  "setInterval doesn't leak memory",
  async () => {
    // [warmup batches, measured batches, runs of each timer]. A batch is 1,000 timers.
    const workload = fullWorkload ? [50, 300, 10] : isDebug ? [1, 4, 3] : [2, 18, 3];
    const { stdout, stderr, exitCode } = await bunRun(
      [join(import.meta.dir, "setInterval-leak-fixture.js"), ...workload.map(String)],
      leakSanitizerEnv,
    );
    expect(stderr).toBe("");

    const timers = (workload[0] + workload[1]) * 1000;
    const report = JSON.parse(stdout);
    expect(report).toEqual({
      timers,
      callbacks: timers * workload[2],
      rssDeltaMB: expect.any(Number),
      liveTimeouts: expect.any(Number),
      protectedTimeouts: 0,
    });
    // One Timeout cell is alive when the fixture counts them: the prototype. If clearInterval() leaves
    // the timer objects reachable, all of `timers` are alive.
    expect(report.liveTimeouts).toBeLessThan(100);
    // RSS is the check for native memory on builds without LeakSanitizer. Under ASAN it does not
    // work: freed blocks stay resident in the quarantine, so RSS grows with or without a leak.
    if (fullWorkload) expect(report.rssDeltaMB).toBeLessThanOrEqual(20);
    expect(exitCode).toBe(0);
  },
  30_000,
);

it.concurrent("setInterval doesn't run when cancelled after being scheduled", async () => {
  const timers = fullWorkload ? 50_000 : 5_000;
  const { stdout, stderr, exitCode } = await bunRun([
    join(import.meta.dir, "setinterval-cancel-fixture.js"),
    String(timers),
  ]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ timers, runs: 1 });
  expect(exitCode).toBe(0);
});
