import { afterEach, describe, expect, test, vi } from "bun:test";
import { bunEnv, bunExe } from "harness";

afterEach(() => {
  vi.useRealTimers();
});

function never(): Promise<never> {
  return Promise.withResolvers<never>().promise;
}

describe("vi.waitFor", () => {
  test("resolves with the callback's value when the first call succeeds", async () => {
    const callback = vi.fn(() => 42);
    expect(await vi.waitFor(callback)).toBe(42);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test("calls a throwing callback again until it returns", async () => {
    let calls = 0;
    const result = await vi.waitFor(
      () => {
        calls++;
        if (calls < 3) throw new Error(`not yet ${calls}`);
        return "done";
      },
      { interval: 5 },
    );
    expect({ result, calls }).toEqual({ result: "done", calls: 3 });
  });

  test("rejects with the last error the callback threw", async () => {
    let calls = 0;
    const error = await vi
      .waitFor(
        () => {
          calls++;
          throw new Error(`attempt ${calls}`);
        },
        { timeout: 30, interval: 5 },
      )
      .then(
        () => undefined,
        (reason: unknown) => reason,
      );
    expect(calls).toBeGreaterThan(1);
    expect(error).toEqual(new Error(`attempt ${calls}`));
  });

  test("does not call an async callback again while its promise is pending", async () => {
    vi.useFakeTimers();
    const { promise, resolve } = Promise.withResolvers<string>();
    const callback = vi.fn(() => promise);
    const waiting = vi.waitFor(callback, { interval: 1 });
    let ticks = 0;
    await vi.waitUntil(() => ++ticks >= 5, { interval: 1 });
    resolve("resolved");
    expect(await waiting).toBe("resolved");
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test("retries an async callback that rejects", async () => {
    let calls = 0;
    const result = await vi.waitFor(
      async () => {
        calls++;
        if (calls < 3) throw new Error("not yet");
        return calls;
      },
      { interval: 5 },
    );
    expect(result).toBe(3);
  });

  test("treats a thenable whose then() throws like a rejection", async () => {
    const throwingThenable: unknown = {
      then() {
        throw new Error("then threw");
      },
    };
    let calls = 0;
    const result = await vi.waitFor(
      () => {
        calls++;
        return calls === 1 ? throwingThenable : "recovered";
      },
      { interval: 5 },
    );
    expect({ result, calls }).toEqual({ result: "recovered", calls: 2 });
  });

  test("keeps a thenable's resolution when its then() throws afterwards", async () => {
    const resolvesThenThrows: unknown = {
      then(resolve: (value: string) => void) {
        resolve("resolved first");
        throw new Error("thrown after resolving");
      },
    };
    expect(await vi.waitFor(() => resolvesThenThrows)).toBe("resolved first");
  });

  test("keeps a thenable's rejection when its then() throws afterwards", async () => {
    const rejectsThenThrows: unknown = {
      then(_: unknown, reject: (reason: Error) => void) {
        reject(new Error("rejected first"));
        throw new Error("thrown after rejecting");
      },
    };
    await expect(vi.waitFor(() => rejectsThenThrows, { timeout: 0 })).rejects.toThrow("rejected first");
  });

  test("rejects with a timeout error when an async callback never settles", async () => {
    await expect(vi.waitFor(never, { timeout: 20, interval: 5 })).rejects.toThrow("Timed out in waitFor!");
  });

  test("ignores a pending callback that settles after the timeout", async () => {
    for (const wait of [vi.waitFor, vi.waitUntil]) {
      const late = Promise.withResolvers<string>();
      await expect(wait(() => late.promise, { timeout: 5, interval: 1 })).rejects.toThrow(/^Timed out in wait/);
      late.resolve("too late");
      await late.promise;

      const lateFailure = Promise.withResolvers<string>();
      await expect(wait(() => lateFailure.promise, { timeout: 5, interval: 1 })).rejects.toThrow(/^Timed out in wait/);
      lateFailure.reject(new Error("too late"));
      await lateFailure.promise.catch(() => {});
    }
  });

  test("accepts a number as the timeout", async () => {
    await expect(vi.waitFor(never, 20)).rejects.toThrow("Timed out in waitFor!");
  });

  test("does not retry after the timeout", async () => {
    for (const options of [
      { timeout: 0, interval: 5 },
      { timeout: 5, interval: 100 },
    ]) {
      let calls = 0;
      const outcome = await vi
        .waitFor(() => {
          calls++;
          if (calls === 1) throw new Error("first call fails");
          return "late";
        }, options)
        .then(
          value => value,
          (error: Error) => error.message,
        );
      expect({ options, outcome, calls }).toEqual({ options, outcome: "first call fails", calls: 1 });
    }
  });

  test("works when called without its vi receiver", async () => {
    const { waitFor } = vi;
    expect(await waitFor(() => "unbound")).toBe("unbound");
  });

  test("advances fake timers by the interval before each check", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    let isReady = false;
    setTimeout(() => {
      isReady = true;
    }, 200);
    await vi.waitFor(
      () => {
        if (!isReady) throw new Error("not ready");
      },
      { interval: 50 },
    );
    expect(Date.now() - start).toBe(200);
  });

  test("measures the timeout on the fake clock under fake timers", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    await expect(
      vi.waitFor(
        () => {
          throw new Error("never ready");
        },
        { timeout: 100, interval: 20 },
      ),
    ).rejects.toThrow("never ready");
    expect(Date.now() - start).toBe(100);
  });

  test("counts fake time the callback advances toward the timeout", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    let calls = 0;
    await expect(
      vi.waitFor(
        () => {
          calls++;
          vi.advanceTimersByTime(100);
          throw new Error("still waiting");
        },
        { timeout: 20, interval: 5 },
      ),
    ).rejects.toThrow("still waiting");
    expect({ calls, elapsed: Date.now() - start }).toEqual({ calls: 1, elapsed: 105 });
  });

  test("stops advancing fake timers once it has resolved", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    expect(await vi.waitFor(async () => 42)).toBe(42);
    for (let i = 0; i < 3; i++) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setImmediate(resolve);
      await promise;
    }
    expect(Date.now() - start).toBe(50);
  });

  test("lets the process exit once it has resolved", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import { vi } from "bun:test"; console.log(await vi.waitFor(async () => 42, { timeout: 60_000, interval: 60_000 }));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "42\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test("keeps checking on the real clock when fake timers are turned off during the wait", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const result = await vi.waitFor(
      () => {
        calls++;
        if (calls === 2) vi.useRealTimers();
        if (calls < 4) throw new Error("not yet");
        return vi.isFakeTimers();
      },
      { interval: 5 },
    );
    expect({ result, calls }).toEqual({ result: false, calls: 4 });
  });

  test("still times out when the callback restarts fake timers", async () => {
    vi.useFakeTimers();
    let calls = 0;
    await expect(
      vi.waitUntil(
        () => {
          calls++;
          vi.useFakeTimers();
          return false;
        },
        { timeout: 20, interval: 5 },
      ),
    ).rejects.toThrow("Timed out in waitUntil!");
    expect(calls).toBe(4);
  });

  test("still times out with a zero interval under fake timers", async () => {
    vi.useFakeTimers();
    await expect(vi.waitUntil(() => false, { timeout: 20, interval: 0 })).rejects.toThrow("Timed out in waitUntil!");
    await expect(
      vi.waitUntil(
        () => {
          vi.useFakeTimers();
          return false;
        },
        { timeout: 20, interval: 0 },
      ),
    ).rejects.toThrow("Timed out in waitUntil!");
  });

  test("does not check past the timeout with a zero interval under fake timers", async () => {
    vi.useFakeTimers();
    let isReady = false;
    setTimeout(() => {
      isReady = true;
    }, 21);
    await expect(vi.waitUntil(() => isReady, { timeout: 20, interval: 0 })).rejects.toThrow("Timed out in waitUntil!");
  });

  test("measures the timeout on the fake clock when fake timers come on between checks", async () => {
    const waiting = vi
      .waitUntil(() => false, { timeout: 45, interval: 10 })
      .then(
        () => "resolved",
        (error: Error) => error.message,
      );
    vi.useFakeTimers();
    const start = Date.now();
    // Block real time past the timeout: only fake time may end the wait now.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60);
    expect({ outcome: await waiting, fakeElapsed: Date.now() - start }).toEqual({
      outcome: "Timed out in waitUntil!",
      fakeElapsed: 40,
    });
  });

  test("switches its deadline to the fake clock when fake timers are turned on during the wait", async () => {
    let calls = 0;
    const start = { fake: 0 };
    const outcome = await vi
      .waitUntil(
        () => {
          calls++;
          if (calls === 1) {
            vi.useFakeTimers();
            start.fake = Date.now();
            // Block real time past the timeout: only fake time may end the wait now.
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60);
          }
          return false;
        },
        { timeout: 45, interval: 10 },
      )
      .then(
        () => "resolved",
        (error: Error) => error.message,
      );
    expect({ outcome, fakeElapsed: Date.now() - start.fake }).toEqual({
      outcome: "Timed out in waitUntil!",
      fakeElapsed: 40,
    });
  });

  test("ignores an expired real deadline once a later check turns fake timers on", async () => {
    let calls = 0;
    let fakeStart = 0;
    const result = await vi.waitUntil(
      () => {
        calls++;
        if (calls === 2) {
          vi.useFakeTimers();
          fakeStart = Date.now();
          // Block real time past the timeout, so the real deadline has expired before the next check.
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60);
        }
        return vi.isFakeTimers() && Date.now() - fakeStart >= 20;
      },
      { timeout: 45, interval: 5 },
    );
    expect(result).toBe(true);
  });

  test("validates its arguments", () => {
    expect(() => vi.waitFor("nope" as never)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE", name: "TypeError" }),
    );
    expect(() => vi.waitFor(() => 1, -1)).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }));
    expect(() => vi.waitFor(() => 1, { interval: -1 })).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }));
    expect(() => vi.waitFor(() => 1, "1" as never)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
  });
});

