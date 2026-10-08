import { RedisClient, SQL } from "bun";
import { heapStats } from "bun:jsc";
import { setSystemTime } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { spawnSync as childProcessSpawnSync } from "node:child_process";
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

  test.each([NaN, -1, Infinity, 2 ** 32])("advanceTimersByTime(%p) throws and does not move the clock", ms => {
    vi.useFakeTimers({ now: 1000 });
    expect(() => vi.advanceTimersByTime(ms)).toThrow("ms is out of range. It must be >= 0 and <= 4294967295");
    expect(Date.now()).toBe(1000);
    expect(performance.now()).toBe(0);
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
// A timer that a fake timer's callback arms with no delay is scheduled 1ms
// later, as in @sinonjs/fake-timers. At the current instant it is due again
// within the advanceTimersByTime() / runOnlyPendingTimers() call that runs the
// callback, and a callback that re-arms itself that way keeps the call from
// ever returning. setTimeout(fn, 0) is always 1ms; AbortSignal.timeout(0) and
// Bun.sleep(0) are the timers that can have no delay.
describe("a zero-delay timer armed by a timer callback", () => {
  // Ends a chain of re-armed timers, so a drain that keeps firing them at one
  // instant fails an assertion and does not spin.
  const GIVE_UP = 50;

  describe("AbortSignal.timeout(0) re-armed by its own abort listener", () => {
    /** Returns `performance.now()` at each abort. */
    function rearmOnAbort(): number[] {
      const abortedAt: number[] = [];
      const arm = () =>
        AbortSignal.timeout(0).addEventListener("abort", () => {
          abortedAt.push(performance.now());
          if (abortedAt.length < GIVE_UP) arm();
        });
      arm();
      return abortedAt;
    }

    test("advanceTimersByTime() fires it once per millisecond", () => {
      vi.useFakeTimers();
      const abortedAt = rearmOnAbort();
      vi.advanceTimersByTime(3);
      expect({ abortedAt, now: performance.now(), pending: vi.getTimerCount() }).toEqual({
        abortedAt: [0, 1, 2, 3],
        now: 3,
        pending: 1,
      });
    });

    test("runOnlyPendingTimers() fires the pending one only", () => {
      vi.useFakeTimers();
      const abortedAt = rearmOnAbort();
      vi.runOnlyPendingTimers();
      expect({ abortedAt, now: performance.now(), pending: vi.getTimerCount() }).toEqual({
        abortedAt: [0],
        now: 0,
        pending: 1,
      });
    });

    test("advanceTimersToNextTimer() moves the clock to the re-armed one", () => {
      vi.useFakeTimers();
      const abortedAt = rearmOnAbort();
      vi.advanceTimersToNextTimer();
      vi.advanceTimersToNextTimer();
      expect({ abortedAt, now: performance.now(), pending: vi.getTimerCount() }).toEqual({
        abortedAt: [0, 1],
        now: 1,
        pending: 1,
      });
    });

    test("a nested advanceTimersToNextTimer() in the listener, before it re-arms", () => {
      vi.useFakeTimers();
      const abortedAt: number[] = [];
      const arm = () => {
        AbortSignal.timeout(0).addEventListener("abort", () => {
          abortedAt.push(performance.now());
          // Fires `other` and returns into this listener, which still runs.
          vi.advanceTimersToNextTimer();
          if (abortedAt.length < GIVE_UP) arm();
        });
        // `other`: due at the same instant, after the one above.
        AbortSignal.timeout(0).addEventListener("abort", () => {});
      };
      arm();
      vi.advanceTimersByTime(1);
      expect({ abortedAt, now: performance.now(), pending: vi.getTimerCount() }).toEqual({
        abortedAt: [0, 1],
        now: 1,
        pending: 2,
      });
    });
  });

  // A jest timer control runs the microtasks of a timer before the next timer
  // only when no event loop task is on the stack. The first tests of a file run
  // that way, so the loop gets a test file of its own.
  test("a `while (..) await Bun.sleep(0)` loop ends when its condition does", async () => {
    using dir = tempDir("fake-timers-sleep-loop", {
      "sleep-loop.test.ts": `
        import { jest, test } from "bun:test";
        test.each(["advanceTimersByTime", "runOnlyPendingTimers"])("%s", control => {
          jest.useFakeTimers();
          let done = false;
          const polledAt = [];
          setTimeout(() => (done = true), 3);
          (async () => {
            while (!done && polledAt.length < ${GIVE_UP}) {
              polledAt.push(performance.now());
              await Bun.sleep(0);
            }
          })();
          if (control === "advanceTimersByTime") jest.advanceTimersByTime(5);
          else jest.runOnlyPendingTimers();
          console.log(JSON.stringify({ control, polledAt, done, now: performance.now(), pending: jest.getTimerCount() }));
          jest.useRealTimers();
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "sleep-loop.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const results = stdout
      .split("\n")
      .filter(line => line.startsWith("{"))
      .map(line => JSON.parse(line));
    expect({ results, exitCode }, stderr).toEqual({
      results: [
        { control: "advanceTimersByTime", polledAt: [0, 0, 1, 2], done: true, now: 5, pending: 0 },
        { control: "runOnlyPendingTimers", polledAt: [0, 0, 1, 2], done: true, now: 3, pending: 0 },
      ],
      exitCode: 0,
    });
  });

  test("AbortSignal.timeout(0) fires 1ms after the callback that armed it", () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    setTimeout(() => (signal = AbortSignal.timeout(0)), 5);
    vi.advanceTimersByTime(5);
    expect({ aborted: signal.aborted, pending: vi.getTimerCount() }).toEqual({ aborted: false, pending: 1 });
    vi.advanceTimersByTime(1);
    expect({ aborted: signal.aborted, pending: vi.getTimerCount() }).toEqual({ aborted: true, pending: 0 });
  });

  test("Bun.sleep(0) resolves 1ms after the callback that called it", async () => {
    vi.useFakeTimers();
    let sleep!: Promise<void>;
    setTimeout(() => (sleep = Bun.sleep(0)), 5);
    vi.advanceTimersByTime(5);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(vi.getTimerCount()).toBe(0);
    await sleep;
  });

  test("a timer that was already due 1ms later fires before it", () => {
    vi.useFakeTimers();
    const order: string[] = [];
    setTimeout(() => order.push("setTimeout(1)"), 1);
    AbortSignal.timeout(0).addEventListener("abort", () => {
      AbortSignal.timeout(0).addEventListener("abort", () => order.push("timeout(0)"));
    });
    vi.advanceTimersByTime(1);
    expect(order).toEqual(["setTimeout(1)", "timeout(0)"]);
  });

  test("armed outside a timer callback, it is due at the current instant", () => {
    vi.useFakeTimers();
    vi.advanceTimersByTime(5);
    const signal = AbortSignal.timeout(0);
    vi.runOnlyPendingTimers();
    expect({ aborted: signal.aborted, now: performance.now() }).toEqual({ aborted: true, now: 5 });
  });

  // Not a zero delay: a nested timer control in the callback stops the clock
  // on the deadline the interval is then re-armed for.
  test.each([
    { period: 5, nested: 5, advance: 20, firedAt: [5, 10, 15, 20] },
    { period: 1, nested: 0, advance: 4, firedAt: [1, 2, 3, 4] },
  ])(
    "setInterval(fn, $period) re-armed onto the current instant keeps its period",
    ({ period, nested, advance, firedAt }) => {
      vi.useFakeTimers();
      const at: number[] = [];
      const interval = setInterval(() => {
        at.push(performance.now());
        if (at.length === 1) vi.advanceTimersByTime(nested);
      }, period);
      vi.advanceTimersByTime(advance);
      clearInterval(interval);
      expect(at).toEqual(firedAt);
    },
  );
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

  test("performance.timeOrigin follows the fake clock", () => {
    const realTimeOrigin = performance.timeOrigin;
    const fakeNow = new Date("2000-01-01T00:00:00.000Z").getTime();
    vi.useFakeTimers({ now: fakeNow });

    // performance.now() restarts at 0, so the fake epoch is the origin.
    expect(performance.now()).toBe(0);
    expect(performance.timeOrigin).toBe(fakeNow);
    expect(performance.timeOrigin + performance.now()).toBe(Date.now());

    vi.advanceTimersByTime(5000);
    expect(performance.timeOrigin).toBe(fakeNow);
    expect(performance.timeOrigin + performance.now()).toBe(Date.now());

    // setSystemTime moves Date.now() but not performance.now(), so the origin moves with it.
    const jumped = new Date("2010-06-15T12:00:00.000Z").getTime();
    setSystemTime(jumped);
    expect(Date.now()).toBe(jumped);
    expect(performance.now()).toBe(5000);
    expect(performance.timeOrigin).toBe(jumped - 5000);
    expect(performance.timeOrigin + performance.now()).toBe(Date.now());
    expect(performance.toJSON().timeOrigin).toBe(performance.timeOrigin);

    vi.useRealTimers();
    expect(performance.timeOrigin).toBe(realTimeOrigin);
  });

  test("performance.timeOrigin is not affected by setSystemTime without fake timers", () => {
    const realTimeOrigin = performance.timeOrigin;
    setSystemTime(new Date("2000-01-01T00:00:00.000Z"));
    expect(new Date().getUTCFullYear()).toBe(2000);
    expect(performance.timeOrigin).toBe(realTimeOrigin);
    setSystemTime();
  });

  // setSystemTime() with no argument, NaN, or an Invalid Date resets Date.now()
  // to the real clock. The origin goes back to real with it.
  test.each([undefined, NaN, new Date(NaN)])(
    "setSystemTime(%p) under fake timers resets performance.timeOrigin too",
    reset => {
      const realTimeOrigin = performance.timeOrigin;
      const realBefore = Date.now();
      vi.useFakeTimers({ now: 5000 });
      expect(performance.timeOrigin).toBe(5000);

      setSystemTime(reset);
      expect(Date.now()).toBeGreaterThanOrEqual(realBefore);
      expect(performance.timeOrigin).toBe(realTimeOrigin);
      expect(performance.toJSON().timeOrigin).toBe(realTimeOrigin);

      // The next tick of the fake clock overrides Date.now() again, and the origin follows it.
      vi.advanceTimersByTime(1000);
      expect(Date.now()).toBe(6000);
      expect(performance.timeOrigin).toBe(5000);
      expect(performance.timeOrigin + performance.now()).toBe(Date.now());
    },
  );

  test.each([Infinity, -Infinity])("setSystemTime(%p) throws and leaves the clocks alone", ms => {
    const realBefore = Date.now();
    expect(() => setSystemTime(ms)).toThrow("setSystemTime() expects a finite number or a Date");
    expect(Date.now()).toBeGreaterThanOrEqual(realBefore);

    vi.useFakeTimers({ now: 5000 });
    expect(() => setSystemTime(ms)).toThrow("setSystemTime() expects a finite number or a Date");
    expect(Date.now()).toBe(5000);
    expect(performance.timeOrigin).toBe(5000);
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

  // NaN is the "no override" sentinel of the Date.now() override. A NaN clock
  // left Date.now() real while performance.timeOrigin read NaN.
  test.each([NaN, Infinity, -Infinity, new Date(NaN)])("useFakeTimers({ now: %p }) throws", now => {
    const realTimeOrigin = performance.timeOrigin;
    expect(() => vi.useFakeTimers({ now })).toThrow("'now' must be a finite number or a valid Date");
    expect(vi.isFakeTimers()).toBe(false);
    expect(performance.timeOrigin).toBe(realTimeOrigin);
    expect(performance.toJSON().timeOrigin).toBe(realTimeOrigin);
  });
});
