import jsc from "bun:jsc";
import { describe, expect, it, mock, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isWindows } from "harness";
import path from "node:path";
import { clearInterval, clearTimeout, promises, setImmediate, setInterval, setTimeout } from "node:timers";
import { promisify } from "util";

for (const fn of [setTimeout, setInterval]) {
  describe(fn.name, () => {
    test("unref is possible", done => {
      const timer = fn(() => {
        done(new Error("should not be called"));
      }, 1).unref();
      const other = fn(() => {
        clearInterval(other);
        done();
      }, 2);
      if (fn === setTimeout) clearTimeout(timer);
      if (fn === setInterval) clearInterval(timer);
    });
  });
}

it("node.js util.promisify(setTimeout) works", async () => {
  const setTimeout = promisify(globalThis.setTimeout);
  await setTimeout(1);

  expect(async () => {
    await setTimeout(1).then(a => {
      throw new Error("TestPassed");
    });
  }).toThrow("TestPassed");
});

it("node.js util.promisify(setInterval) works", async () => {
  const setInterval = promisify(globalThis.setInterval);
  var runCount = 0;
  const start = performance.now();
  for await (const run of setInterval(1)) {
    if (runCount++ === 9) break;
  }
  const end = performance.now();

  expect(runCount).toBe(10);
  expect(end - start).toBeGreaterThan(9);
});

it("timers expose util.promisify.custom as a lazy accessor without loading node:util first", async () => {
  // Matches Node's lib/timers.js: an enumerable, non-configurable getter that resolves to timers/promises.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const sym = Symbol.for("nodejs.util.promisify.custom");
       const shape = fn => { const d = Object.getOwnPropertyDescriptor(fn, sym); return d && { get: typeof d.get, set: typeof d.set, enumerable: d.enumerable, configurable: d.configurable }; };
       const before = [setTimeout, setInterval, setImmediate].map(shape);
       const tp = require("node:timers/promises");
       const same = [setTimeout[sym] === tp.setTimeout, setInterval[sym] === tp.setInterval, setImmediate[sym] === tp.setImmediate];
       console.log(JSON.stringify({ before, same }));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const accessor = { get: "function", set: "undefined", enumerable: true, configurable: false };
  expect(JSON.parse(stdout)).toEqual({ before: [accessor, accessor, accessor], same: [true, true, true] });
  expect(exitCode).toBe(0);
});

it("node.js util.promisify(setImmediate) works", async () => {
  const setImmediate = promisify(globalThis.setImmediate);
  await setImmediate();

  expect(async () => {
    await setImmediate().then(a => {
      throw new Error("TestPassed");
    });
  }).toThrow("TestPassed");
});

it("timers.promises === timers/promises", async () => {
  const ns = await import("node:timers/promises");
  expect(ns.default).toBe(promises);
});

type TimerWithDestroyed = Timer & { _destroyed: boolean };

