import { RedisClient, SQL } from "bun";
import { heapStats } from "bun:jsc";
import { jest, setSystemTime } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { spawnSync as childProcessSpawnSync } from "node:child_process";
import nodeTimers, { setTimeout as nodeSetTimeout } from "node:timers";
import { setTimeout as nodeSetTimeoutPromise } from "node:timers/promises";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

afterEach(() => vi.useRealTimers());

const saved = {
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  setImmediate,
  clearImmediate,
  nextTick: process.nextTick,
  queueMicrotask,
};
const everyFunction = [
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
  "nextTick",
  "queueMicrotask",
  "requestAnimationFrame",
] as const;
/** Resolves after `ms` of real time, whatever is faked. */
const waitOnTheRealClock = (ms: number) => new Promise<void>(resolve => saved.setTimeout(resolve, ms));
/** Resolves after a turn of the event loop, whatever is faked. */
const oneLoopTurn = () => new Promise<void>(resolve => saved.setImmediate(resolve));

/** What `call` throws. `expect(call).toThrow()` also takes an error that is only reported as uncaught during the call. */
function thrownBy(call: () => unknown) {
  try {
    call();
  } catch (error) {
    return error;
  }
}

async function run(cmd: string[], cwd?: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    // A child that hangs is killed rather than left behind.
    timeout: 30_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

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
    }) as { signal: NodeJS.Signals | null; error?: NodeJS.ErrnoException };
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
    expect(() => setSystemTime(ms)).toThrow(
      `setSystemTime() expects a finite number, a Date or a date string. Received ${ms}`,
    );
    expect(Date.now()).toBeGreaterThanOrEqual(realBefore);

    vi.useFakeTimers({ now: 5000 });
    expect(() => setSystemTime(ms)).toThrow(
      `setSystemTime() expects a finite number, a Date or a date string. Received ${ms}`,
    );
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
    expect(() => vi.useFakeTimers(implementation as any)).not.toThrow();
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

// Which function object is called decides which clock a timer is on, as in
// vitest and Jest: useFakeTimers() puts other functions on globalThis.
describe("the functions useFakeTimers() replaces", () => {
  test("are other function objects, and useRealTimers() puts the real ones back", () => {
    const names = ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] as const;
    vi.useFakeTimers();
    const fakes = Object.fromEntries(names.map(name => [name, globalThis[name]]));
    expect(names.filter(name => fakes[name] === saved[name])).toEqual([]);
    expect(names.map(name => [typeof fakes[name], fakes[name].name])).toEqual(names.map(name => ["function", name]));
    // setImmediate is only faked on request.
    expect(setImmediate).toBe(saved.setImmediate);

    vi.useFakeTimers();
    expect(names.filter(name => globalThis[name] === fakes[name] || globalThis[name] === saved[name])).toEqual([]);

    vi.useRealTimers();
    expect(names.filter(name => globalThis[name] !== saved[name])).toEqual([]);
  });

  test("a setTimeout taken before fires on real time", async () => {
    vi.useFakeTimers();
    const fired = Promise.withResolvers<string>();
    saved.setTimeout(fired.resolve, 1, "fired");
    expect(vi.getTimerCount()).toBe(0);
    expect(await fired.promise).toBe("fired");
    expect(performance.now()).toBe(0);
  });

  test("a setInterval taken before repeats on real time", async () => {
    vi.useFakeTimers();
    const thrice = Promise.withResolvers<void>();
    let fires = 0;
    const interval = saved.setInterval(() => ++fires === 3 && thrice.resolve(), 1);
    try {
      expect(vi.getTimerCount()).toBe(0);
      await thrice.promise;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      clearInterval(interval);
    }
  });

  test("refresh() keeps a timer on the clock it was created on", async () => {
    const fired = Promise.withResolvers<void>();
    const realTimer = setTimeout(fired.resolve, 1);
    vi.useFakeTimers();
    const fake = vi.fn();
    const fakeTimer = setTimeout(fake, 10);
    realTimer.refresh();
    expect(vi.getTimerCount()).toBe(1);
    await fired.promise;

    vi.advanceTimersByTime(5);
    fakeTimer.refresh();
    vi.advanceTimersByTime(9);
    expect(fake).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fake).toHaveBeenCalledTimes(1);
  });

  test("refresh() of a fake timer does nothing once its clock is gone", () => {
    vi.useFakeTimers();
    const timer = setTimeout(() => {}, 1);
    vi.advanceTimersByTime(1);
    vi.useRealTimers();
    timer.refresh();
    expect(timer.hasRef()).toBe(false);
    vi.useFakeTimers();
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each(["object", "id"] as const)("either clearTimeout clears either kind of timer by %s", async by => {
    vi.useFakeTimers();
    const fired: string[] = [];
    const handle = (timer: Timer) => (by === "id" ? +timer : timer);
    clearTimeout(handle(saved.setTimeout(() => fired.push("real timeout, fake clear"), 1)));
    clearInterval(handle(saved.setInterval(() => fired.push("real interval, fake clear"), 1)));
    saved.clearTimeout(handle(setTimeout(() => fired.push("fake timeout, real clear"), 1)));
    saved.clearInterval(handle(setInterval(() => fired.push("fake interval, real clear"), 1)));
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10);
    // Later than the two real timers would have fired.
    await waitOnTheRealClock(5);
    expect(fired).toEqual([]);
  });

  test("only the fake setTimeout has the `clock` marker", () => {
    vi.useFakeTimers();
    expect(Object.hasOwn(setTimeout, "clock")).toBe(true);
    expect([saved.setTimeout, setInterval, clearTimeout].filter(fn => Object.hasOwn(fn, "clock"))).toEqual([]);
  });

  test("what the program had put on globalThis comes back", () => {
    const mine = () => {};
    const inBetween = () => {};
    // @ts-expect-error
    globalThis.setTimeout = mine;
    try {
      vi.useFakeTimers();
      expect(setTimeout).not.toBe(mine);
      // @ts-expect-error
      globalThis.setTimeout = inBetween;
      vi.useRealTimers();
      expect(setTimeout).toBe(mine);
    } finally {
      globalThis.setTimeout = saved.setTimeout;
    }
  });

  test("node:timers and node:timers/promises stay real", async () => {
    vi.useFakeTimers();
    expect({
      named: nodeSetTimeout === saved.setTimeout,
      default: nodeTimers.setTimeout === saved.setTimeout,
      required: require("node:timers").setTimeout === saved.setTimeout,
    }).toEqual({ named: true, default: true, required: true });
    const slept = nodeSetTimeoutPromise(1, "slept");
    expect(vi.getTimerCount()).toBe(0);
    expect(await slept).toBe("slept");
  });

  test.concurrent(
    "node:timers and node:timers/promises are real when they are first loaded under fake timers",
    async () => {
      expect(
        await run([
          "-e",
          `const { jest } = Bun.jest();
         const savedSetTimeout = setTimeout;
         jest.useFakeTimers();
         console.log(require("node:timers").setTimeout === savedSetTimeout);
         require("node:util").promisify(savedSetTimeout)(1, "real").then(console.log);
         require("node:timers/promises").setTimeout(1, "promises").then(console.log);
         console.log(jest.getTimerCount());`,
        ]),
      ).toEqual({ stdout: "true\n0\nreal\npromises\n", stderr: "", exitCode: 0, signalCode: null });
    },
  );

  test("util.promisify() of a fake function is on the fake clock", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setImmediate"] });
    const results: string[] = [];
    promisify(setTimeout)(10, "timeout").then(value => results.push(value));
    promisify(setImmediate)("immediate").then(value => results.push(value));
    expect(vi.getTimerCount()).toBe(2);
    await oneLoopTurn();
    expect(results).toEqual([]);
    await vi.advanceTimersByTimeAsync(10);
    expect(results).toEqual(["immediate", "timeout"]);
  });

  // A fake function belongs to the useFakeTimers() call that created it.
  test.each([
    ["useRealTimers()", () => vi.useRealTimers()],
    ["the next useFakeTimers()", () => vi.useFakeTimers({ toFake: [...everyFunction] })],
  ])("a fake function that outlives %s does what the real one does", async (_, end) => {
    Object.assign(globalThis, { requestAnimationFrame: () => 0 });
    try {
      vi.useFakeTimers({ toFake: [...everyFunction] });
      const fake = {
        setTimeout,
        setInterval,
        setImmediate,
        nextTick: process.nextTick,
        queueMicrotask,
        requestAnimationFrame: (globalThis as any).requestAnimationFrame as (callback: () => void) => number,
        sleep: promisify(setTimeout),
        turn: promisify(setImmediate),
      };
      expect(Object.keys(saved).filter(name => fake[name] === saved[name])).toEqual([]);
      end();

      const fired: string[] = [];
      const all = Promise.withResolvers<void>();
      const fire = (name: string) => fired.push(name) === Object.keys(fake).length && all.resolve();
      fake.setTimeout(fire, 1, "setTimeout");
      const interval = fake.setInterval(() => (clearInterval(interval), fire("setInterval")), 1);
      fake.setImmediate(fire, "setImmediate");
      fake.nextTick(fire, "nextTick");
      fake.queueMicrotask(() => fire("queueMicrotask"));
      fake.requestAnimationFrame(() => fire("requestAnimationFrame"));
      fake.sleep(1, "sleep").then(fire);
      fake.turn("turn").then(fire);
      if (vi.isFakeTimers()) expect(vi.getTimerCount()).toBe(0);
      await all.promise;
      expect(fired.sort()).toEqual(Object.keys(fake).sort());
    } finally {
      vi.useRealTimers();
      delete (globalThis as any).requestAnimationFrame;
    }
  });

  test.concurrent("a timer whose callback calls useRealTimers() goes away with the fake clock", async () => {
    const schedulers = ["setInterval(tick, 1)", "setTimeout(tick, 1)", "setTimeout(tick, 1).refresh()"];
    const results = await Promise.all(
      schedulers.map(schedule =>
        run([
          "-e",
          `const { jest } = Bun.jest();
           jest.useFakeTimers();
           let ticks = 0;
           function tick() { ticks++; jest.useRealTimers(); }
           ${schedule};
           jest.advanceTimersByTime(5);
           process.on("exit", () => console.log(ticks));`,
        ]),
      ),
    );
    expect(results).toEqual(schedulers.map(() => ({ stdout: "1\n", stderr: "", exitCode: 0, signalCode: null })));
  });

  test("an interval whose callback starts another fake clock is not on it", () => {
    vi.useFakeTimers();
    let ticks = 0;
    setInterval(() => (ticks++, vi.useFakeTimers()), 1);
    vi.advanceTimersByTime(5);
    expect({ ticks, pending: vi.getTimerCount(), now: performance.now() }).toEqual({ ticks: 1, pending: 0, now: 0 });
  });
});

