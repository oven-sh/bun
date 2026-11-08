import { afterEach, describe, expect, jest, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";

test("sleep should saturate timeout values", async () => {
  const fixturesThatShouldTimeout = [
    "Infinity",
    "999999999999999",
    "999999999999999.999999999999999",
    "999999999999999",
  ];
  const fixturesThatSHouldCompleteInstantly = [
    "0",
    "0.0",
    "-0",
    "-0.1",
    "-0.0000000000000001",
    "-999999999999999",
    "-999999999999999.999999999999999",
  ];
  // ASAN with the system allocator makes subprocess startup dramatically
  // slower; spawning ~11 children can take well over 10s, so the "completes
  // instantly" bound needs much more headroom.
  const ASAN_MULTIPLIER = isASAN ? 60 : 1;

  const toKill = fixturesThatShouldTimeout.map(timeout => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "sleep-4ever.js", timeout],
      stderr: "inherit",
      stdout: "inherit",
      stdin: "inherit",
      env: bunEnv,
      cwd: import.meta.dir,
    });
    return proc;
  });

  const start = performance.now();
  const toWait = fixturesThatSHouldCompleteInstantly.map(async timeout => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "sleep-4ever.js", timeout],
      stderr: "inherit",
      stdout: "inherit",
      stdin: "inherit",
      env: bunEnv,
      cwd: import.meta.dir,
    });
    expect(await proc.exited).toBe(0);
    expect(performance.now() - start).toBeLessThan(1000 * ASAN_MULTIPLIER);
  });

  await Promise.all(toWait);
  for (let i = 0; i < toKill.length; i++) {
    const proc = toKill[i];
    if (proc.exitCode === 0) {
      console.warn("warn: Expected process #", i, "to timeout, but it didn't");
    }
    expect(proc.exitCode).toBe(null);
  }

  const allExited = Promise.all(toKill.map(proc => proc.exited));
  toKill.forEach(proc => proc.kill());

  await allExited;
}, 120_000);

test("sleep should keep the event loop alive", async () => {
  const proc = Bun.spawn({
    cmd: [bunExe(), "sleep-keepalive.ts"],
    stderr: "inherit",
    stdout: "pipe",
    stdin: "inherit",
    env: bunEnv,
    cwd: import.meta.dir,
  });
  await proc.exited;
  expect(proc.exitCode).toBe(0);
  expect(await proc.stdout.text()).toContain("event loop was not killed");
});