describe("_destroyed", () => {
  it("is false by default", () => {
    const timers = [
      setTimeout(() => {}, 0),
      setInterval(() => {}, 0),
      setImmediate(() => {}),
    ] as Array<TimerWithDestroyed>;
    for (const t of timers) {
      expect(t._destroyed).toBeFalse();
    }
    clearTimeout(timers[0]);
    clearInterval(timers[1]);
    clearImmediate(timers[2]);
  });

  it("is false during the callback", async () => {
    for (const fn of [setTimeout, setInterval, setImmediate]) {
      const { promise: done, resolve } = Promise.withResolvers();
      const timer = fn(() => {
        try {
          expect(timer._destroyed).toBeFalse();
        } finally {
          resolve();
          // make sure we don't make an interval that runs forever
          clearInterval(timer);
        }
      }, 1) as TimerWithDestroyed;
      await done;
    }
  });

  it("is true after clearing", () => {
    const timeout = setTimeout(() => {}, 0) as TimerWithDestroyed;
    clearTimeout(timeout);
    expect(timeout._destroyed).toBeTrue();

    const interval = setInterval(() => {}, 0) as TimerWithDestroyed;
    clearInterval(interval);
    expect(interval._destroyed).toBeTrue();

    const immediate = setImmediate(() => {}) as TimerWithDestroyed;
    clearImmediate(immediate);
    expect(immediate._destroyed).toBeTrue();
  });

  it("is true after clearing during the callback", async () => {
    for (const [setFn, clearFn] of [
      [setTimeout, clearTimeout],
      [setInterval, clearInterval],
      [setImmediate, clearImmediate],
    ] as unknown as Array<
      [(cb: () => void, time: number) => TimerWithDestroyed, (timer: TimerWithDestroyed) => void]
    >) {
      const { promise: done, resolve } = Promise.withResolvers();
      const timer = setFn(() => {
        try {
          clearFn(timer);
          expect(timer._destroyed).toBeTrue();
        } finally {
          resolve();
        }
      }, 1);
      await done;
    }
  });

  it("is true after firing", async () => {
    let calls = 0;
    const timeout = setTimeout(() => calls++, 0) as TimerWithDestroyed;
    const immediate = setImmediate(() => calls++) as TimerWithDestroyed;
    while (calls < 2) await Bun.sleep(1);
    expect(timeout._destroyed).toBeTrue();
    expect(immediate._destroyed).toBeTrue();
  });

  it("is false when timer refreshes", async () => {
    let refreshed = false;
    const { promise: done, resolve } = Promise.withResolvers();
    const timeout = setTimeout(() => {
      if (!refreshed) {
        refreshed = true;
        timeout.refresh();
        setImmediate(() => expect(timeout._destroyed).toBeFalse());
      } else {
        resolve();
      }
    }, 2) as TimerWithDestroyed;
    await done;
    expect(timeout._destroyed).toBeTrue();
  });
});

describe("clear", () => {
  it("can clear the other kind of timer", async () => {
    const timeout1 = setTimeout(() => {
      throw new Error("timeout not cleared");
    }, 1);
    const interval1 = setInterval(() => {
      throw new Error("interval not cleared");
    }, 1);
    clearInterval(timeout1);
    clearTimeout(interval1);
  });

  it("interval/timeout do not affect immediates", async () => {
    const mockedCb = mock();
    const immediate = setImmediate(mockedCb);
    clearTimeout(immediate);
    clearInterval(immediate);

    await Bun.sleep(1);
    expect(mockedCb).toHaveBeenCalledTimes(1);
  });

  it("accepts a string", async () => {
    const timeout = setTimeout(() => {
      throw new Error("timeout not cleared");
    }, 1);
    clearTimeout((+timeout).toString());
  });

  it("rejects malformed strings", async () => {
    const mockedCb = mock();
    const timeout = setTimeout(mockedCb, 1);
    const stringId = (+timeout).toString();

    for (const badString of [" " + stringId, stringId + " ", "0" + stringId, "+" + stringId]) {
      clearTimeout(badString);
    }

    // make sure we can't cause integer overflow
    clearTimeout((2 ** 64).toString());

    // none of the above strings should cause the timeout to be cleared
    await Bun.sleep(2);
    expect(mockedCb).toHaveBeenCalled();
  });

  it("accepts UTF-16 strings", async () => {
    const timeout = setTimeout(() => {
      throw new Error("timeout not cleared");
    }, 1);
    const stringId = (+timeout).toString();
    // make a version of stringId that has the same text content, but is encoded as UTF-16
    // instead of Latin-1
    const codeUnits = new DataView(new ArrayBuffer(2 * stringId.length));
    for (let i = 0; i < stringId.length; i++) {
      codeUnits.setUint16(2 * i, stringId.charCodeAt(i), true);
    }
    const decoder = new TextDecoder("utf-16le");
    const stringIdUtf16 = decoder.decode(codeUnits);
    // make sure we succeeded in making a UTF-16 string
    expect(jsc.jscDescribe(stringIdUtf16)).toContain("8Bit:(0)");
    clearTimeout(stringIdUtf16);
  });
});