describe.concurrent("the end of a test file", () => {
  const passed = (stderr: string) =>
    stderr
      .split("\n")
      .filter(line => /^\((pass|fail)\)/.test(line))
      .map(line => line.replace(/ \[[\d.]+ms\]$/, ""));

  /** Never calls useFakeTimers(). */
  const needsRealTimers = `
    import { expect, test, vi } from "bun:test";
    const atTheTop = { setTimeout, date: Date.now() };
    test("nothing is faked", async () => {
      expect(vi.isFakeTimers()).toBe(false);
      expect(vi.getMockedSystemTime()).toBeNull();
      expect(Object.hasOwn(atTheTop.setTimeout, "clock")).toBe(false);
      expect(setTimeout).toBe(atTheTop.setTimeout);
      expect(atTheTop.date).toBeGreaterThan(1e12);
      expect(performance.now()).toBeGreaterThan(0);
      const order = [];
      await new Promise(resolve => {
        process.nextTick(() => order.push("tick"));
        queueMicrotask(() => order.push("microtask"));
        setImmediate(() => order.push("immediate"));
        setTimeout(resolve, 5);
      });
      expect(order).toEqual(["tick", "microtask", "immediate"]);
    });
  `;

  test.each([[[]], [["--isolate"]]])("brings back everything the file left faked %j", async flags => {
    using dir = tempDir("fake-timers-file-end", {
      "a.test.ts": `
        import { test, vi } from "bun:test";
        test("leaves everything faked", () => {
          vi.useFakeTimers({
            now: 0,
            shouldAdvanceTime: true,
            toFake: ["setTimeout", "setInterval", "setImmediate", "nextTick", "queueMicrotask", "Date", "performance", "hrtime"],
          });
          setTimeout(() => console.log("a: timeout"), 1);
          setInterval(() => console.log("a: interval"), 1);
          setImmediate(() => console.log("a: immediate"));
          process.nextTick(() => console.log("a: tick"));
          vi.runAllTimersAsync().then(() => console.log("a: settled"));
        });
      `,
      "b.test.ts": needsRealTimers,
    });
    const { stdout, stderr, exitCode } = await run(["test", ...flags, "./a.test.ts", "./b.test.ts"], String(dir));
    expect({ stdout: stdout.replace(/^bun test .*\n/, ""), passed: passed(stderr), exitCode }, stderr).toEqual({
      stdout: "",
      passed: ["(pass) leaves everything faked", "(pass) nothing is faked"],
      exitCode: 0,
    });
  });

  // As in vitest. What goes on after it would fail where no test is left to fail.
  test.each([[[]], [["--isolate"]]])("leaves the promise of an …Async call in flight pending %j", async flags => {
    using dir = tempDir("fake-timers-file-end-in-flight", {
      "a.test.ts": `
        import { expect, test, vi } from "bun:test";
        test("leaves a call in flight", () => {
          vi.useFakeTimers();
          setInterval(() => {}, 10);
          (async () => {
            await vi.advanceTimersByTimeAsync(1e7);
            console.log("a: goes on");
            expect(1).toBe(2);
          })();
        });
      `,
      "b.test.ts": needsRealTimers,
    });
    const { stdout, stderr, exitCode } = await run(["test", ...flags, "./a.test.ts", "./b.test.ts"], String(dir));
    expect({ stdout: stdout.replace(/^bun test .*\n/, ""), passed: passed(stderr), exitCode }, stderr).toEqual({
      stdout: "",
      passed: ["(pass) leaves a call in flight", "(pass) nothing is faked"],
      exitCode: 0,
    });
  });

  test("what the getter of a global throws is an error of the file that ends", async () => {
    using dir = tempDir("fake-timers-file-end-getter", {
      "a.test.ts": `
        import { test, vi } from "bun:test";
        test("replaces a fake by a getter", () => {
          vi.useFakeTimers();
          Object.defineProperty(globalThis, "clearTimeout", {
            configurable: true,
            get() {
              vi.useFakeTimers();
            },
          });
        });
      `,
      "b.test.ts": `
        import { expect, test, vi } from "bun:test";
        test("nothing is faked", async () => {
          expect(vi.isFakeTimers()).toBe(false);
          await new Promise(resolve => setTimeout(resolve, 5));
        });
      `,
    });
    const { stderr, exitCode } = await run(["test", "./a.test.ts", "./b.test.ts"], String(dir));
    const lines = stderr.split("\n").filter(line => /^(\((pass|fail)\)|error:|\S+\.test\.ts:$)/.test(line));
    expect({ lines: lines.map(line => line.replace(/ \[[\d.]+ms\]$/, "")), exitCode }, stderr).toEqual({
      lines: [
        "a.test.ts:",
        "(pass) replaces a fake by a getter",
        "error: useFakeTimers() and useRealTimers() cannot be called by the getter of a global that they replace.",
        "b.test.ts:",
        "(pass) nothing is faked",
      ],
      exitCode: 1,
    });
  });

  test("ends setSystemTime() without fake timers", async () => {
    using dir = tempDir("fake-timers-file-end-system-time", {
      "a.test.ts": `
        import { setSystemTime, test } from "bun:test";
        test("leaves the time mocked", () => void setSystemTime(0));
      `,
      "b.test.ts": needsRealTimers,
    });
    const { stderr, exitCode } = await run(["test", "./a.test.ts", "./b.test.ts"], String(dir));
    expect({ passed: passed(stderr), exitCode }, stderr).toEqual({
      passed: ["(pass) leaves the time mocked", "(pass) nothing is faked"],
      exitCode: 0,
    });
  });

  test("of a file that fails to load", async () => {
    using dir = tempDir("fake-timers-file-end-load-error", {
      "a.test.ts": `
        import { vi } from "bun:test";
        vi.useFakeTimers({ now: 0 });
        throw new Error("a.test.ts does not load");
      `,
      "b.test.ts": needsRealTimers,
    });
    const { stderr, exitCode } = await run(["test", "./a.test.ts", "./b.test.ts"], String(dir));
    expect(stderr).toContain("a.test.ts does not load");
    expect({ passed: passed(stderr), exitCode }, stderr).toEqual({ passed: ["(pass) nothing is faked"], exitCode: 1 });
  });

  test("--rerun-each: every run starts with the real timers", async () => {
    using dir = tempDir("fake-timers-file-end-rerun", {
      "a.test.ts": `
        import { expect, test, vi } from "bun:test";
        const atTheTop = vi.isFakeTimers();
        test("leaves the timers faked", () => {
          expect([atTheTop, vi.isFakeTimers(), Object.hasOwn(setTimeout, "clock")]).toEqual([false, false, false]);
          vi.useFakeTimers();
        });
      `,
    });
    const { stderr, exitCode } = await run(["test", "--rerun-each=3", "./a.test.ts"], String(dir));
    expect({ passed: passed(stderr), exitCode }, stderr).toEqual({
      passed: Array(3).fill("(pass) leaves the timers faked"),
      exitCode: 0,
    });
  });

  test.each([
    ["useFakeTimers({ now: 0, shouldAdvanceTime: true, advanceTimeDelta: 1 })", true],
    ["setSystemTime(0)", false],
  ])("leaves what a preload mocked at its top level: %s", async (mock, fake) => {
    const file = `
      import { expect, test, vi } from "bun:test";
      test("is mocked", async () => {
        expect(vi.isFakeTimers()).toBe(${fake});
        expect(Date.now()).toBeLessThan(1e9);
        // On a fake clock, this is left to the clock that advances by itself.
        await new Promise(resolve => setTimeout(resolve, 3));
      });
    `;
    using dir = tempDir("fake-timers-file-end-preload", {
      "preload.ts": `import { vi } from "bun:test"; vi.${mock};`,
      "a.test.ts": file,
      "b.test.ts": file,
    });
    const { stderr, exitCode } = await run(
      ["test", "--preload=./preload.ts", "./a.test.ts", "./b.test.ts"],
      String(dir),
    );
    expect({ passed: passed(stderr), exitCode }, stderr).toEqual({
      passed: ["(pass) is mocked", "(pass) is mocked"],
      exitCode: 0,
    });
  });

  test("undoes what a hook of a preload fakes in each file", async () => {
    using dir = tempDir("fake-timers-file-end-preload-hook", {
      "preload.ts": `import { beforeEach, vi } from "bun:test"; beforeEach(() => void vi.useFakeTimers());`,
      "a.test.ts": `
        import { expect, test, vi } from "bun:test";
        const atTheTop = vi.isFakeTimers();
        test("is faked by the hook", () => expect([atTheTop, vi.isFakeTimers()]).toEqual([false, true]));
      `,
      "b.test.ts": `
        import { expect, test, vi } from "bun:test";
        const atTheTop = vi.isFakeTimers();
        test("is faked by the hook again", () => expect([atTheTop, vi.isFakeTimers()]).toEqual([false, true]));
      `,
    });
    const { stderr, exitCode } = await run(
      ["test", "--preload=./preload.ts", "./a.test.ts", "./b.test.ts"],
      String(dir),
    );
    expect({ passed: passed(stderr), exitCode }, stderr).toEqual({
      passed: ["(pass) is faked by the hook", "(pass) is faked by the hook again"],
      exitCode: 0,
    });
  });

  test.each([
    [`vi.useFakeTimers(); vi.stubGlobal("setTimeout", stub);`],
    [`vi.stubGlobal("setTimeout", stub); vi.useFakeTimers();`],
  ])("together with vi.stubGlobal(): %s", async leave => {
    using dir = tempDir("fake-timers-file-end-stub-global", {
      "a.test.ts": `
        import { test, vi } from "bun:test";
        test("leaves setTimeout replaced twice", () => {
          const stub = () => {};
          ${leave}
        });
      `,
      "b.test.ts": needsRealTimers,
    });
    const { stderr, exitCode } = await run(["test", "./a.test.ts", "./b.test.ts"], String(dir));
    expect({ passed: passed(stderr), exitCode }, stderr).toEqual({
      passed: ["(pass) leaves setTimeout replaced twice", "(pass) nothing is faked"],
      exitCode: 0,
    });
  });
});

describe("a global with a getter", () => {
  function withGetter(name: "clearTimeout" | "setImmediate", get: () => unknown, callback: () => void) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)!;
    Object.defineProperty(globalThis, name, { configurable: true, get });
    try {
      callback();
    } finally {
      vi.useRealTimers();
      Object.defineProperty(globalThis, name, descriptor);
    }
  }

  test("that throws leaves the fake timers there are as they were", () => {
    vi.useFakeTimers({ now: 5 });
    const fake = setTimeout;
    const fired = vi.fn();
    setTimeout(fired, 10);
    const getter = () => {
      throw new Error("from the getter");
    };
    withGetter("setImmediate", getter, () => {
      expect(() => vi.useFakeTimers({ toFake: ["setTimeout", "setImmediate"] })).toThrow("from the getter");
      expect([vi.isFakeTimers(), setTimeout === fake, vi.getTimerCount(), Date.now()]).toEqual([true, true, 1, 5]);
      vi.advanceTimersByTime(10);
      expect(fired).toHaveBeenCalledTimes(1);
    });
  });

  test.each(["useFakeTimers", "useRealTimers"] as const)("cannot call %s() while useFakeTimers() reads it", nested => {
    const thrown: unknown[] = [];
    const getter = () => {
      try {
        vi[nested]();
      } catch (error) {
        thrown.push(error);
      }
      return saved.clearTimeout;
    };
    withGetter("clearTimeout", getter, () => {
      vi.useFakeTimers();
      expect(thrown).toEqual([
        new Error("useFakeTimers() and useRealTimers() cannot be called by the getter of a global that they replace."),
      ]);
      expect(vi.isFakeTimers()).toBe(true);
      expect(Object.getOwnPropertyDescriptor(globalThis, "clearTimeout")!.value).toBeFunction();
      const fired = vi.fn();
      clearTimeout(setTimeout(fired, 1));
      setTimeout(fired, 1);
      vi.advanceTimersByTime(1);
      expect(fired).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
      expect([vi.isFakeTimers(), setTimeout, clearTimeout]).toEqual([false, saved.setTimeout, saved.clearTimeout]);
    });
  });
});