// The fake clock of bun:test runs a wait of weeks or years with no real waiting.
describe("the length of the wait, on the fake clock", () => {
  const DAY = 86_400_000;
  /** The longest delay of setTimeout(), in ms. A longer one makes it fire after 1 ms. */
  const MAX_TIMEOUT = 2 ** 31 - 1;
  /** The most that one advanceTimersByTime() call takes, in ms. */
  const MAX_ADVANCE = 2 ** 32 - 1;
  /** The longest wait of Bun.sleep(), in ms: 2^31-1 seconds, about 68 years. */
  const MAX_SLEEP = MAX_TIMEOUT * 1000;

  afterEach(() => void jest.useRealTimers());

  function advance(ms: number) {
    for (; ms > 0; ms -= MAX_ADVANCE) jest.advanceTimersByTime(Math.min(ms, MAX_ADVANCE));
  }

  /** The sleep has to be pending 1 fake ms before `ms`, and over on it. */
  async function expectToWakeAfter(ms: number, sleep: Promise<void>) {
    advance(ms - 1);
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(1);
    expect(jest.getTimerCount()).toBe(0);
    await sleep;
  }

  test.each([NaN, -1, -Infinity])("Bun.sleep(%d) is over without moving the clock", async ms => {
    jest.useFakeTimers({ now: 0 });
    const sleep = Bun.sleep(ms);
    jest.advanceTimersByTime(0);
    expect({ pending: jest.getTimerCount(), now: Date.now() }).toEqual({ pending: 0, now: 0 });
    await sleep;
  });

  test.each([MAX_TIMEOUT, MAX_TIMEOUT + 1, 30 * DAY, MAX_ADVANCE, MAX_ADVANCE + 1, 5e9, 366 * DAY, MAX_SLEEP])(
    "Bun.sleep(%d) is over after that many ms",
    async ms => {
      jest.useFakeTimers({ now: 0 });
      await expectToWakeAfter(ms, Bun.sleep(ms));
    },
  );

  // The real clock ends a longer wait after 2^31-1 seconds. The fake clock ends no sleep early.
  test.each([MAX_SLEEP + 1, 2 ** 53 - 1, Number.MAX_VALUE, Infinity, new Date(8.64e15)])(
    "Bun.sleep(%p) never ends, and is not a pending timer",
    async wait => {
      jest.useFakeTimers({ now: 0 });
      const woke = jest.fn();
      Bun.sleep(wait).then(woke);
      expect(jest.getTimerCount()).toBe(0);
      jest.runAllTimers();
      await Promise.resolve();
      expect({ now: Date.now(), woke: woke.mock.calls.length }).toEqual({ now: 0, woke: 0 });
    },
  );

  test("runOnlyPendingTimers() beside an interval does not wait for a sleep that never ends", () => {
    jest.useFakeTimers({ now: 0 });
    const tick = jest.fn();
    setInterval(tick, DAY);
    Bun.sleep(Infinity);
    jest.runOnlyPendingTimers();
    expect({ ticks: tick.mock.calls.length, now: Date.now() }).toEqual({ ticks: 1, now: DAY });
  });

  // The date is on the real clock, and the wait is on the fake one.
  test("Bun.sleep(date) is over on a date that is 30 days ahead", async () => {
    jest.useFakeTimers({ toFake: ["setTimeout"] });
    const sleep = Bun.sleep(new Date(Date.now() + 30 * DAY));
    advance(29 * DAY);
    expect(jest.getTimerCount()).toBe(1);
    advance(DAY);
    expect(jest.getTimerCount()).toBe(0);
    await sleep;
  });

  test.each([
    ["advanceTimersToNextTimer", () => jest.advanceTimersToNextTimer()],
    ["runOnlyPendingTimers", () => jest.runOnlyPendingTimers()],
    ["runAllTimers", () => jest.runAllTimers()],
  ])("%s() moves the clock to the end of the sleep", async (_, run) => {
    // With a limit of 1 timer, runAllTimers() throws if the sleep takes more than one.
    jest.useFakeTimers({ now: 0, timerLimit: 1 });
    const sleep = Bun.sleep(5e9);
    run();
    expect({ pending: jest.getTimerCount(), now: Date.now() }).toEqual({ pending: 0, now: 5e9 });
    await sleep;
  });

  test("timers with the same deadline fire in the order of the calls", async () => {
    jest.useFakeTimers({ now: 0 });
    const order: string[] = [];
    AbortSignal.timeout(5e9).addEventListener("abort", () => order.push("signal before"));
    Bun.sleep(5e9).then(() => order.push("sleep"));
    AbortSignal.timeout(5e9).addEventListener("abort", () => order.push("signal after"));
    // One timer per event loop task, so the sleep's promise reaction runs before the next timer.
    await jest.runAllTimersAsync();
    expect(order).toEqual(["signal before", "sleep", "signal after"]);
  });

  // Five sleeps of 2^31-1 seconds put the fake clock past 2^63 nanoseconds.
  test("a timer counts from the fake clock after sleeps moved it by 340 years", () => {
    jest.useFakeTimers({ now: 0 });
    for (let i = 0; i < 5; i++) {
      Bun.sleep(MAX_SLEEP);
      jest.runAllTimers();
    }
    expect(Date.now()).toBe(5 * MAX_SLEEP);
    const signal = AbortSignal.timeout(1000);
    jest.advanceTimersByTime(999);
    expect(signal.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
  });
});