describe("_idleTimeout", () => {
  const idleTimeoutOf = (timer: object) => (timer as { _idleTimeout: number })._idleTimeout;

  // node's unenroll() sets _idleTimeout to -1 on every explicit cancel path.
  it.each([
    ["clearTimeout", (t: NodeJS.Timeout) => void clearTimeout(t)],
    ["clearInterval", (t: NodeJS.Timeout) => void clearInterval(t)],
    ["close()", (t: NodeJS.Timeout) => void t.close()],
    ["Symbol.dispose", (t: NodeJS.Timeout) => t[Symbol.dispose]()],
  ])("%s sets it to -1", (_, cancel) => {
    const timeout = setTimeout(() => {
      throw new Error("timeout not cleared");
    }, 1000);
    expect(idleTimeoutOf(timeout)).toBe(1000);
    cancel(timeout);
    expect(idleTimeoutOf(timeout)).toBe(-1);
  });

  it("a timer that fired keeps its duration", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const timeout = setTimeout(resolve, 1);
    await promise;
    expect(idleTimeoutOf(timeout)).toBe(1);
  });

  it("an immediate has none, and disposing it does not add one", () => {
    const immediate = setImmediate(() => {
      throw new Error("immediate not cleared");
    });
    immediate[Symbol.dispose]();
    expect("_idleTimeout" in immediate).toBe(false);
  });
});

describe("_idleStart", () => {
  // https://github.com/oven-sh/bun/issues/26508
  // Next.js 16 Cache Components writes `t2._idleStart = t1._idleStart` so two
  // `setTimeout(fn)` calls share a deadline and both fire before any
  // `setImmediate` scheduled from `t1`'s callback.
  it("reschedules the timer when written (Next.js pattern)", async () => {
    const script = `
      async function once() {
        let immediateRan = false;
        let order = [];
        const t1 = setTimeout(() => {
          order.push("t1");
          setImmediate(() => { immediateRan = true; });
        });
        // Force the monotonic clock past a millisecond boundary so t2 would
        // land in a later event-loop turn without the _idleStart assignment.
        { const s = performance.now(); while (performance.now() - s < 2) {} }
        const { promise, resolve } = Promise.withResolvers();
        const t2 = setTimeout(() => {
          order.push("t2");
          resolve({ immediateRan, order: order.join(",") });
        });
        t2._idleStart = t1._idleStart;
        return promise;
      }
      for (let i = 0; i < 50; i++) {
        const { immediateRan, order } = await once();
        if (immediateRan) {
          console.log("FAIL: immediate ran before t2 on iteration " + i);
          process.exit(1);
        }
        if (order !== "t1,t2") {
          console.log("FAIL: wrong order " + order + " on iteration " + i);
          process.exit(1);
        }
      }
      console.log("ok");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });

  it("ignores non-finite values and cleared timers", async () => {
    const t1 = setTimeout(() => {}, 10) as any;
    t1._idleStart = "not a number";
    expect(t1._idleStart).toBe("not a number");
    t1._idleStart = NaN;
    expect(Number.isNaN(t1._idleStart)).toBeTrue();
    t1._idleStart = Infinity;
    expect(t1._idleStart).toBe(Infinity);
    clearTimeout(t1);
    t1._idleStart = 0;
    expect(t1._idleStart).toBe(0);
  });

  it("does not overflow for extreme finite values", () => {
    const t1 = setTimeout(() => {}, 10) as any;
    t1._idleStart = Number.MAX_VALUE;
    expect(t1._idleStart).toBe(Number.MAX_VALUE);
    t1._idleStart = -Number.MAX_VALUE;
    expect(t1._idleStart).toBe(-Number.MAX_VALUE);
    clearTimeout(t1);
  });
});

describe.each(["with", "without"])("setImmediate %s timers running", mode => {
  // TODO(@190n) #17901 did not fix this for Windows
  it.todoIf(isWindows && mode == "with")(
    "has reasonable performance when nested",
    async () => {
      const process = Bun.spawn({
        cmd: [bunExe(), path.join(__dirname, "setImmediate-fixture.ts"), mode + "-interval"],
        stdout: "pipe",
        env: bunEnv,
      });

      await process.exited;
      const out = await process.stdout.text();
      expect(process.exitCode).toBe(0);
      // if this fails, there will be a nicer error than printing out the entire string
      expect((out.match(/\n/g) ?? []).length).toBe(5000);
      expect(out).toBe("callback\n".repeat(5000));
    },
    5000,
  );
});

it("should defer microtasks when an exception is thrown in an immediate", async () => {
  expect(await bunRun(["run", path.join(import.meta.dir, "timers-immediate-exception-fixture.js")])).toSpawn();
});