describe("useFakeTimers({ toFake, doNotFake })", () => {
  // These have no function object to replace: they are on the clock setTimeout is on.
  const likeSetTimeout = ["AbortSignal.timeout", "Bun.sleep", "Bun.cron"];
  const everything = [
    "setTimeout",
    "setInterval",
    "setImmediate",
    "nextTick",
    "queueMicrotask",
    "Date",
    "performance",
    "hrtime",
    ...likeSetTimeout,
  ];
  const byDefault = ["setTimeout", "setInterval", "Date", "performance", "hrtime", ...likeSetTimeout];

  /** The names in `everything` that are on the fake clock. */
  function whatIsFaked(): string[] {
    const schedulers: Record<string, () => unknown> = {
      setTimeout: () => setTimeout(() => {}, 1e6),
      setInterval: () => setInterval(() => {}, 1e6),
      setImmediate: () => setImmediate(() => {}),
      nextTick: () => process.nextTick(() => {}),
      queueMicrotask: () => queueMicrotask(() => {}),
      "AbortSignal.timeout": () => AbortSignal.timeout(1e6),
      "Bun.sleep": () => Bun.sleep(0),
      "Bun.cron": () => Bun.cron("* * * * *", () => {}),
    };
    const found: string[] = [];
    const realTimers: unknown[] = [];
    // The timer of an AbortSignal that is collected is no longer counted, which would hide the one scheduled meanwhile.
    const kept: unknown[] = [];
    for (const [name, schedule] of Object.entries(schedulers)) {
      const pending = vi.getTimerCount();
      const timer = schedule();
      kept.push(timer);
      if (vi.getTimerCount() > pending) found.push(name);
      else realTimers.push(timer);
    }
    kept.length = 0;
    vi.clearAllTimers();
    for (const timer of realTimers) {
      clearTimeout(timer as Timer);
      clearImmediate(timer as Timer);
      (timer as Partial<Bun.CronJob>)?.stop?.();
    }
    const before = { Date: Date.now(), performance: performance.now(), hrtime: process.hrtime.bigint() };
    vi.advanceTimersByTime(3_600_000);
    if (Date.now() - before.Date >= 3_600_000) found.push("Date");
    if (performance.now() - before.performance >= 3_600_000) found.push("performance");
    if (process.hrtime.bigint() - before.hrtime >= 3_600_000_000_000n) found.push("hrtime");
    return everything.filter(name => found.includes(name));
  }

  test.each<[object | undefined, string[]]>([
    [undefined, byDefault],
    [{}, byDefault],
    [{ toFake: [] }, byDefault],
    [{ toFake: null }, byDefault],
    [{ toFake: ["Date"] }, ["Date"]],
    [{ toFake: ["setTimeout"] }, ["setTimeout", ...likeSetTimeout]],
    [{ toFake: ["setInterval", "clearInterval"] }, ["setInterval"]],
    [{ toFake: ["performance"] }, ["performance"]],
    [{ toFake: ["hrtime"] }, ["hrtime"]],
    [{ toFake: ["setImmediate", "clearImmediate"] }, ["setImmediate"]],
    [{ toFake: ["nextTick"] }, ["nextTick"]],
    [{ toFake: ["queueMicrotask"] }, ["queueMicrotask"]],
    [{ toFake: ["Intl", "Temporal", "requestIdleCallback", "cancelIdleCallback"] }, []],
    [{ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] }, []],
    [{ doNotFake: [] }, byDefault],
    [{ doNotFake: ["Date"] }, byDefault.filter(name => name !== "Date")],
    [{ doNotFake: ["performance", "hrtime"] }, ["setTimeout", "setInterval", "Date", ...likeSetTimeout]],
    [{ doNotFake: ["setTimeout"] }, ["setInterval", "Date", "performance", "hrtime"]],
    [{ doNotFake: ["nextTick", "setImmediate"] }, byDefault],
    [{ toNotFake: ["setInterval"] }, byDefault.filter(name => name !== "setInterval")],
    [
      { toFake: ["Date", "setTimeout", "setImmediate"], doNotFake: ["Date"] },
      ["setTimeout", "setImmediate", ...likeSetTimeout],
    ],
  ])("%j", (options, expected) => {
    for (const api of [vi, jest]) {
      api.useFakeTimers(options as any);
      expect(setTimeout !== saved.setTimeout).toBe(expected.includes("setTimeout"));
      expect(whatIsFaked()).toEqual(expected);
    }
  });

  // https://github.com/oven-sh/bun/issues/44605
  test('toFake: ["setTimeout"] leaves Date, performance.now and process.hrtime real', () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const before = { date: Date.now(), performance: performance.now(), hrtime: process.hrtime.bigint() };
    Bun.sleepSync(5);
    expect(Date.now() - before.date).toBeGreaterThanOrEqual(4);
    expect(performance.now() - before.performance).toBeGreaterThanOrEqual(4);
    expect(process.hrtime.bigint() - before.hrtime).toBeGreaterThanOrEqual(4_000_000n);
  });

  test('toFake: ["setTimeout"]: advanceTimersByTime() fires no setInterval', () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const timeout = vi.fn();
    const interval = vi.fn();
    setTimeout(timeout, 10);
    const handle = setInterval(interval, 10);
    vi.advanceTimersByTime(10_000);
    clearInterval(handle);
    expect({ timeout: timeout.mock.calls.length, interval: interval.mock.calls.length }).toEqual({
      timeout: 1,
      interval: 0,
    });
  });

  test('toFake: ["Date"]: a timeout is real, and setSystemTime() and advanceTimersByTime() move Date', async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: 1000 });
    expect(setTimeout).toBe(saved.setTimeout);
    await new Promise(resolve => setTimeout(resolve, 1));
    expect(Date.now()).toBe(1000);
    vi.advanceTimersByTime(500);
    expect(Date.now()).toBe(1500);
    vi.setSystemTime(5000);
    expect(Date.now()).toBe(5000);
  });

  test("setSystemTime() does not touch a Date that is not faked", () => {
    const before = Date.now();
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    vi.setSystemTime(5000);
    expect(Date.now()).toBeGreaterThanOrEqual(before);
    expect(vi.getMockedSystemTime()).toEqual(new Date(5000));
  });

  test("calling useFakeTimers() again starts over with the new options", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });
    const dropped = vi.fn();
    setTimeout(dropped, 10);
    vi.advanceTimersByTime(5);
    vi.useFakeTimers({ toFake: ["setInterval", "performance"] });
    expect({ setTimeout: setTimeout === saved.setTimeout, setInterval: setInterval === saved.setInterval }).toEqual({
      setTimeout: true,
      setInterval: false,
    });
    expect({ pending: vi.getTimerCount(), now: performance.now() }).toEqual({ pending: 0, now: 0 });
    vi.advanceTimersByTime(100);
    expect(dropped).not.toHaveBeenCalled();
  });

  test.each([
    [{ toFake: "setTimeout" }, "'toFake' must be an array of strings"],
    [{ toFake: 5 }, "'toFake' must be an array of strings"],
    [{ toFake: {} }, "'toFake' must be an array of strings"],
    [{ toFake: [5] }, "'toFake' must be an array of strings"],
    [{ toFake: ["setTimeout", null] }, "'toFake' must be an array of strings"],
    [{ doNotFake: "Date" }, "'doNotFake' must be an array of strings"],
    [{ toNotFake: [{}] }, "'toNotFake' must be an array of strings"],
    [{ toFake: ["setTimeOut"] }, `'toFake' has "setTimeOut", which is not a timer function or clock that can be faked`],
    [{ doNotFake: [""] }, `'doNotFake' has "", which is not a timer function or clock that can be faked`],
  ])("%j throws and leaves the real timers", (options, message) => {
    // @ts-expect-error
    expect(() => vi.useFakeTimers(options)).toThrow(message);
    expect(vi.isFakeTimers()).toBe(false);
    expect(setTimeout).toBe(saved.setTimeout);
  });

  test("an option that throws leaves the fake timers that are active alone", () => {
    vi.useFakeTimers({ now: 1000 });
    const fake = setTimeout;
    setTimeout(() => {}, 10);
    // @ts-expect-error
    expect(() => vi.useFakeTimers({ toFake: ["nope"] })).toThrow("nope");
    expect({ same: setTimeout === fake, pending: vi.getTimerCount(), now: Date.now() }).toEqual({
      same: true,
      pending: 1,
      now: 1000,
    });
  });
});

// A suite can want a performance.now() that stands still while everything that
// waits (a DOM library's animation frames, a helper that polls) goes on for real.
describe('toFake: ["performance"] in a beforeEach', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["performance"] });
  });
  afterEach(async () => {
    vi.useRealTimers();
    await new Promise(resolve => setTimeout(resolve, 1));
  });

  test("replaces no function, and setTimeout has no `clock` marker", () => {
    expect({
      setTimeout: setTimeout === saved.setTimeout,
      setInterval: setInterval === saved.setInterval,
      setImmediate: setImmediate === saved.setImmediate,
      queueMicrotask: queueMicrotask === saved.queueMicrotask,
      nextTick: process.nextTick === saved.nextTick,
      marker: Object.hasOwn(setTimeout, "clock"),
      fake: vi.isFakeTimers(),
    }).toEqual({
      setTimeout: true,
      setInterval: true,
      setImmediate: true,
      queueMicrotask: true,
      nextTick: true,
      marker: false,
      fake: true,
    });
  });

  test("what waits on a timeout, an interval, an immediate or a microtask goes on while performance.now() stands still", async () => {
    const before = { date: Date.now(), hrtime: process.hrtime.bigint() };
    await new Promise(resolve => setTimeout(resolve, 3));
    await new Promise<void>(resolve => {
      let polls = 0;
      const poll = setInterval(() => ++polls === 3 && (clearInterval(poll), resolve()), 1);
    });
    await new Promise(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => queueMicrotask(resolve));
    expect(vi.getTimerCount()).toBe(0);
    expect(performance.now()).toBe(0);
    expect(Date.now() - before.date).toBeGreaterThanOrEqual(3);
    expect(process.hrtime.bigint() - before.hrtime).toBeGreaterThanOrEqual(3_000_000n);
  });

  test("advanceTimersByTime() moves performance.now() and nothing else", () => {
    const before = { date: Date.now(), hrtime: process.hrtime.bigint() };
    vi.advanceTimersByTime(3_600_000);
    expect(performance.now()).toBe(3_600_000);
    expect(Date.now() - before.date).toBeLessThan(3_600_000);
    expect(process.hrtime.bigint() - before.hrtime).toBeLessThan(3_600_000_000_000n);
  });

  test("marks and measures are on the fake clock, which starts at the real time", () => {
    vi.advanceTimersByTime(3_600_000);
    const mark = performance.mark("fake-timers-mark");
    vi.advanceTimersByTime(50);
    const measure = performance.measure("fake-timers-measure", "fake-timers-mark");
    performance.clearMarks("fake-timers-mark");
    performance.clearMeasures("fake-timers-measure");
    expect({ mark: mark.startTime, start: measure.startTime, duration: measure.duration }).toEqual({
      mark: 3_600_000,
      start: 3_600_000,
      duration: 50,
    });
    expect(Math.abs(performance.timeOrigin - Date.now())).toBeLessThan(60_000);
  });
});

