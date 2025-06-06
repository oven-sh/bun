import jsc from "bun:jsc";
import { describe, expect, it, mock, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
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
    // TODO: this may become wrong once https://github.com/nodejs/node/pull/57069 is merged
    const timeout2 = setTimeout(() => {
      throw new Error("timeout not cleared");
    }, 1);
    const interval2 = setInterval(() => {
      throw new Error("interval not cleared");
    }, 1);
    clearInterval(timeout1);
    clearTimeout(interval1);
    clearImmediate(timeout2);
    clearImmediate(interval2);
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
      const out = await new Response(process.stdout).text();
      expect(process.exitCode).toBe(0);
      // if this fails, there will be a nicer error than printing out the entire string
      expect((out.match(/\n/g) ?? []).length).toBe(5000);
      expect(out).toBe("callback\n".repeat(5000));
    },
    5000,
  );
});

it("should defer microtasks when an exception is thrown in an immediate", async () => {
  expect(["run", path.join(import.meta.dir, "timers-immediate-exception-fixture.js")]).toRun();
});
