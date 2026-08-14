import { RedisClient, SQL } from "bun";
import { timerInternals } from "bun:internal-for-testing";
import { heapStats } from "bun:jsc";
import { bunEnv, bunExe } from "harness";
import { spawnSync as childProcessSpawnSync, execFile } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
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
describe("AbortSignal.timeout", () => {
  const N = 500;

  function liveAbortSignals(): number {
    Bun.gc(true);
    Bun.gc(true);
    return heapStats().objectTypeCounts.AbortSignal ?? 0;
  }

  // A pending timeout signal with an abort listener is kept alive by the
  // runtime itself (the listener has to run when the timer fires), so with no
  // JS reference to them these wrappers live exactly as long as the runtime
  // believes their timer is still pending. The bounds below leave room for the
  // odd wrapper that conservative stack scanning keeps alive or lets go of.
  function leakObservedTimeouts() {
    for (let i = 0; i < N; i++) {
      AbortSignal.timeout(1_000_000).addEventListener("abort", () => {});
    }
  }

  test("pending signals stay alive while the fake heap holds their timer", () => {
    vi.useFakeTimers();
    const before = liveAbortSignals();
    leakObservedTimeouts();
    expect(vi.getTimerCount()).toBe(N);
    expect(liveAbortSignals() - before).toBeGreaterThan(N * 0.9);
  });

  // useRealTimers() and clearAllTimers() drop the pending fake timers, so these
  // signals can never abort anymore and nothing should keep them alive. They
  // used to stay pinned (with their listeners) for the rest of the process.
  test("useRealTimers() releases the signals whose timers it dropped", () => {
    const before = liveAbortSignals();
    vi.useFakeTimers();
    leakObservedTimeouts();
    vi.useRealTimers();
    expect(liveAbortSignals() - before).toBeLessThan(N * 0.1);
  });

  test("clearAllTimers() releases the signals whose timers it cleared", () => {
    vi.useFakeTimers();
    const before = liveAbortSignals();
    leakObservedTimeouts();
    vi.clearAllTimers();
    expect(vi.getTimerCount()).toBe(0);
    expect(liveAbortSignals() - before).toBeLessThan(N * 0.1);
  });

  test("a signal the program still holds is left unaborted once its fake timer is dropped", () => {
    vi.useFakeTimers();
    const signal = AbortSignal.timeout(1);
    vi.useRealTimers();
    const dependent = AbortSignal.any([signal]);
    signal.addEventListener("abort", () => {});
    liveAbortSignals();
    expect({ aborted: signal.aborted, dependentAborted: dependent.aborted }).toEqual({
      aborted: false,
      dependentAborted: false,
    });
  });

  test("fires through advanceTimersByTime", () => {
    vi.useFakeTimers();
    const signal = AbortSignal.timeout(1000);
    const reasons: string[] = [];
    signal.addEventListener("abort", () => reasons.push(signal.reason.name));
    vi.advanceTimersByTime(999);
    expect({ aborted: signal.aborted, reasons }).toEqual({ aborted: false, reasons: [] });
    vi.advanceTimersByTime(1);
    expect({ aborted: signal.aborted, reasons }).toEqual({ aborted: true, reasons: ["TimeoutError"] });
  });
});
// Only the timers a test schedules itself are faked. Timeouts the runtime arms
// for its own purposes keep running on the real clock: getTimerCount() does not
// count them, they fire while fake timers are active, and useRealTimers(), which
// drops every fake timer, does not disarm them.
describe("runtime timeouts are not fake timers", () => {
  // Outlives the 50ms timeout by a wide margin but still exits on its own, so a
  // timeout that never fires shows up as a normal exit instead of a hang.
  const sleepArgs = ["-e", "await Bun.sleep(3000)"];
  const sleepingChild = () => ({
    cmd: [bunExe(), ...sleepArgs],
    env: bunEnv,
    stdout: "ignore" as const,
    stderr: "ignore" as const,
    timeout: 50,
    killSignal: "SIGKILL" as const,
  });

  test("Bun.spawn({ timeout }) kills the child while fake timers are active", async () => {
    vi.useFakeTimers();
    await using proc = Bun.spawn(sleepingChild());
    expect(vi.getTimerCount()).toBe(0);
    await proc.exited;
    expect({ exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: null, signalCode: "SIGKILL" });
  });

  test("Bun.spawn({ timeout }) armed under fake timers survives useRealTimers()", async () => {
    vi.useFakeTimers();
    await using proc = Bun.spawn(sleepingChild());
    vi.useRealTimers();
    await proc.exited;
    expect({ exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: null, signalCode: "SIGKILL" });
  });

  test("Bun.spawnSync({ timeout }) times out while fake timers are active", () => {
    vi.useFakeTimers();
    const result = Bun.spawnSync(sleepingChild());
    expect({ exitedDueToTimeout: result.exitedDueToTimeout, signalCode: result.signalCode }).toEqual({
      exitedDueToTimeout: true,
      signalCode: "SIGKILL",
    });
  });

  // node:child_process's sync functions hand their timeout to Bun.spawnSync.
  test("child_process.spawnSync({ timeout }) times out while fake timers are active", () => {
    vi.useFakeTimers();
    const result = childProcessSpawnSync(bunExe(), sleepArgs, {
      env: bunEnv,
      stdio: "ignore",
      timeout: 50,
      killSignal: "SIGKILL",
    });
    expect({ signal: result.signal, code: result.error?.code }).toEqual({ signal: "SIGKILL", code: "ETIMEDOUT" });
  });

  // Accepts connections and never answers, so only the client's own connection
  // timeout can end a connection attempt.
  function silentServer() {
    const accepted = Promise.withResolvers<void>();
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open() {
          accepted.resolve();
        },
        data() {},
        close() {},
        error() {},
      },
    });
    return {
      port: listener.port,
      accepted: accepted.promise,
      [Symbol.dispose]() {
        listener.stop(true);
      },
    };
  }

  test.each([
    ["postgres", "ERR_POSTGRES_CONNECTION_TIMEOUT"],
    ["mysql", "ERR_MYSQL_CONNECTION_TIMEOUT"],
  ])("%s connectionTimeout armed under fake timers survives useRealTimers()", async (protocol, code) => {
    using server = silentServer();
    vi.useFakeTimers();
    const db = new SQL({ url: `${protocol}://user:pass@127.0.0.1:${server.port}/db`, connectionTimeout: 0.1, max: 1 });
    try {
      const connecting = db.connect().then(
        () => "connected",
        error => error.code,
      );
      await server.accepted;
      const fakeTimers = vi.getTimerCount();
      vi.useRealTimers();
      expect(fakeTimers).toBe(0);
      expect(await connecting).toBe(code);
    } finally {
      await db.close({ timeout: 0 });
    }
  });

  test("RedisClient connectionTimeout armed under fake timers survives useRealTimers()", async () => {
    using server = silentServer();
    vi.useFakeTimers();
    const client = new RedisClient(`redis://127.0.0.1:${server.port}`, {
      connectionTimeout: 100,
      autoReconnect: false,
    });
    try {
      const command = client.get("key").then(
        () => "replied",
        error => error.code,
      );
      await server.accepted;
      const fakeTimers = vi.getTimerCount();
      vi.useRealTimers();
      expect(fakeTimers).toBe(0);
      expect(await command).toBe("ERR_REDIS_CONNECTION_TIMEOUT");
    } finally {
      client.close();
    }
  });
});
// Bun.cron() is mockable, so a job created under fake timers lives in the fake
// heap, and useRealTimers() / clearAllTimers() drop it with the rest. Like a
// dropped setInterval it has to end up stopped, rather than holding the process
// open for a timer that can never fire.
describe("Bun.cron() job dropped from the fake heap", () => {
  test.each(["jest.useRealTimers()", "jest.clearAllTimers(); jest.useRealTimers()"])(
    "does not keep the process alive after %s",
    async drop => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const { jest } = Bun.jest();
           jest.useFakeTimers();
           Bun.cron("* * * * *", () => {});
           ${drop};
           console.log("exiting");`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
        // A child that hangs (the bug) is killed rather than left behind.
        timeout: 10_000,
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
        stdout: "exiting\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
  );
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

// Only timers user code creates through the globals are faked. The deadlines
// built-in modules schedule for themselves (through internal/timers) keep
// running on the real clock, as they do in Node under Jest's fake timers, and
// are invisible to getTimerCount()/runAllTimers()/clearAllTimers(). Every test
// here awaits the event the runtime is supposed to produce; before the fix the
// timer behind it sat frozen in the fake heap and the test timed out.
describe("built-in modules are not affected by fake timers", () => {
  async function listening<T extends net.Server>(server: T): Promise<number> {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return (server.address() as net.AddressInfo).port;
  }

  test("internal/timers setTimeout fires in real time and is not a fake timer", async () => {
    const { setTimeout: setInternalTimeout } = timerInternals.internalTimers;
    vi.useFakeTimers();
    const { promise, resolve } = Promise.withResolvers<string[]>();
    setInternalTimeout((...args: string[]) => resolve(args), 1, "a", "b", "c");
    expect(vi.getTimerCount()).toBe(0);
    // Neither fires it early nor cancels it.
    vi.runAllTimers();
    vi.clearAllTimers();
    expect(await promise).toEqual(["a", "b", "c"]);
  });

  test("internal/timers setInterval keeps firing in real time", async () => {
    const { setInterval: setInternalInterval, clearInterval: clearInternalInterval } = timerInternals.internalTimers;
    vi.useFakeTimers();
    const { promise, resolve } = Promise.withResolvers<void>();
    let fired = 0;
    const interval = setInternalInterval(() => {
      if (++fired === 3) {
        clearInternalInterval(interval);
        resolve();
      }
    }, 1);
    expect(vi.getTimerCount()).toBe(0);
    vi.runAllTimers();
    await promise;
    expect(fired).toBe(3);
  });

  test("internal/timers returns the same kind of Timeout the globals do", () => {
    const { setTimeout: setInternalTimeout, clearTimeout: clearInternalTimeout } = timerInternals.internalTimers;
    const internal = setInternalTimeout(() => {}, 1_000_000);
    const global = setTimeout(() => {}, 1_000_000);
    try {
      expect(Object.getPrototypeOf(internal)).toBe(Object.getPrototypeOf(global));
      expect(internal.hasRef()).toBe(true);
      expect(internal.unref().hasRef()).toBe(false);
      expect(internal.refresh()).toBe(internal);
    } finally {
      clearInternalTimeout(internal);
      // The global clearTimeout clears internal timers too.
      clearTimeout(internal);
      clearTimeout(global);
    }
    expect((internal as any)._destroyed).toBe(true);
  });

  test("net.Server and http.Server emit 'listening'", async () => {
    vi.useFakeTimers();
    const netServer = net.createServer();
    const httpServer = http.createServer();
    try {
      const { promise: callback, resolve } = Promise.withResolvers<void>();
      netServer.listen(0, "127.0.0.1", resolve);
      await Promise.all([callback, once(netServer, "listening"), listening(httpServer)]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      netServer.close();
      httpServer.close();
    }
  });

  test("socket.setTimeout() fires, and clearAllTimers()/useRealTimers() do not cancel it", async () => {
    const accepted: net.Socket[] = [];
    const server = net.createServer(socket => {
      socket.on("error", () => {});
      accepted.push(socket);
    });
    const port = await listening(server);
    vi.useFakeTimers();
    const socket = net.connect(port, "127.0.0.1");
    try {
      await once(socket, "connect");
      const fakeTimers = vi.getTimerCount();
      socket.setTimeout(1);
      expect(vi.getTimerCount()).toBe(fakeTimers);
      vi.clearAllTimers();
      vi.useRealTimers();
      await once(socket, "timeout");
    } finally {
      socket.destroy();
      for (const s of accepted) s.destroy();
      server.close();
    }
  });

  test("http request.setTimeout() emits 'timeout' while the server stays silent", async () => {
    const held: net.Socket[] = [];
    const server = net.createServer(socket => {
      socket.on("error", () => {});
      held.push(socket);
    });
    const port = await listening(server);
    vi.useFakeTimers();
    const req = http.get({ host: "127.0.0.1", port });
    req.on("error", () => {});
    try {
      const [socket] = await once(req, "socket");
      if (socket.connecting) await once(socket, "connect");
      const fakeTimers = vi.getTimerCount();
      req.setTimeout(1);
      expect(vi.getTimerCount()).toBe(fakeTimers);
      await once(req, "timeout");
    } finally {
      req.destroy();
      for (const socket of held) socket.destroy();
      server.close();
    }
  });

  test("http.Server headersTimeout sweep (an internal setInterval) still runs", async () => {
    vi.useFakeTimers();
    // The sweep has to come around many times (re-arming itself each time)
    // before the stalled request head is old enough to expire.
    const server = http.createServer({ connectionsCheckingInterval: 1, headersTimeout: 20 }, (req, res) =>
      res.end("unexpected"),
    );
    const { promise: clientError, resolve } = Promise.withResolvers<string>();
    server.on("clientError", (err: any, socket) => {
      resolve(err.code);
      socket.destroy();
    });
    let socket: net.Socket | undefined;
    try {
      const port = await listening(server);
      // 'listening' armed the sweep interval; it is not a fake timer.
      expect(vi.getTimerCount()).toBe(0);
      socket = net.connect(port, "127.0.0.1");
      socket.on("error", () => {});
      await once(socket, "connect");
      // A request head that never completes.
      socket.write("GET / HTTP/1.1\r\nHost: a\r\n");
      expect(await clientError).toBe("ERR_HTTP_REQUEST_TIMEOUT");
      await once(socket, "close");
    } finally {
      socket?.destroy();
      server.closeAllConnections();
      server.close();
    }
  });

  test("child_process.execFile({ timeout }) kills the child", async () => {
    vi.useFakeTimers();
    const { promise, resolve } = Promise.withResolvers<{ killed: boolean; signal: string | null | undefined }>();
    const child = execFile(bunExe(), ["-e", "setTimeout(() => {}, 1_000_000)"], { timeout: 1, env: bunEnv }, error =>
      resolve({ killed: child.killed, signal: error?.signal }),
    );
    expect(vi.getTimerCount()).toBe(0);
    expect(await promise).toEqual({ killed: true, signal: "SIGTERM" });
  });

  // The same private references also keep the runtime working when user code
  // replaces the globals (sinon-style fake timers, or any other monkeypatch).
  test("listen() works after globalThis.setTimeout was replaced", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `globalThis.setTimeout = globalThis.setInterval = () => { throw new Error("built-in module used the global timer"); };
         const server = require("node:net").createServer();
         server.listen(0, "127.0.0.1", () => { console.log("listening"); server.close(); });`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "listening\n", stderr: "", exitCode: 0 });
  });
});