describe("a faked setImmediate", () => {
  test("runs before the timeouts of its instant, in order, with its arguments", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setImmediate", "clearImmediate"] });
    expect(setImmediate).not.toBe(saved.setImmediate);
    const order: unknown[] = [];
    AbortSignal.timeout(0).addEventListener("abort", () => order.push("timeout(0)"));
    setImmediate((...args) => order.push(args), 1, 2);
    setImmediate(() => order.push("second"));
    const cleared = setImmediate(() => order.push("cleared"));
    expect(vi.getTimerCount()).toBe(4);
    clearImmediate(cleared);
    expect(vi.getTimerCount()).toBe(3);
    vi.runOnlyPendingTimers();
    expect({ order, now: performance.now() > 0 }).toEqual({ order: [[1, 2], "second", "timeout(0)"], now: true });
  });

  test("armed by a timer callback it is due 1ms later", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setImmediate", "performance"] });
    const at: number[] = [];
    setTimeout(() => setImmediate(() => at.push(performance.now())), 5);
    vi.advanceTimersByTime(5);
    expect(at).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(at).toEqual([6]);
  });

  test("the real clearImmediate clears it, and the fake one a real immediate", async () => {
    vi.useFakeTimers({ toFake: ["setImmediate", "clearImmediate"] });
    expect([setImmediate === saved.setImmediate, clearImmediate === saved.clearImmediate]).toEqual([false, false]);
    const fired = vi.fn();
    saved.clearImmediate(setImmediate(fired));
    expect(vi.getTimerCount()).toBe(0);
    clearImmediate(saved.setImmediate(fired));
    await oneLoopTurn();
    await oneLoopTurn();
    expect(fired).not.toHaveBeenCalled();
  });

  test("useRealTimers() and clearAllTimers() drop it", () => {
    vi.useFakeTimers({ toFake: ["setImmediate"] });
    const immediates = [setImmediate(() => {}), setImmediate(() => {})];
    vi.clearAllTimers();
    expect(vi.getTimerCount()).toBe(0);
    immediates.push(setImmediate(() => {}));
    vi.useRealTimers();
    expect(immediates.map(immediate => immediate.hasRef())).toEqual([false, false, false]);
  });

  test("jest.runAllImmediates() runs the immediates and no timeout", () => {
    jest.useFakeTimers({ toFake: ["setTimeout", "setImmediate"] });
    const order: string[] = [];
    setTimeout(() => order.push("timeout"), 1);
    setImmediate(() => (order.push("immediate"), setImmediate(() => order.push("nested"))));
    expect(jest.runAllImmediates()).toBe(jest);
    expect({ order, pending: jest.getTimerCount() }).toEqual({ order: ["immediate", "nested"], pending: 1 });
  });

  test.concurrent("does not keep the process alive after useRealTimers()", async () => {
    expect(
      await run([
        "-e",
        `const { jest } = Bun.jest();
         jest.useFakeTimers({ toFake: ["setImmediate"] });
         setImmediate(() => console.log("fired"));
         jest.useRealTimers();
         console.log("exiting");`,
      ]),
    ).toEqual({ stdout: "exiting\n", stderr: "", exitCode: 0, signalCode: null });
  });
});

describe("a faked process.nextTick and queueMicrotask", () => {
  const toFake = ["nextTick", "queueMicrotask", "setTimeout"] as const;

  test("wait for runAllTicks()", async () => {
    vi.useFakeTimers({ toFake: [...toFake] });
    expect([process.nextTick === saved.nextTick, queueMicrotask === saved.queueMicrotask]).toEqual([false, false]);
    const order: string[] = [];
    process.nextTick((a, b) => order.push(`tick ${a} ${b}`), 1, 2);
    // @ts-expect-error queueMicrotask passes no arguments on
    queueMicrotask((...args) => order.push(`microtask ${args.length}`), 1);
    expect(vi.getTimerCount()).toBe(2);
    await oneLoopTurn();
    expect(order).toEqual([]);
    expect(vi.runAllTicks()).toBe(vi);
    expect({ order, pending: vi.getTimerCount() }).toEqual({ order: ["tick 1 2", "microtask 0"], pending: 0 });
    vi.useRealTimers();
    expect([process.nextTick === saved.nextTick, queueMicrotask === saved.queueMicrotask]).toEqual([true, true]);
  });

  test("keep their callback and arguments alive", () => {
    vi.useFakeTimers({ toFake: [...toFake] });
    const received: unknown[] = [];
    process.nextTick((...args) => received.push(...args), { first: [1].concat(2) }, { second: [3].concat(4) });
    Bun.gc(true);
    vi.runAllTicks();
    expect(received).toEqual([{ first: [1, 2] }, { second: [3, 4] }]);
  });

  test("run before the next timer and after the last", () => {
    vi.useFakeTimers({ toFake: [...toFake] });
    const order: string[] = [];
    process.nextTick(() => order.push("tick"));
    setTimeout(() => (order.push("timeout 1"), process.nextTick(() => order.push("tick of timeout 1"))), 1);
    setTimeout(() => (order.push("timeout 2"), queueMicrotask(() => order.push("microtask of timeout 2"))), 2);
    vi.advanceTimersByTime(2);
    expect(order).toEqual(["tick", "timeout 1", "tick of timeout 1", "timeout 2", "microtask of timeout 2"]);
  });

  test("one that throws is thrown by runAllTicks(), which leaves the rest queued", () => {
    vi.useFakeTimers({ toFake: [...toFake] });
    const after = vi.fn();
    process.nextTick(() => {
      throw new Error("from a tick");
    });
    process.nextTick(after);
    expect(thrownBy(() => vi.runAllTicks())).toEqual(new Error("from a tick"));
    expect({ ran: after.mock.calls.length, pending: vi.getTimerCount() }).toEqual({ ran: 0, pending: 1 });
    vi.runAllTicks();
    expect(after).toHaveBeenCalledTimes(1);
  });

  test("a tick that queues itself forever stops at the loop limit", () => {
    vi.useFakeTimers({ toFake: [...toFake], loopLimit: 10 });
    let ticks = 0;
    const again = () => (ticks++, process.nextTick(again));
    again();
    expect(() => vi.runAllTicks()).toThrow("Aborting after running 10 timers, assuming an infinite loop!");
    expect(ticks).toBe(11);
  });

  test("clearAllTimers() and useRealTimers() drop them", async () => {
    vi.useFakeTimers({ toFake: [...toFake] });
    const dropped = vi.fn();
    process.nextTick(dropped);
    vi.clearAllTimers();
    expect(vi.getTimerCount()).toBe(0);
    queueMicrotask(dropped);
    vi.useRealTimers();
    await oneLoopTurn();
    expect(dropped).not.toHaveBeenCalled();
  });

  test.each([
    ["process.nextTick", () => process.nextTick(5 as any)],
    ["queueMicrotask", () => queueMicrotask(undefined as any)],
  ])("%s wants a function", (_, call) => {
    vi.useFakeTimers({ toFake: [...toFake] });
    expect(process.nextTick).not.toBe(saved.nextTick);
    expect(call).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
  });

  test("runAllTicks() does nothing when neither is faked", async () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    process.nextTick(tick);
    expect(jest.runAllTicks()).toBe(jest);
    expect(tick).not.toHaveBeenCalled();
    await oneLoopTurn();
    expect(tick).toHaveBeenCalledTimes(1);
  });
});