describe("vi.waitUntil", () => {
  test("resolves with the first truthy value", async () => {
    let calls = 0;
    const result = await vi.waitUntil(() => (++calls >= 3 ? { calls } : false), { interval: 5 });
    expect(result).toEqual({ calls: 3 });
  });

  test("resolves with the first truthy value of an async callback", async () => {
    let calls = 0;
    const result = await vi.waitUntil(async () => ++calls >= 2 && "ok", { interval: 5 });
    expect({ result, calls }).toEqual({ result: "ok", calls: 2 });
  });

  test("rejects as soon as the callback throws", async () => {
    const callback = vi.fn(() => {
      throw new Error("broken");
    });
    await expect(vi.waitUntil(callback, { interval: 5 })).rejects.toThrow("broken");
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test("rejects as soon as an async callback rejects", async () => {
    const callback = vi.fn(async () => {
      throw new Error("broken async");
    });
    await expect(vi.waitUntil(callback, { interval: 5 })).rejects.toThrow("broken async");
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test("rejects when reading then() from the result throws", async () => {
    const result = {
      get then() {
        throw new Error("then getter threw");
      },
    };
    await expect(vi.waitUntil(() => result)).rejects.toThrow("then getter threw");
  });

  test("reads then() from a Proxy without asking its has() trap", async () => {
    const falsyThenable = new Proxy(
      {},
      {
        has: () => false,
        get: (_, key) => (key === "then" ? (resolve: (value: number) => void) => resolve(0) : undefined),
      },
    );
    await expect(vi.waitUntil(() => falsyThenable, { timeout: 20, interval: 5 })).rejects.toThrow(
      "Timed out in waitUntil!",
    );
  });

  test("rejects with a timeout error when the value stays falsy", async () => {
    await expect(vi.waitUntil(() => 0, { timeout: 20, interval: 5 })).rejects.toThrow("Timed out in waitUntil!");
  });

  test("advances fake timers until the value is truthy", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    let isReady = false;
    setTimeout(() => {
      isReady = true;
    }, 120);
    expect(await vi.waitUntil(() => isReady, { interval: 40 })).toBe(true);
    expect(Date.now() - start).toBe(120);
  });

  test("advances fake timers before the first check", async () => {
    vi.useFakeTimers();
    let isReady = false;
    setTimeout(() => {
      isReady = true;
    }, 5);
    const result = await vi.waitUntil(
      () => {
        if (!isReady) throw new Error("not ready");
        return isReady;
      },
      { interval: 5 },
    );
    expect(result).toBe(true);
  });
});
