import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { afterEach, describe, expect, test, vi } from "vitest";

afterEach(() => vi.useRealTimers());

class Order {
  items: { timePerf: number; timeDate: number; message: string }[] = [];
  startPerf: number = 0;
  startDate: number = 0;
  constructor() {
    this.startPerf = performance.now();
    this.startDate = Date.now();
  }
  add(message: string) {
    this.items.push({
      timePerf: performance.now() - this.startPerf,
      timeDate: Date.now() - this.startDate,
      message,
    });
  }

  takeOrderMessages(): string[] {
    const result = this.items.map(item => item.message);
    this.items = [];
    return result;
  }
}

test("fake timers", async () => {
  expect(vi.useFakeTimers()).toBe(vi);
  const order = new Order();
  setTimeout(() => {
    order.add("setTimeout");
  }, 0);
  expect(vi.useRealTimers()).toBe(vi);
  await Bun.sleep(10);
  expect(order.takeOrderMessages()).toEqual([]); // it was created as a fake timer, so it should not have triggered
});

describe("advanceTimersToNextTimer", () => {
  test("one setTimeout", async () => {
    const order = new Order();
    vi.useFakeTimers();
    setTimeout(() => {
      order.add("setTimeout");
    }, 0);
    expect(order.takeOrderMessages()).toEqual([]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual(["setTimeout"]);
    vi.useRealTimers();
  });
  test("setInterval", async () => {
    const order = new Order();
    vi.useFakeTimers();
    const interval = setInterval(() => {
      order.add("setInterval");
    }, 10);
    expect(order.takeOrderMessages()).toEqual([]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual(["setInterval"]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual(["setInterval"]);
    clearInterval(interval);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual([]);
    vi.useRealTimers();
  });
  test("sorted timeouts", async () => {
    const order = new Order();
    vi.useFakeTimers();
    setTimeout(() => {
      order.add("10");
    }, 10);
    setTimeout(() => {
      order.add("9");
      setTimeout(() => order.add("14"), 5);
    }, 9);
    setTimeout(() => {
      order.add("20");
    }, 20);
    expect(order.takeOrderMessages()).toEqual([]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual(["9"]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual(["10"]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual(["14"]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual(["20"]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual([]);
    vi.useRealTimers();
  });
  test("alternating intervals", async () => {
    vi.useFakeTimers();
    const order = new Order();
    setInterval(() => {
      order.add("setInterval 1");
    }, 9);
    setInterval(() => {
      order.add("setInterval 2");
    }, 10);
    expect(order.takeOrderMessages()).toEqual([]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual(["setInterval 1"]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual(["setInterval 2"]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual(["setInterval 1"]);
    vi.advanceTimersToNextTimer();
    expect(order.takeOrderMessages()).toEqual(["setInterval 2"]);
    vi.useRealTimers();
  });
});
describe("advanceTimersByTime", () => {
  test("setInterval", () => {
    vi.useFakeTimers();
    const order = new Order();

    const interval = setInterval(() => {
      order.add("setInterval");
    }, 6);
    vi.advanceTimersByTime(10);
    expect(order.takeOrderMessages()).toEqual(["setInterval"]);
    vi.advanceTimersByTime(10);
    expect(order.takeOrderMessages()).toEqual(["setInterval", "setInterval"]);
    clearInterval(interval);
    vi.advanceTimersByTime(10);
    expect(order.takeOrderMessages()).toEqual([]);
    vi.useRealTimers();
  });
});
describe("runOnlyPendingTimers", () => {
  test("two setIntervals", () => {
    vi.useFakeTimers();
    const order = new Order();
    setInterval(() => order.add("100"), 100);
    setInterval(() => order.add("24"), 24);
    expect(order.takeOrderMessages()).toEqual([]);
    vi.runOnlyPendingTimers();
    expect(order.takeOrderMessages()).toEqual(["24", "24", "24", "24", "100"]);
    vi.runOnlyPendingTimers();
    expect(order.takeOrderMessages()).toEqual(["24", "24", "24", "24", "100"]);
    vi.useRealTimers();
  });
});
describe("runAllTimers", () => {
  test("two setIntervals", () => {
    vi.useFakeTimers();
    const order = new Order();
    setTimeout(() => {
      order.add("10");
    }, 10);
    setTimeout(() => {
      order.add("9");
      setTimeout(() => order.add("14"), 5);
    }, 9);
    setTimeout(() => {
      order.add("20");
    }, 20);
    expect(order.takeOrderMessages()).toEqual([]);
    vi.runAllTimers();
    expect(order.takeOrderMessages()).toEqual(["9", "10", "14", "20"]);
  });
});
describe("getTimerCount", () => {
  test("returns correct count of pending timers", () => {
    vi.useFakeTimers();
    expect(vi.getTimerCount()).toBe(0);
    setTimeout(() => {}, 10);
    expect(vi.getTimerCount()).toBe(1);
    setTimeout(() => {}, 20);
    expect(vi.getTimerCount()).toBe(2);
    const interval = setInterval(() => {}, 30);
    expect(vi.getTimerCount()).toBe(3);
    vi.advanceTimersToNextTimer();
    expect(vi.getTimerCount()).toBe(2);
    clearInterval(interval);
    expect(vi.getTimerCount()).toBe(1);
    vi.runAllTimers();
    expect(vi.getTimerCount()).toBe(0);
  });
  test("throws error if fake timers not active", () => {
    expect(() => vi.getTimerCount()).toThrow("Fake timers are not active");
  });
});
describe("clearAllTimers", () => {
  test("clears all pending timers", () => {
    vi.useFakeTimers();
    const order = new Order();
    setTimeout(() => order.add("1"), 10);
    setTimeout(() => order.add("2"), 20);
    setInterval(() => order.add("3"), 30);
    expect(vi.getTimerCount()).toBe(3);
    expect(vi.clearAllTimers()).toBe(vi);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(100);
    expect(order.takeOrderMessages()).toEqual([]);
  });
  test("throws error if fake timers not active", () => {
    expect(() => vi.clearAllTimers()).toThrow("Fake timers are not active");
  });
});
describe("isFakeTimers", () => {
  test("returns true when fake timers are active", () => {
    expect(vi.isFakeTimers()).toBe(false);
    vi.useFakeTimers();
    expect(vi.isFakeTimers()).toBe(true);
    vi.useRealTimers();
    expect(vi.isFakeTimers()).toBe(false);
  });
  test("returns false by default", () => {
    expect(vi.isFakeTimers()).toBe(false);
  });
});
describe("Date.now() mocking", () => {
  test("Date.now() before and after vi.useFakeTimers() should be roughly equal", () => {
    const beforeFake = Date.now();
    vi.useFakeTimers();
    const afterFake = Date.now();

    // The fake time should start at approximately the real time
    // Allow a tolerance of 100ms for the time it takes to call useFakeTimers()
    const diff = Math.abs(afterFake - beforeFake);
    expect(diff).toBeLessThan(100);
  });

  test("Date.now() should be mocked when fake timers are active", () => {
    vi.useFakeTimers();
    const start = Date.now();

    // Advance time by 1000ms
    vi.advanceTimersByTime(1000);

    // Date.now() should reflect the advanced time
    expect(Date.now()).toBe(start + 1000);

    // Advance more time
    vi.advanceTimersByTime(500);
    expect(Date.now()).toBe(start + 1500);
  });

  test("Date.now() returns to real time when fake timers are disabled", () => {
    vi.useFakeTimers();
    const initialFakeTime = Date.now();
    vi.advanceTimersByTime(1000);
    const advancedFakeTime = Date.now();
    expect(advancedFakeTime).toBe(initialFakeTime + 1000);

    vi.useRealTimers();

    // After disabling fake timers, Date.now() should return real time
    // The real time should be close to when we started (within a few ms)
    // It should NOT be the advanced fake time
    const realNow = Date.now();
    // Allow 1ms tolerance for rounding
    expect(Math.abs(realNow - initialFakeTime)).toBeLessThan(10);
    expect(realNow).toBeLessThan(advancedFakeTime); // Real time hasn't advanced as much as fake time
  });

  test("Date.now() advances with advanceTimersToNextTimer", () => {
    vi.useFakeTimers();
    const start = Date.now();

    setTimeout(() => {}, 100);
    setTimeout(() => {}, 200);

    vi.advanceTimersToNextTimer();
    expect(Date.now()).toBe(start + 100);

    vi.advanceTimersToNextTimer();
    expect(Date.now()).toBe(start + 200);
  });

  test("Date.now() is consistent with timer callbacks", () => {
    vi.useFakeTimers();
    const start = Date.now();
    let capturedTime = 0;

    setTimeout(() => {
      capturedTime = Date.now();
    }, 500);

    vi.advanceTimersByTime(500);

    // The time captured in the callback should match
    expect(capturedTime).toBe(start + 500);
    expect(Date.now()).toBe(start + 500);
  });
});

describe("performance.now() mocking", () => {
  test("performance.now() should be mocked when fake timers are active", () => {
    vi.useFakeTimers();
    const start = performance.now();

    // Advance time by 1000ms
    vi.advanceTimersByTime(1000);

    // performance.now() should reflect the advanced time
    expect(performance.now()).toBe(1000);

    // Advance more time
    vi.advanceTimersByTime(500);
    expect(performance.now()).toBe(1500);
  });

  test("performance.now() returns to real time when fake timers are disabled", () => {
    const initialRealTime = performance.now();
    vi.useFakeTimers();
    const initialFakeTime = performance.now();
    expect(initialFakeTime).toBe(0);
    vi.advanceTimersByTime(1000);
    const advancedFakeTime = performance.now();
    expect(advancedFakeTime).toBe(1000);

    vi.useRealTimers();

    // After disabling fake timers, performance.now() should return real time
    const realNow = performance.now();
    expect(realNow - initialRealTime).toBeLessThan(100);
  });

  test("performance.now() advances with advanceTimersToNextTimer", () => {
    vi.useFakeTimers();
    const start = performance.now();

    setTimeout(() => {}, 100);
    setTimeout(() => {}, 200);

    vi.advanceTimersToNextTimer();
    expect(performance.now()).toBe(start + 100);

    vi.advanceTimersToNextTimer();
    expect(performance.now()).toBe(start + 200);
  });

  test("performance.now() is consistent with timer callbacks", () => {
    vi.useFakeTimers();
    const start = performance.now();
    let capturedTime = 0;

    setTimeout(() => {
      capturedTime = performance.now();
    }, 500);

    vi.advanceTimersByTime(500);

    // The time captured in the callback should match
    expect(capturedTime).toBe(start + 500);
    expect(performance.now()).toBe(start + 500);
  });

  test("performance.now() and Date.now() are both mocked consistently", () => {
    vi.useFakeTimers();
    const perfStart = performance.now();
    const dateStart = Date.now();

    vi.advanceTimersByTime(1000);

    // Both should have advanced by the same amount
    expect(performance.now()).toBe(perfStart + 1000);
    expect(Date.now()).toBe(dateStart + 1000);

    vi.advanceTimersByTime(500);
    expect(performance.now()).toBe(perfStart + 1500);
    expect(Date.now()).toBe(dateStart + 1500);
  });
});

describe("useFakeTimers with options", () => {
  test("useFakeTimers({ now: number }) sets Date.now() to the specified value", () => {
    const targetTime = 1000000000000; // January 9, 2001
    vi.useFakeTimers({ now: targetTime });

    expect(Date.now()).toBe(targetTime);

    // Advance time and verify it continues from that point
    vi.advanceTimersByTime(1000);
    expect(Date.now()).toBe(targetTime + 1000);
  });

  test("useFakeTimers({ now: Date }) sets Date.now() to the Date's timestamp", () => {
    const targetDate = new Date("2001-01-09T00:00:00.000Z");
    const targetTime = targetDate.getTime();
    vi.useFakeTimers({ now: targetDate });

    expect(Date.now()).toBe(targetTime);

    // Advance time and verify it continues from that point
    vi.advanceTimersByTime(5000);
    expect(Date.now()).toBe(targetTime + 5000);
  });

  test("useFakeTimers({ now: 0 }) sets Date.now() to epoch", () => {
    vi.useFakeTimers({ now: 0 });

    expect(Date.now()).toBe(0);

    vi.advanceTimersByTime(100);
    expect(Date.now()).toBe(100);
  });

  test("useFakeTimers without options uses current time", () => {
    const beforeFake = Date.now();
    vi.useFakeTimers();
    const afterFake = Date.now();

    // Should start at approximately the current real time
    const diff = Math.abs(afterFake - beforeFake);
    expect(diff).toBeLessThan(100);
  });

  test("timers scheduled with custom now work correctly", () => {
    const targetTime = 5000000000000;
    vi.useFakeTimers({ now: targetTime });

    const order: string[] = [];

    setTimeout(() => {
      order.push("first");
      expect(Date.now()).toBe(targetTime + 100);
    }, 100);

    setTimeout(() => {
      order.push("second");
      expect(Date.now()).toBe(targetTime + 200);
    }, 200);

    expect(order).toEqual([]);

    vi.advanceTimersByTime(100);
    expect(order).toEqual(["first"]);

    vi.advanceTimersByTime(100);
    expect(order).toEqual(["first", "second"]);
  });

  test("performance.now() starts at 0 regardless of custom now", () => {
    const targetTime = 1000000000000;
    vi.useFakeTimers({ now: targetTime });

    // performance.now() should still start at 0
    expect(performance.now()).toBe(0);

    vi.advanceTimersByTime(500);
    expect(performance.now()).toBe(500);
    expect(Date.now()).toBe(targetTime + 500);
  });

  test.each(["modern", "legacy"] as const)("useFakeTimers(%j) accepts legacy Jest string argument", implementation => {
    expect(() => vi.useFakeTimers(implementation)).not.toThrow();
    expect(vi.isFakeTimers()).toBe(true);
    vi.useRealTimers();
    expect(vi.isFakeTimers()).toBe(false);
  });

  test("useFakeTimers still rejects non-string non-object arguments", () => {
    expect(() => vi.useFakeTimers(123 as any)).toThrow("useFakeTimers() expects an options object");
    expect(vi.isFakeTimers()).toBe(false);
  });
});

// A file that activates fake timers or setSystemTime and never restores them
// must not leak that state into the next file: the fake-timer flag and mocked
// clock live in per-thread runner state, so without an explicit reset the next
// file's real `await setTimeout` never fires (misattributed hang) and
// `Date.now()` stays pinned. Jest gives each file its own fake-timer env.
describe.concurrent("fake timers / setSystemTime do not leak across test files", () => {
  const leakFixtures = {
    "a_faketimers.test.ts": `
      import { test, jest, setSystemTime } from "bun:test";
      test("A leaks fake timers + setSystemTime", () => {
        jest.useFakeTimers();
        setSystemTime(new Date("1999-12-31T23:59:59Z"));
        setTimeout(() => {}, 1000);
      });
    `,
    "b_real.test.ts": `
      import { test, expect, vi } from "bun:test";
      test("B expects real timers and real clock", async () => {
        // Assert the flag first: when it leaks, a real setTimeout await never
        // resolves and the per-test timeout sits in the real heap but the
        // child can still hang, so fail fast instead.
        expect(vi.isFakeTimers()).toBe(false);
        expect(typeof (setTimeout as any).clock).toBe("undefined");
        expect(new Date().getFullYear()).toBeGreaterThan(2000);
        let fired = false;
        await new Promise<void>(r => setTimeout(() => { fired = true; r(); }, 1));
        expect(fired).toBe(true);
      });
    `,
  };

  async function run(dir: string, extra: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...extra, "./a_faketimers.test.ts", "./b_real.test.ts"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.each([
    ["plain", []],
    ["--isolate", ["--isolate"]],
  ] as const)("%s: useFakeTimers() + setSystemTime() are reset before next file", async (_label, extra) => {
    using dir = tempDir("fake-timers-cross-file", leakFixtures);
    const { stderr, exitCode } = await run(String(dir), [...extra]);
    const norm = normalizeBunSnapshot(stderr, dir);
    expect(norm).toContain("2 pass");
    expect(norm).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("plain: setSystemTime() without useFakeTimers() is reset before next file", async () => {
    using dir = tempDir("setsystemtime-cross-file", {
      "a_sys.test.ts": `
        import { test, setSystemTime } from "bun:test";
        test("A pins Date", () => { setSystemTime(new Date("1999-12-31T23:59:59Z")); });
      `,
      "b_real.test.ts": `
        import { test, expect } from "bun:test";
        test("B sees real Date", () => {
          expect(new Date().getFullYear()).toBeGreaterThan(2000);
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "./a_sys.test.ts", "./b_real.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const norm = normalizeBunSnapshot(stderr, dir);
    expect(norm).toContain("2 pass");
    expect(norm).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("plain: file that calls useFakeTimers() at module scope and throws does not leak into next file", async () => {
    using dir = tempDir("fake-timers-module-throw", {
      "a_throws.test.ts": `
        import { jest, setSystemTime } from "bun:test";
        jest.useFakeTimers();
        setSystemTime(new Date("1999-12-31T23:59:59Z"));
        throw new Error("module-scope boom");
      `,
      "b_real.test.ts": leakFixtures["b_real.test.ts"],
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "./a_throws.test.ts", "./b_real.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const norm = normalizeBunSnapshot(stderr, dir);
    expect(norm).toContain("(pass) B expects real timers and real clock");
    expect(norm).toContain("module-scope boom");
    expect(exitCode).not.toBe(0);
  });
});