describe("what a faked tick throws", () => {
  const toFake = ["nextTick", "queueMicrotask", "setTimeout", "performance"] as const;
  const drivers = {
    advanceTimersByTime: () => vi.advanceTimersByTime(100),
    runOnlyPendingTimers: () => vi.runOnlyPendingTimers(),
    advanceTimersToNextFrame: () => vi.advanceTimersToNextFrame(),
    advanceTimersByTimeAsync: () => vi.advanceTimersByTimeAsync(100),
    runOnlyPendingTimersAsync: () => vi.runOnlyPendingTimersAsync(),
    waitFor: () => vi.waitFor(() => {}, { interval: 100 }),
    waitUntil: () => vi.waitUntil(() => true, { interval: 100 }),
    "expect.poll": () => expect.poll(() => 1, { interval: 100 }).toBe(1),
  };
  const throws = () => {
    throw new Error("from a tick");
  };

  /** What `drive` threw or rejected with, which of a tick behind the one that throws and of a timer at 7ms it ran, and where it left the clock. */
  async function outcome(drive: () => unknown, arrange: (queue: () => void) => void) {
    vi.useFakeTimers({ toFake: [...toFake] });
    const ran: string[] = [];
    arrange(() => {
      process.nextTick(throws);
      queueMicrotask(() => ran.push("the next tick"));
    });
    setTimeout(() => ran.push("the timer at 7ms"), 7);
    let thrown: unknown;
    try {
      await drive();
    } catch (error) {
      thrown = error;
    }
    return { thrown, ran, now: performance.now(), pending: vi.getTimerCount() };
  }

  // In vitest too, where it does not hang: a tick that throws between two timers of advanceTimersByTime() is run again for ever.
  describe.each(Object.entries(drivers))("ends %s()", (_, drive) => {
    test("before the first timer", async () => {
      expect(await outcome(drive, queue => queue())).toEqual({
        thrown: new Error("from a tick"),
        ran: [],
        now: 0,
        pending: 2,
      });
    });

    test("between two timers", async () => {
      expect(await outcome(drive, queue => setTimeout(queue, 5))).toEqual({
        thrown: new Error("from a tick"),
        ran: [],
        now: 5,
        pending: 2,
      });
    });

    test("after the last timer", async () => {
      expect(await outcome(drive, queue => setTimeout(queue, 9))).toEqual({
        thrown: new Error("from a tick"),
        ran: ["the timer at 7ms"],
        now: 9,
        pending: 1,
      });
    });

    test("and the next call goes on from there", async () => {
      await outcome(drive, queue => setTimeout(queue, 5));
      const ran = vi.fn();
      queueMicrotask(ran);
      setTimeout(ran, 1);
      vi.advanceTimersByTime(1);
      expect({ calls: ran.mock.calls.length, now: performance.now() }).toEqual({ calls: 2, now: 6 });
    });
  });

  test.each([
    "advanceTimersByTime",
    "runOnlyPendingTimers",
    "advanceTimersByTimeAsync",
    "runOnlyPendingTimersAsync",
  ] as const)("%s() throws it rather than what a timer threw before", async name => {
    vi.useFakeTimers({ toFake: [...toFake] });
    setTimeout(() => {
      process.nextTick(throws);
      throw new Error("from a timer");
    }, 5);
    let thrown: unknown;
    try {
      await drivers[name]();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toEqual(new Error("from a tick"));
  });

  test.each([undefined, null, 0, "", false])("also %p", async value => {
    for (const drive of [drivers.advanceTimersByTime, drivers.advanceTimersByTimeAsync]) {
      vi.useFakeTimers({ toFake: [...toFake] });
      process.nextTick(() => {
        throw value;
      });
      const after = vi.fn();
      process.nextTick(after);
      let thrown: unknown = "nothing";
      try {
        await drive();
      } catch (error) {
        thrown = error;
      }
      expect({ thrown, after: after.mock.calls.length }).toEqual({ thrown: value, after: 0 });
    }
  });
});

// Each in a process of its own: what the loop limit does not stop does not return, and no timeout of a test ends it.
describe("a faked tick that queues itself again", () => {
  const limit = "Aborting after running 100 timers, assuming an infinite loop!";
  const prelude = `
    import { describe, expect, test, vi } from "bun:test";
    const options = { toFake: ["nextTick", "queueMicrotask", "setTimeout", "performance"], loopLimit: 100 };
    let ticks = 0, timers = 0;
    function count() {
      if (++ticks > 1000) {
        console.log("goes on past the loop limit");
        process.exit(7);
      }
    }
    const again = () => (count(), process.nextTick(again));
    const throwsAndAgain = () => {
      count();
      queueMicrotask(throwsAndAgain);
      throw new Error("from a tick");
    };
  `;
  /** What the fixture printed, a line of JSON each, or the line itself. */
  const printed = (stdout: string) =>
    stdout
      .replace(/^bun test .*\n/, "")
      .trim()
      .split("\n")
      .map(line => (line.startsWith("{") ? JSON.parse(line) : line));

  test.concurrent.each([
    ["vi.advanceTimersByTime(10)", 0],
    ["vi.runOnlyPendingTimers()", 0],
    ["vi.advanceTimersToNextFrame()", 0],
    ["vi.advanceTimersByTimeAsync(10)", 0],
    ["vi.runOnlyPendingTimersAsync()", 0],
    // Runs the next timer first.
    ["vi.advanceTimersToNextTimerAsync()", 1],
    ["vi.waitFor(() => {})", 0],
    ["vi.waitUntil(() => true)", 0],
    ["expect.poll(() => 1).toBe(1)", 0],
  ])("%s stops at the loop limit", async (drive, timers) => {
    using dir = tempDir("fake-timers-endless-ticks", {
      "endless.test.ts": `${prelude}
        test.each([again, throwsAndAgain])("%p", async tick => {
          vi.useFakeTimers(options);
          ticks = timers = 0;
          process.nextTick(tick);
          setTimeout(() => timers++, 5);
          let thrown;
          try {
            await ${drive};
          } catch (error) {
            thrown = error;
          }
          console.log(JSON.stringify({ thrown: thrown?.message, ticks, timers, now: performance.now() }));
        });
      `,
    });
    const { stdout, stderr, exitCode, signalCode } = await run(["test", "./endless.test.ts"], String(dir));
    expect({ printed: printed(stdout), exitCode, signalCode }, stderr).toEqual({
      printed: [
        { thrown: limit, ticks: 100, timers, now: timers * 5 },
        { thrown: "from a tick", ticks: 1, timers, now: timers * 5 },
      ],
      exitCode: 0,
      signalCode: null,
    });
  });

  test.concurrent.each([
    ["vi.waitFor(() => expect(0).toBe(1), wait)"],
    ["vi.waitUntil(() => false, wait)"],
    ["expect.poll(() => 0, wait).toBe(1)"],
  ])("%s rejects with it when the first is queued in a later advance", async drive => {
    using dir = tempDir("fake-timers-endless-ticks", {
      "endless.test.ts": `${prelude}
        const wait = { interval: 10, timeout: 60_000 };
        test.each([again, throwsAndAgain])("%p", async tick => {
          vi.useFakeTimers(options);
          ticks = 0;
          setTimeout(() => process.nextTick(tick), 15);
          let thrown;
          try {
            await ${drive};
          } catch (error) {
            thrown = error;
          }
          console.log(JSON.stringify({ thrown: thrown?.message, ticks, now: performance.now() }));
        });
      `,
    });
    const { stdout, stderr, exitCode, signalCode } = await run(["test", "./endless.test.ts"], String(dir));
    expect({ printed: printed(stdout), exitCode, signalCode }, stderr).toEqual({
      printed: [
        { thrown: limit, ticks: 100, now: 15 },
        { thrown: "from a tick", ticks: 1, now: 15 },
      ],
      exitCode: 0,
      signalCode: null,
    });
  });

  test.concurrent("what polls in microtasks for a timer to fire gets the error of the loop limit", async () => {
    using dir = tempDir("fake-timers-endless-ticks", {
      "endless.test.ts": `${prelude}
        test("polls", () => {
          vi.useFakeTimers(options);
          let fired = false;
          const wait = () => (count(), fired || queueMicrotask(wait));
          wait();
          setTimeout(() => (fired = true), 100);
          expect(() => vi.advanceTimersByTime(100)).toThrow(${JSON.stringify(limit)});
          console.log(JSON.stringify({ fired, ticks, now: performance.now() }));
        });
      `,
    });
    const { stdout, stderr, exitCode, signalCode } = await run(["test", "./endless.test.ts"], String(dir));
    expect({ printed: printed(stdout), exitCode, signalCode }, stderr).toEqual({
      printed: [{ fired: false, ticks: 101, now: 0 }],
      exitCode: 0,
      signalCode: null,
    });
  });

  test.concurrent.each([
    ["shouldAdvanceTime", "vi.useFakeTimers({ ...options, shouldAdvanceTime: true, advanceTimeDelta: 1 })"],
    ["interval mode", 'vi.useFakeTimers(options).setTimerTickMode("interval", 1)'],
    ["next timer mode", 'vi.useFakeTimers(options).setTimerTickMode("nextTimerAsync")'],
  ])("%s: it is one uncaught error, and the clock no longer advances by itself", async (_, install) => {
    using dir = tempDir("fake-timers-endless-ticks", {
      "endless.test.ts": `${prelude}
        describe.each([again, throwsAndAgain])("%p", tick => {
          test("fails the test that waits", async () => {
            ${install};
            ticks = 0;
            process.nextTick(tick);
            setTimeout(() => timers++, 5);
            await new Promise(() => {});
          });
          test("and then nothing", async () => {
            // No event says that the clock has not moved: several times the delta of 1ms.
            for (let i = 0; i < 5; i++) {
              Bun.sleepSync(2);
              await new Promise(resolve => setImmediate(resolve));
            }
            console.log(JSON.stringify({ ticks, timers, now: performance.now() }));
          });
        });
      `,
    });
    const { stdout, stderr, exitCode, signalCode } = await run(["test", "./endless.test.ts"], String(dir));
    expect({ printed: printed(stdout), errors: stderr.match(/^error: .*$/gm), exitCode, signalCode }, stderr).toEqual({
      printed: [
        { ticks: 100, timers: 0, now: 0 },
        { ticks: 1, timers: 0, now: 0 },
      ],
      errors: [`error: ${limit}`, "error: from a tick"],
      exitCode: 1,
      signalCode: null,
    });
  });
});

describe("as in @sinonjs/fake-timers", () => {
  const toFake = ["nextTick", "setTimeout", "setImmediate", "performance"] as const;

  test.each([
    ["runAllTimers", () => vi.runAllTimers()],
    ["advanceTimersToNextTimer", () => vi.advanceTimersToNextTimer()],
    ["runAllTimersAsync", () => vi.runAllTimersAsync()],
  ])("the immediate of a tick that is pending for %s() is due at once", async (_, drive) => {
    vi.useFakeTimers({ toFake: [...toFake] });
    const at: number[] = [];
    process.nextTick(() => setImmediate(() => at.push(performance.now())));
    await drive();
    expect(at).toEqual([0]);
  });

  test("a timer that a pending tick schedules is not pending for runOnlyPendingTimersAsync(), as for runOnlyPendingTimers()", async () => {
    vi.useFakeTimers({ toFake: [...toFake] });
    const fired: string[] = [];
    process.nextTick(() => setTimeout(() => fired.push("of the tick"), 1000));
    await vi.runOnlyPendingTimersAsync();
    expect({ fired, now: performance.now() }).toEqual({ fired: [], now: 0 });
    setTimeout(() => fired.push("pending"), 10);
    process.nextTick(() => setTimeout(() => fired.push("of the second tick"), 2000));
    await vi.runOnlyPendingTimersAsync();
    expect({ fired, now: performance.now() }).toEqual({ fired: ["pending", "of the tick"], now: 1000 });
  });

  test("advanceTimersToNextTimerAsync() does not wait for an immediate that is armed again after an await", async () => {
    vi.useFakeTimers({ toFake: ["setImmediate", "performance"] });
    let fires = 0;
    const again = async () => {
      if (++fires > 100) return;
      await null;
      setImmediate(again);
    };
    setImmediate(again);
    await vi.advanceTimersToNextTimerAsync();
    expect({ fires, pending: vi.getTimerCount(), now: performance.now() }).toEqual({ fires: 2, pending: 1, now: 0 });
  });
});

// As in Vitest, what is undone after useRealTimers() puts back what it saw: the fake.
describe("a fake that comes back after useRealTimers()", () => {
  const ways = [
    ["jest.spyOn()", () => void jest.spyOn(globalThis, "setTimeout"), () => void jest.restoreAllMocks()],
    ["vi.stubGlobal()", () => void vi.stubGlobal("setTimeout", () => {}), () => void vi.unstubAllGlobals()],
  ] as const;

  test.each(ways)(
    "%s: it does not say that the timers are fake, and is not what the next useFakeTimers() replaces",
    (_, replace, undo) => {
      try {
        vi.useFakeTimers();
        const fake = setTimeout;
        replace();
        vi.useRealTimers();
        undo();
        expect({ isTheFake: setTimeout === fake, clock: Object.hasOwn(setTimeout, "clock") }).toEqual({
          isTheFake: true,
          clock: false,
        });
        vi.useFakeTimers();
        expect(Object.hasOwn(setTimeout, "clock")).toBe(true);
        vi.useRealTimers();
        expect(setTimeout).toBe(saved.setTimeout);
      } finally {
        globalThis.setTimeout = saved.setTimeout;
      }
    },
  );

  test("process.nextTick", () => {
    try {
      vi.useFakeTimers({ toFake: ["nextTick"] });
      const fake = process.nextTick;
      jest.spyOn(process, "nextTick");
      vi.useRealTimers();
      jest.restoreAllMocks();
      expect(process.nextTick).toBe(fake);
      vi.useFakeTimers({ toFake: ["nextTick"] });
      vi.useRealTimers();
      expect(process.nextTick).toBe(saved.nextTick);
    } finally {
      process.nextTick = saved.nextTick;
    }
  });

  test.concurrent.each([
    ["jest.spyOn()", `jest.spyOn(globalThis, "setTimeout")`, "jest.restoreAllMocks()"],
    ["vi.stubGlobal()", `vi.stubGlobal("setTimeout", () => {})`, "vi.unstubAllGlobals()"],
  ])("%s: it is gone at the end of the test file", async (_, replace, undo) => {
    using dir = tempDir("fake-timers-file-end-stale", {
      "a.test.ts": `
        import { afterEach, beforeEach, expect, jest, test, vi } from "bun:test";
        globalThis.setTimeoutAtFirst = setTimeout;
        beforeEach(() => {
          jest.useFakeTimers();
          ${replace};
        });
        afterEach(() => {
          jest.useRealTimers();
          ${undo};
        });
        test.each([1, 2])("fakes and replaces %d", () => {
          expect(setTimeout).not.toBe(setTimeoutAtFirst);
        });
      `,
      "b.test.ts": `
        import { test } from "bun:test";
        test("has the real function", async () => {
          console.log(JSON.stringify({ isReal: setTimeout === setTimeoutAtFirst, clock: Object.hasOwn(setTimeout, "clock") }));
          await new Promise(resolve => setTimeout(resolve, 1));
        });
      `,
    });
    const { stdout, stderr, exitCode } = await run(["test", "./a.test.ts", "./b.test.ts"], String(dir));
    expect({ stdout: stdout.replace(/^bun test .*\n/, ""), exitCode }, stderr).toEqual({
      stdout: JSON.stringify({ isReal: true, clock: false }) + "\n",
      exitCode: 0,
    });
  });
});

describe("a faked requestAnimationFrame", () => {
  const dom = globalThis as unknown as {
    requestAnimationFrame?: (callback: (now: number) => void) => number;
    cancelAnimationFrame?: (id: number) => void;
  };
  const ofTheDom = { requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} };
  afterEach(() => {
    vi.useRealTimers();
    delete dom.requestAnimationFrame;
    delete dom.cancelAnimationFrame;
  });
  const toFake = ["requestAnimationFrame", "cancelAnimationFrame", "performance"] as const;

  test("runs at the next multiple of 16ms, with the time of the frame", () => {
    Object.assign(dom, ofTheDom);
    vi.useFakeTimers({ toFake: [...toFake] });
    expect(dom.requestAnimationFrame).not.toBe(ofTheDom.requestAnimationFrame);
    const frames: number[] = [];
    vi.advanceTimersByTime(5);
    const id = dom.requestAnimationFrame!(now => frames.push(now, performance.now()));
    expect(typeof id).toBe("number");
    dom.cancelAnimationFrame!(dom.requestAnimationFrame!(() => frames.push(-1)));
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(10);
    expect(frames).toEqual([]);
    expect(vi.advanceTimersToNextFrame()).toBe(vi);
    expect({ frames, now: performance.now() }).toEqual({ frames: [16, 16], now: 16 });
    jest.advanceTimersToNextFrame();
    expect(performance.now()).toBe(32);

    vi.useRealTimers();
    expect(dom.requestAnimationFrame).toBe(ofTheDom.requestAnimationFrame);
    expect(dom.cancelAnimationFrame).toBe(ofTheDom.cancelAnimationFrame);
  });

  test.each([[undefined], [{ toFake: [...toFake] }]])("is faked only where there is one: %j", options => {
    vi.useFakeTimers(options);
    expect(["requestAnimationFrame" in globalThis, "cancelAnimationFrame" in globalThis]).toEqual([false, false]);
  });

  // As in Jest and Vitest: the timers a DOM library runs its own frames on are not the test's to advance.
  test.each([
    ["vi", vi],
    ["jest", jest],
  ])("%s.useFakeTimers() fakes it by default", (_, fake) => {
    Object.assign(dom, ofTheDom);
    fake.useFakeTimers();
    expect(dom.requestAnimationFrame).not.toBe(ofTheDom.requestAnimationFrame);
    expect(dom.cancelAnimationFrame).not.toBe(ofTheDom.cancelAnimationFrame);
    const frames: number[] = [];
    dom.requestAnimationFrame!(now => frames.push(now));
    dom.cancelAnimationFrame!(dom.requestAnimationFrame!(() => frames.push(-1)));
    fake.advanceTimersByTime(15);
    expect(frames).toEqual([]);
    fake.advanceTimersByTime(1);
    expect(frames).toEqual([16]);

    fake.useRealTimers();
    expect(dom.requestAnimationFrame).toBe(ofTheDom.requestAnimationFrame);
    expect(dom.cancelAnimationFrame).toBe(ofTheDom.cancelAnimationFrame);
  });

  test.each([
    [{ doNotFake: ["requestAnimationFrame"] }, [false, true]],
    [{ toNotFake: ["cancelAnimationFrame"] }, [true, false]],
    [{ doNotFake: ["requestAnimationFrame", "cancelAnimationFrame"] }, [false, false]],
    [{ toFake: ["setTimeout"] }, [false, false]],
    [{ toFake: ["cancelAnimationFrame"] }, [false, true]],
  ] as const)("%j", (options, faked) => {
    Object.assign(dom, ofTheDom);
    vi.useFakeTimers(options as unknown as Parameters<typeof vi.useFakeTimers>[0]);
    expect([
      dom.requestAnimationFrame !== ofTheDom.requestAnimationFrame,
      dom.cancelAnimationFrame !== ofTheDom.cancelAnimationFrame,
    ]).toEqual([...faked]);
  });
});

describe("a callback that throws", () => {
  const boom = (order: number[], n: number) => () => {
    order.push(n);
    throw new Error(`boom ${n}`);
  };

  test("advanceTimersByTime() runs the rest, moves the clock, and throws the first error", () => {
    vi.useFakeTimers();
    const order: number[] = [];
    setTimeout(boom(order, 1), 10);
    setTimeout(boom(order, 2), 20);
    setTimeout(() => order.push(3), 30);
    expect(thrownBy(() => vi.advanceTimersByTime(100))).toEqual(new Error("boom 1"));
    expect({ order, now: performance.now() }).toEqual({ order: [1, 2, 3], now: 100 });
  });

  test("runOnlyPendingTimers() runs the rest and throws the first error", () => {
    vi.useFakeTimers();
    const order: number[] = [];
    setTimeout(boom(order, 1), 10);
    setTimeout(() => order.push(2), 20);
    expect(thrownBy(() => vi.runOnlyPendingTimers())).toEqual(new Error("boom 1"));
    expect(order).toEqual([1, 2]);
  });

  test.each(["runAllTimers", "advanceTimersToNextTimer"] as const)("%s() stops at it", control => {
    vi.useFakeTimers();
    const order: number[] = [];
    setTimeout(boom(order, 1), 10);
    setTimeout(() => order.push(2), 10);
    expect(thrownBy(() => vi[control]())).toEqual(new Error("boom 1"));
    expect({ order, pending: vi.getTimerCount() }).toEqual({ order: [1], pending: 1 });
  });

  test("what is thrown need not be an Error", () => {
    vi.useFakeTimers();
    setTimeout(() => {
      throw "a string";
    }, 1);
    let thrown;
    try {
      vi.advanceTimersByTime(1);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe("a string");
  });

  test.each(["advanceTimersByTime", "advanceTimersByTimeAsync"] as const)(
    "%s() keeps what was thrown alive while the later timers run",
    async control => {
      vi.useFakeTimers();
      setTimeout(() => {
        throw { thrownBy: ["the", "first", "timer"].join(" ") };
      }, 1);
      for (let ms = 2; ms < 6; ms++) setTimeout(() => Bun.gc(true), ms);
      let thrown;
      try {
        await vi[control](10);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toEqual({ thrownBy: "the first timer" });
    },
  );

  test("an interval that throws stays armed", () => {
    vi.useFakeTimers();
    let fires = 0;
    setInterval(() => {
      fires++;
      throw new Error("every time");
    }, 10);
    expect(thrownBy(() => vi.advanceTimersByTime(30))).toEqual(new Error("every time"));
    expect({ fires, pending: vi.getTimerCount() }).toEqual({ fires: 3, pending: 1 });
  });
});

describe("advanceTimersToNextTimer", () => {
  test("runs every timer of the next instant", () => {
    vi.useFakeTimers();
    const order: string[] = [];
    setTimeout(() => order.push("a"), 100);
    setTimeout(() => order.push("b"), 100);
    setTimeout(() => order.push("c"), 200);
    vi.advanceTimersToNextTimer();
    expect({ order, now: performance.now() }).toEqual({ order: ["a", "b"], now: 100 });
  });

  test.each([
    [0, []],
    [1.5, [10, 20]],
    [2, [10, 20]],
    [100, [10, 20, 30]],
  ])("(%p)", (steps, fired) => {
    jest.useFakeTimers();
    const at: number[] = [];
    for (const ms of [10, 20, 30]) setTimeout(() => at.push(ms), ms);
    expect(jest.advanceTimersToNextTimer(steps)).toBe(jest);
    expect(at).toEqual(fired);
  });

  test.each([
    ["1", "advanceTimersToNextTimer() expects a number of steps"],
    [null, "advanceTimersToNextTimer() expects a number of steps"],
    [-1, "advanceTimersToNextTimer() steps is out of range. It must be >= 0 and <= 4294967295. Received -1"],
    [NaN, "advanceTimersToNextTimer() steps is out of range. It must be >= 0 and <= 4294967295. Received NaN"],
    [
      2 ** 32,
      "advanceTimersToNextTimer() steps is out of range. It must be >= 0 and <= 4294967295. Received 4294967296",
    ],
  ])("(%p) throws", (steps, message) => {
    vi.useFakeTimers();
    const fired = vi.fn();
    setTimeout(fired, 1);
    // @ts-expect-error
    expect(() => vi.advanceTimersToNextTimer(steps)).toThrow(message);
    expect(fired).not.toHaveBeenCalled();
  });
});

describe("the loop limit", () => {
  function givesUpOnAnInterval(api: typeof vi | typeof jest, options: object, limit: number) {
    api.useFakeTimers(options as any);
    let fires = 0;
    setInterval(() => fires++, 1);
    expect(() => api.runAllTimers()).toThrow(`Aborting after running ${limit} timers, assuming an infinite loop!`);
    expect({ fires, pending: api.getTimerCount(), now: performance.now() }).toEqual({
      fires: limit,
      pending: 1,
      now: limit,
    });
  }

  test.each([
    [vi, {}, 10_000],
    [vi, { loopLimit: 5 }, 5],
    [jest, { timerLimit: 5 }, 5],
    [vi, { timerLimit: 7 }, 7],
    [jest, { loopLimit: 7 }, 7],
    [vi, { loopLimit: 0 }, 10_000],
  ] as const)("runAllTimers() gives up on a setInterval: %# %j", givesUpOnAnInterval);

  // 100,000 timers take seconds in a debug build.
  test(
    "runAllTimers() gives up on a setInterval: the default of jest",
    () => givesUpOnAnInterval(jest, {}, 100_000),
    60_000,
  );

  test("as many timers as the limit are not a loop", () => {
    vi.useFakeTimers({ loopLimit: 3 });
    const fired = vi.fn();
    for (let i = 0; i < 3; i++) setTimeout(fired, i);
    vi.runAllTimers();
    expect(fired).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 4; i++) setTimeout(fired, i);
    expect(() => vi.runAllTimers()).toThrow("Aborting after running 3 timers");
    expect(fired).toHaveBeenCalledTimes(6);
  });

  test("runAllTimersAsync() rejects", async () => {
    vi.useFakeTimers({ loopLimit: 5 });
    let fires = 0;
    setInterval(() => fires++, 1);
    await expect(vi.runAllTimersAsync()).rejects.toThrow("Aborting after running 5 timers, assuming an infinite loop!");
    expect(fires).toBe(5);
  });

  test.each([
    [{ loopLimit: "5" }, "'loopLimit' must be a number of timers"],
    [{ timerLimit: {} }, "'timerLimit' must be a number of timers"],
    [{ loopLimit: -1 }, "'loopLimit' is out of range. It must be >= 0 and <= 4294967295. Received -1"],
    [{ loopLimit: NaN }, "'loopLimit' is out of range. It must be >= 0 and <= 4294967295. Received NaN"],
    [{ timerLimit: 2 ** 32 }, "'timerLimit' is out of range. It must be >= 0 and <= 4294967295. Received 4294967296"],
  ])("%j throws", (options, message) => {
    // @ts-expect-error
    expect(() => vi.useFakeTimers(options)).toThrow(message);
    expect(vi.isFakeTimers()).toBe(false);
  });
});

describe.each([
  ["vi", vi],
  ["jest", jest],
] as const)("%s: the Async functions", (_, api) => {
  // vitest resolves with `vi`, Jest with nothing.
  const resolved = api === vi ? vi : undefined;

  /** A chain of timeouts, each armed after an `await` in the callback of the one before. */
  function chain(at: number[], length: number, wait: () => Promise<unknown>) {
    const arm = () =>
      setTimeout(async () => {
        at.push(performance.now());
        await wait();
        if (at.length < length) arm();
      }, 10);
    arm();
  }

  describe.each([
    ["a promise job", () => Promise.resolve()],
    ["a real setImmediate", oneLoopTurn],
  ])("see a timer that is armed after %s", (_, wait) => {
    test("advanceTimersByTimeAsync", async () => {
      api.useFakeTimers();
      const at: number[] = [];
      chain(at, 10, wait);
      expect(await api.advanceTimersByTimeAsync(35)).toBe(resolved);
      expect({ at, now: performance.now(), pending: api.getTimerCount() }).toEqual({
        at: [10, 20, 30],
        now: 35,
        pending: 1,
      });
    });

    test("runAllTimersAsync", async () => {
      api.useFakeTimers();
      const at: number[] = [];
      chain(at, 3, wait);
      expect(await api.runAllTimersAsync()).toBe(resolved);
      expect({ at, now: performance.now(), pending: api.getTimerCount() }).toEqual({
        at: [10, 20, 30],
        now: 30,
        pending: 0,
      });
    });

    test("advanceTimersToNextTimerAsync(steps)", async () => {
      api.useFakeTimers();
      const at: number[] = [];
      chain(at, 10, wait);
      expect(await api.advanceTimersToNextTimerAsync(2)).toBe(resolved);
      expect({ at, now: performance.now(), pending: api.getTimerCount() }).toEqual({
        at: [10, 20],
        now: 20,
        pending: 1,
      });
    });
  });

  test("return a pending promise and run nothing before they return", async () => {
    api.useFakeTimers();
    const fired = vi.fn();
    setTimeout(fired, 0);
    const promises = [
      api.advanceTimersByTimeAsync(1),
      api.advanceTimersToNextTimerAsync(),
      api.runAllTimersAsync(),
      api.runOnlyPendingTimersAsync(),
    ];
    expect(promises.map(promise => Bun.peek.status<unknown>(promise))).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(fired).not.toHaveBeenCalled();
    expect(await Promise.all(promises)).toEqual([resolved, resolved, resolved, resolved]);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  test("runOnlyPendingTimersAsync() goes as far as the last timer that was pending", async () => {
    api.useFakeTimers();
    const order: string[] = [];
    setInterval(() => order.push("interval"), 24);
    setTimeout(async () => {
      order.push("timeout");
      await oneLoopTurn();
      setTimeout(() => order.push("in range"), 10);
      setTimeout(() => order.push("out of range"), 100);
    }, 50);
    setTimeout(() => order.push("last"), 100);
    expect(await api.runOnlyPendingTimersAsync()).toBe(resolved);
    expect({ order, now: performance.now() }).toEqual({
      order: ["interval", "interval", "timeout", "in range", "interval", "interval", "last"],
      now: 100,
    });
  });

  test("runOnlyPendingTimersAsync() and runAllTimersAsync() with no timer", async () => {
    api.useFakeTimers();
    expect(await api.runOnlyPendingTimersAsync()).toBe(resolved);
    expect(await api.runAllTimersAsync()).toBe(resolved);
    expect(await api.advanceTimersToNextTimerAsync()).toBe(resolved);
    expect(performance.now()).toBe(0);
  });

  test("advanceTimersToNextTimerAsync() runs every timer of the next instant", async () => {
    api.useFakeTimers();
    const order: string[] = [];
    setTimeout(() => order.push("a"), 100);
    setTimeout(() => order.push("b"), 100);
    setTimeout(() => order.push("c"), 200);
    await api.advanceTimersToNextTimerAsync();
    expect({ order, now: performance.now() }).toEqual({ order: ["a", "b"], now: 100 });
    await api.advanceTimersToNextTimerAsync(0);
    expect(order).toEqual(["a", "b"]);
    await api.advanceTimersToNextTimerAsync(100);
    expect(order).toEqual(["a", "b", "c"]);
  });

  test("advanceTimersByTimeAsync(0) fires setTimeout(fn, 0)", async () => {
    api.useFakeTimers();
    const fired = vi.fn();
    setTimeout(fired, 0);
    await api.advanceTimersByTimeAsync(0);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  test("a loop of zero-delay timers moves the clock while advanceTimersByTimeAsync() runs", async () => {
    api.useFakeTimers();
    const polledAt: number[] = [];
    (async () => {
      while (polledAt.length < 50) {
        polledAt.push(performance.now());
        await Bun.sleep(0);
        await oneLoopTurn();
      }
    })();
    await api.advanceTimersByTimeAsync(3);
    expect({ polledAt, now: performance.now() }).toEqual({ polledAt: [0, 0, 1, 2, 3], now: 3 });
  });

  test("two at once each move the clock by their own amount", async () => {
    api.useFakeTimers();
    const at: number[] = [];
    for (const ms of [5, 10, 15, 20, 25]) setTimeout(() => at.push(performance.now()), ms);
    await Promise.all([api.advanceTimersByTimeAsync(10), api.advanceTimersByTimeAsync(10)]);
    expect({ at, now: performance.now() }).toEqual({ at: [5, 10, 15, 20], now: 20 });
  });

  describe("a callback that throws", () => {
    const boom = (order: number[], n: number) => () => {
      order.push(n);
      throw new Error(`boom ${n}`);
    };

    test("advanceTimersByTimeAsync() runs the rest, moves the clock, and rejects with the first error", async () => {
      api.useFakeTimers();
      const order: number[] = [];
      setTimeout(boom(order, 1), 10);
      setTimeout(boom(order, 2), 20);
      setTimeout(() => order.push(3), 30);
      await expect(api.advanceTimersByTimeAsync(100)).rejects.toThrow("boom 1");
      expect({ order, now: performance.now() }).toEqual({ order: [1, 2, 3], now: 100 });
    });

    test("runOnlyPendingTimersAsync() runs the rest and rejects with the first error", async () => {
      api.useFakeTimers();
      const order: number[] = [];
      setTimeout(boom(order, 1), 10);
      setTimeout(() => order.push(2), 20);
      await expect(api.runOnlyPendingTimersAsync()).rejects.toThrow("boom 1");
      expect(order).toEqual([1, 2]);
    });

    test.each(["runAllTimersAsync", "advanceTimersToNextTimerAsync"] as const)("%s() stops at it", async control => {
      api.useFakeTimers();
      const order: number[] = [];
      setTimeout(boom(order, 1), 10);
      setTimeout(() => order.push(2), 10);
      await expect(api[control]()).rejects.toThrow("boom 1");
      expect({ order, pending: api.getTimerCount() }).toEqual({ order: [1], pending: 1 });
    });

    test("advanceTimersToNextTimerAsync(): the second timer of an instant does not stop the third", async () => {
      api.useFakeTimers();
      const order: number[] = [];
      setTimeout(() => order.push(1), 10);
      setTimeout(boom(order, 2), 10);
      setTimeout(() => order.push(3), 10);
      setTimeout(() => order.push(4), 20);
      await expect(api.advanceTimersToNextTimerAsync(2)).rejects.toThrow("boom 2");
      expect(order).toEqual([1, 2, 3]);
    });
  });

  test("reject where their namesakes throw", async () => {
    await expect(api.advanceTimersByTimeAsync(1)).rejects.toThrow("Fake timers are not active");
    await expect(api.advanceTimersToNextTimerAsync()).rejects.toThrow("Fake timers are not active");
    await expect(api.runAllTimersAsync()).rejects.toThrow("Fake timers are not active");
    await expect(api.runOnlyPendingTimersAsync()).rejects.toThrow("Fake timers are not active");
    api.useFakeTimers();
    // @ts-expect-error
    await expect(api.advanceTimersByTimeAsync()).rejects.toThrow(
      "advanceTimersByTimeAsync() expects a number of milliseconds",
    );
    await expect(api.advanceTimersByTimeAsync(-1)).rejects.toThrow(
      "advanceTimersByTimeAsync() ms is out of range. It must be >= 0 and <= 4294967295. Received -1",
    );
    // @ts-expect-error
    await expect(api.advanceTimersToNextTimerAsync("1")).rejects.toThrow(
      "advanceTimersToNextTimerAsync() expects a number of steps",
    );
    expect(performance.now()).toBe(0);
  });

  describe("when the fake clock goes away under them", () => {
    test("useRealTimers() in a callback settles them, and the dropped timers do not fire", async () => {
      api.useFakeTimers();
      const order: number[] = [];
      setTimeout(() => (order.push(1), api.useRealTimers()), 10);
      setTimeout(() => order.push(2), 20);
      expect(await Promise.all([api.advanceTimersByTimeAsync(100), api.runAllTimersAsync()])).toEqual([
        resolved,
        resolved,
      ]);
      expect({ order, fake: api.isFakeTimers() }).toEqual({ order: [1], fake: false });
    });

    test("useRealTimers() right after the call settles them", async () => {
      api.useFakeTimers();
      const fired = vi.fn();
      setTimeout(fired, 10);
      const promises = [
        api.advanceTimersByTimeAsync(100),
        api.runAllTimersAsync(),
        api.advanceTimersToNextTimerAsync(),
        api.runOnlyPendingTimersAsync(),
      ];
      api.useRealTimers();
      expect(await Promise.all(promises)).toEqual([resolved, resolved, resolved, resolved]);
      expect(fired).not.toHaveBeenCalled();
    });

    test("they leave the timers of the next fake clock alone", async () => {
      api.useFakeTimers();
      setTimeout(() => {}, 10);
      const old = [api.advanceTimersByTimeAsync(100), api.runAllTimersAsync()];
      api.useFakeTimers();
      const fired = vi.fn();
      setTimeout(fired, 10);
      await Promise.all(old);
      await oneLoopTurn();
      await oneLoopTurn();
      expect({ fired: fired.mock.calls.length, now: performance.now(), pending: api.getTimerCount() }).toEqual({
        fired: 0,
        now: 0,
        pending: 1,
      });
    });

    test("an error thrown after useRealTimers() in the same callback is not lost", async () => {
      using dir = tempDir("fake-timers-async-throw", {
        "throw.test.ts": `
          import { test, ${_} as api } from "bun:test";
          test("throws", async () => {
            api.useFakeTimers();
            setTimeout(() => {
              api.useRealTimers();
              throw new Error("after useRealTimers()");
            }, 10);
            await api.advanceTimersByTimeAsync(10);
            await new Promise(resolve => setImmediate(resolve));
          });
        `,
      });
      const { stderr, exitCode } = await run(["test", "./throw.test.ts"], String(dir));
      expect(stderr).toContain("error: after useRealTimers()");
      expect(stderr).toContain(" 1 fail");
      expect(exitCode).toBe(1);
    });
  });

  test("keep the process alive until they settle", async () => {
    expect(
      await run([
        "-e",
        `const { ${_}: api } = Bun.jest();
         api.useFakeTimers();
         setTimeout(() => console.log("fired"), 1000).unref();
         api.runAllTimersAsync().then(() => (api.useRealTimers(), console.log("settled")));`,
      ]),
    ).toEqual({ stdout: "fired\nsettled\n", stderr: "", exitCode: 0, signalCode: null });
  });
});

describe("the clock that advances by itself", () => {
  test.each([
    ["vi", { shouldAdvanceTime: true }, 20],
    ["vi", { shouldAdvanceTime: true, advanceTimeDelta: 5 }, 5],
    ["vi", { shouldAdvanceTime: true, advanceTimeDelta: 0 }, 20],
    ["jest", { advanceTimers: true }, 20],
    ["jest", { advanceTimers: 5 }, 5],
  ] as const)("%s.useFakeTimers(%j) fires a timer without any manual advance", async (name, options, delta) => {
    ({ vi, jest })[name].useFakeTimers({ ...options, now: 0 });
    const firedAt = await new Promise<number>(resolve => setTimeout(() => resolve(Date.now()), 30));
    expect(firedAt).toBe(30);
    // The clock moves in steps of the delta: a promise job runs when a step is complete.
    expect(Date.now() % delta).toBe(0);
    expect(Date.now()).toBeGreaterThanOrEqual(30);
  });

  test.each([
    [{}],
    [{ shouldAdvanceTime: false, advanceTimeDelta: 1 }],
    [{ advanceTimeDelta: 1 }],
    [{ advanceTimers: false }],
    [{ advanceTimers: 0 }],
  ])("useFakeTimers(%j) does not advance", async options => {
    vi.useFakeTimers({ ...options, now: 0 });
    // No event says that the clock has not moved: several times the delta of 1ms.
    await waitOnTheRealClock(10);
    expect(Date.now()).toBe(0);
  });

  test.each([
    ["useRealTimers()", () => (vi.useRealTimers(), vi.useFakeTimers({ now: 0 }))],
    ["useFakeTimers()", () => vi.useFakeTimers({ now: 0 })],
    ['setTimerTickMode("manual")', () => (vi.setTimerTickMode("manual"), vi.setSystemTime(0))],
  ])("stops at %s", async (_, stop) => {
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1 });
    await new Promise(resolve => setTimeout(resolve, 2));
    stop();
    // No event says that the clock has not moved: several times the delta of 1ms.
    await waitOnTheRealClock(10);
    expect(Date.now()).toBe(0);
  });

  test("manual advances still work", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1, now: 0 });
    const fired = vi.fn();
    setTimeout(fired, 1_000_000);
    vi.advanceTimersByTime(1_000_000);
    expect(fired).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000_000);
    expect(Date.now()).toBeGreaterThanOrEqual(2_000_000);
  });

  test.concurrent("an error thrown by a timer it fires is an uncaught error, and it goes on", async () => {
    expect(
      await run([
        "-e",
        `const { vi } = Bun.jest();
         process.on("uncaughtException", error => console.log("uncaught:", error.message));
         vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1 });
         setTimeout(() => { throw new Error("from a timer"); }, 1);
         setTimeout(() => (console.log("later"), vi.useRealTimers()), 3);`,
      ]),
    ).toEqual({ stdout: "uncaught: from a timer\nlater\n", stderr: "", exitCode: 0, signalCode: null });
  });

  test.concurrent("does not keep the process alive once the last fake timer has fired", async () => {
    expect(
      await run([
        "-e",
        `Bun.jest().vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1 });
         setTimeout(() => console.log("fired at", performance.now()), 3);`,
      ]),
    ).toEqual({ stdout: "fired at 3\n", stderr: "", exitCode: 0, signalCode: null });
  });

  test.concurrent.each(["shouldAdvanceTime: true, advanceTimeDelta: 1", "tickMode: 'nextTimerAsync'"])(
    "stops at the end of the test file that started it (%s)",
    async how => {
      using dir = tempDir("fake-timers-advance-file-end", {
        "a.test.ts": `
          import { test, vi } from "bun:test";
          test("leaves the clock advancing", async () => {
            const options = { now: 0, ${how} };
            vi.useFakeTimers(options);
            if (options.tickMode) vi.setTimerTickMode(options.tickMode);
            await new Promise(resolve => setTimeout(resolve, 2));
          });
        `,
        "b.test.ts": `
          import { expect, test, vi } from "bun:test";
          test("the clock stands still", async () => {
            vi.useFakeTimers();
            const fired = vi.fn();
            setTimeout(fired, 1);
            const before = Date.now();
            for (let i = 0; i < 5; i++) {
              Bun.sleepSync(2);
              await new Promise(resolve => setImmediate(resolve));
            }
            expect({ moved: Date.now() - before, fired: fired.mock.calls.length }).toEqual({ moved: 0, fired: 0 });
          });
        `,
      });
      const { stderr, exitCode } = await run(["test", "./a.test.ts", "./b.test.ts"], String(dir));
      expect(stderr).toContain(" 2 pass");
      expect(exitCode).toBe(0);
    },
  );

  test.each([
    [{ shouldAdvanceTime: 1 }, "'shouldAdvanceTime' must be a boolean"],
    [{ shouldAdvanceTime: "true" }, "'shouldAdvanceTime' must be a boolean"],
    [{ advanceTimeDelta: "5" }, "'advanceTimeDelta' must be a number of milliseconds"],
    [{ advanceTimeDelta: -1 }, "'advanceTimeDelta' is out of range. It must be >= 0 and <= 2147483647. Received -1"],
    [{ advanceTimeDelta: NaN }, "'advanceTimeDelta' is out of range. It must be >= 0 and <= 2147483647. Received NaN"],
    [
      { advanceTimeDelta: 2 ** 31 },
      "'advanceTimeDelta' is out of range. It must be >= 0 and <= 2147483647. Received 2147483648",
    ],
    [{ advanceTimers: "5" }, "'advanceTimers' must be a boolean or a number of milliseconds"],
    [{ advanceTimers: -1 }, "'advanceTimers' is out of range. It must be >= 0 and <= 2147483647. Received -1"],
  ])("useFakeTimers(%j) throws", (options, message) => {
    // @ts-expect-error
    expect(() => vi.useFakeTimers(options)).toThrow(message);
    expect(vi.isFakeTimers()).toBe(false);
  });
});

describe("setTimerTickMode", () => {
  test.each([
    ["vi", ["nextTimerAsync"]],
    ["jest", [{ mode: "nextAsync" }]],
  ] as const)("%s: next timer mode runs the timers one after the other, however far apart", async (name, args) => {
    const api = { vi, jest }[name];
    api.useFakeTimers();
    // @ts-expect-error each has its own signature
    expect(api.setTimerTickMode(...args)).toBe(api);
    const at: number[] = [];
    await new Promise(resolve => setTimeout(resolve, 100_000));
    at.push(performance.now());
    await new Promise(resolve => setTimeout(resolve, 50));
    at.push(performance.now());
    const five = Promise.withResolvers<void>();
    let fires = 0;
    const interval = setInterval(() => ++fires === 5 && (clearInterval(interval), five.resolve()), 1000);
    await five.promise;
    at.push(performance.now());
    expect(at).toEqual([100_000, 100_050, 105_050]);
  });

  test("next timer mode lets real work run between two timers", async () => {
    vi.useFakeTimers();
    vi.setTimerTickMode("nextTimerAsync");
    const order: string[] = [];
    const done = Promise.withResolvers<void>();
    setTimeout(() => (order.push("first"), saved.setImmediate(() => order.push("real immediate"))), 10);
    setTimeout(() => (order.push("second"), done.resolve()), 20);
    await done.promise;
    expect(order).toEqual(["first", "real immediate", "second"]);
  });

  test("manual mode stops it, and next timer mode picks up what is pending", async () => {
    vi.useFakeTimers();
    vi.setTimerTickMode("nextTimerAsync");
    vi.setTimerTickMode("manual");
    const fired = Promise.withResolvers<void>();
    setTimeout(fired.resolve, 10);
    for (let i = 0; i < 5; i++) await oneLoopTurn();
    expect(vi.getTimerCount()).toBe(1);
    vi.setTimerTickMode("nextTimerAsync");
    await fired.promise;
  });

  test("next timer mode pauses while an Async function runs", async () => {
    vi.useFakeTimers();
    vi.setTimerTickMode("nextTimerAsync");
    const order: string[] = [];
    const last = Promise.withResolvers<void>();
    setTimeout(() => order.push("in range"), 10);
    setTimeout(() => (order.push("out of range"), last.resolve()), 1000);
    await vi.advanceTimersByTimeAsync(10);
    expect({ order: [...order], now: performance.now() }).toEqual({ order: ["in range"], now: 10 });
    await last.promise;
    expect(order).toEqual(["in range", "out of range"]);
  });

  test("the sync functions work in next timer mode", () => {
    vi.useFakeTimers();
    vi.setTimerTickMode("nextTimerAsync");
    const fired = vi.fn();
    setTimeout(fired, 10);
    vi.advanceTimersByTime(10);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  test("next timer mode runs faked ticks", async () => {
    vi.useFakeTimers({ toFake: ["nextTick"] });
    vi.setTimerTickMode("nextTimerAsync");
    await new Promise<void>(resolve => process.nextTick(resolve));
  });

  test.each([
    ["vi", ["interval", 5], 5],
    ["vi", ["interval"], 20],
    ["vi", ["interval", 0], 20],
    ["jest", [{ mode: "interval", delta: 5 }], 5],
    ["jest", [{ mode: "interval" }], 20],
  ] as const)("%s: interval mode %j", async (name, args, delta) => {
    const api = { vi, jest }[name];
    api.useFakeTimers({ now: 0 });
    // @ts-expect-error each has its own signature
    api.setTimerTickMode(...args);
    expect(await new Promise<number>(resolve => setTimeout(() => resolve(Date.now()), 7))).toBe(7);
    expect(Date.now()).toBe(delta * Math.ceil(7 / delta));
  });

  test("the mode does not outlive the fake clock", async () => {
    vi.useFakeTimers();
    vi.setTimerTickMode("nextTimerAsync");
    vi.useFakeTimers();
    setTimeout(() => {}, 10);
    for (let i = 0; i < 5; i++) await oneLoopTurn();
    expect(vi.getTimerCount()).toBe(1);
  });

  test.concurrent("an error thrown in next timer mode is an uncaught error, and the mode goes on", async () => {
    expect(
      await run([
        "-e",
        `const { vi } = Bun.jest();
         process.on("uncaughtException", error => console.log("uncaught:", error.message));
         vi.useFakeTimers();
         vi.setTimerTickMode("nextTimerAsync");
         setTimeout(() => { throw new Error("from a timer"); }, 1);
         setTimeout(() => console.log("later"), 3);`,
      ]),
    ).toEqual({ stdout: "uncaught: from a timer\nlater\n", stderr: "", exitCode: 0, signalCode: null });
  });

  test.each([
    [[], 'setTimerTickMode() expects "manual", "nextTimerAsync" or "interval"'],
    [[5], 'setTimerTickMode() expects "manual", "nextTimerAsync" or "interval"'],
    [[{}], 'setTimerTickMode() expects "manual", "nextTimerAsync" or "interval"'],
    [["auto"], 'setTimerTickMode() expects "manual", "nextTimerAsync" or "interval". Received "auto"'],
    [[{ mode: "auto" }], 'setTimerTickMode() expects "manual", "nextTimerAsync" or "interval". Received "auto"'],
    [["interval", "5"], "setTimerTickMode() interval must be a number of milliseconds"],
    [["interval", -5], "setTimerTickMode() interval is out of range. It must be >= 0 and <= 2147483647. Received -5"],
    [
      [{ mode: "interval", delta: NaN }],
      "setTimerTickMode() interval is out of range. It must be >= 0 and <= 2147483647. Received NaN",
    ],
  ])("(...%j) throws", (args, message) => {
    vi.useFakeTimers();
    // @ts-expect-error
    expect(() => vi.setTimerTickMode(...args)).toThrow(message);
  });

  test("throws unless fake timers are active", () => {
    expect(() => vi.setTimerTickMode("manual")).toThrow("Fake timers are not active");
  });
});

describe("the system time", () => {
  test("getRealSystemTime() is the real time, whatever is faked", () => {
    const before = Date.now();
    vi.useFakeTimers({ now: 0 });
    for (const api of [vi, jest]) {
      const now = api.getRealSystemTime();
      expect(Number.isInteger(now)).toBe(true);
      expect(now).toBeGreaterThanOrEqual(before);
    }
    expect(Date.now()).toBe(0);
  });

  test("getMockedSystemTime() is null unless the time is mocked", () => {
    expect(vi.getMockedSystemTime()).toBeNull();
    vi.setSystemTime(5000);
    expect(vi.getMockedSystemTime()).toEqual(new Date(5000));
    setSystemTime();
    expect(vi.getMockedSystemTime()).toBeNull();
    vi.useFakeTimers({ now: 1000 });
    expect(vi.getMockedSystemTime()).toEqual(new Date(1000));
    vi.advanceTimersByTime(500);
    expect(vi.getMockedSystemTime()).toEqual(new Date(1500));
    vi.setSystemTime(new Date(9000));
    expect(vi.getMockedSystemTime()).toEqual(new Date(9000));
    vi.useRealTimers();
    expect(vi.getMockedSystemTime()).toBeNull();
  });

  test("vi.setSystemTime() without fake timers mocks only Date, until useRealTimers()", async () => {
    const before = Date.now();
    expect(vi.setSystemTime(5000)).toBe(vi);
    expect({ now: Date.now(), fake: vi.isFakeTimers(), setTimeout: setTimeout === saved.setTimeout }).toEqual({
      now: 5000,
      fake: false,
      setTimeout: true,
    });
    await new Promise(resolve => setTimeout(resolve, 1));
    vi.useRealTimers();
    expect(Date.now()).toBeGreaterThanOrEqual(before);
  });

  test("vi.useFakeTimers() starts at the mocked time, jest.useFakeTimers() at the real time", () => {
    const before = Date.now();
    vi.setSystemTime(5000);
    vi.useFakeTimers();
    expect(Date.now()).toBe(5000);
    vi.advanceTimersByTime(10);
    vi.useFakeTimers();
    expect({ date: Date.now(), performance: performance.now() }).toEqual({ date: 5010, performance: 0 });
    jest.useFakeTimers();
    expect(Date.now()).toBeGreaterThanOrEqual(before);
  });

  describe.each([
    ["vi.setSystemTime", (now: string | number) => void vi.setSystemTime(now)],
    ["jest.setSystemTime", (now: string | number) => void jest.setSystemTime(now)],
    ["setSystemTime", (now: string | number) => void setSystemTime(now)],
  ])("%s(string)", (_, set) => {
    test.each([false, true])("parses it as new Date(string) does (fake timers: %p)", fake => {
      if (fake) vi.useFakeTimers();
      for (const string of [
        "2020-01-01T00:00:00.000Z",
        "2021-06-15",
        "December 17, 1995 03:24:00 GMT+0200",
        "1969-12-31T23:59:59.999Z",
      ]) {
        set(string);
        expect(Date.now()).toBe(new Date(string).getTime());
      }
      if (fake) {
        vi.advanceTimersByTime(1000);
        expect(Date.now()).toBe(999);
      }
    });

    test.each(["garbage", "", "2020-13-45", "+275760-09-13T00:00:00.001Z"])(
      "%j throws and leaves the time alone",
      string => {
        set(5000);
        expect(() => set(string)).toThrow(
          `setSystemTime() expects a finite number, a Date or a date string. Received ${JSON.stringify(string)}`,
        );
        expect(Date.now()).toBe(5000);
      },
    );
  });
});
