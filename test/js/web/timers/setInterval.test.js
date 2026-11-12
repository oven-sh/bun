import { expect, it, jest } from "bun:test";
import { bunEnv, bunExe, bunRun, isASAN, isWindows } from "harness";
import { join } from "path";

it("setInterval", async () => {
  var counter = 0;
  var start;
  const result = await new Promise((resolve, reject) => {
    start = performance.now();

    var id = setInterval(
      (...args) => {
        counter++;
        if (counter === 10) {
          resolve(counter);
          clearInterval(id);
        }
        try {
          expect(args).toStrictEqual(["foo"]);
        } catch (err) {
          reject(err);
          clearInterval(id);
        }
      },
      1,
      "foo",
    );
  });

  expect(result).toBe(10);
  expect(performance.now() - start > 9).toBe(true);
});

it("clearInterval", async () => {
  var called = false;
  const id = setInterval(() => {
    called = true;
    expect.unreachable();
  }, 1);
  clearInterval(id);
  await new Promise((resolve, reject) => {
    setInterval(() => {
      resolve();
    }, 10);
  });
  expect(called).toBe(false);
});

it("async setInterval", async () => {
  var remaining = 5;
  await new Promise((resolve, reject) => {
    queueMicrotask(() => {
      var id = setInterval(async () => {
        await 1;
        remaining--;
        if (remaining === 0) {
          clearInterval(id);
          resolve();
        }
      }, 1);
    });
  });
});

it("refreshed setInterval should not reschedule again", async () => {
  let relative = performance.now();
  let runCount = 0;
  let timer = setInterval(() => {
    let end = performance.now();

    // loop for 100
    const spinloop = end;
    while (performance.now() - spinloop < 100) {
      end = performance.now();
    }

    timer.refresh();

    const elapsed = Math.round(end - relative);
    console.log("Time since last run", elapsed);

    runCount++;

    switch (runCount) {
      case 1: {
        if (elapsed < 180) {
          throw new Error("Expected elapsed time to be greater than 180");
        }
        break;
      }
      case 3:
      case 2: {
        if (elapsed > 180) {
          throw new Error("Expected elapsed time to be less than 180");
        }
        break;
      }
    }

    relative = end;

    if (runCount === 3) {
      clearInterval(timer);
    }
  }, 100);
});

it.concurrent("setInterval runs with at least the delay time", async () => {
  expect(await bunRun([`run`, join(import.meta.dir, "setInterval-fixture.js")])).toSpawn();
});

it.concurrent("setInterval canceling with unref, close, _idleTimeout, and _onTimeout", async () => {
  expect(await bunRun([join(import.meta.dir, "timers-fixture-unref.js"), "setInterval"])).toSpawn();
});

it.concurrent(
  "setInterval doesn't leak memory",
  async () => {
    const { stdout, stderr, exitCode } = await bunRun([`run`, join(import.meta.dir, "setInterval-leak-fixture.js")]);
    if (exitCode !== 0) console.error(stderr || stdout);
    expect(exitCode).toBe(0);
  },
  // A build with AddressSanitizer takes WTF's and JavaScriptCore's memory from the sanitizer's allocator: the fixture takes a fifth longer and stood at 29 to 30 s.
  isWindows ? 90_000 : isASAN ? 60_000 : 30_000,
);
// ✓ setInterval doesn't leak memory [9930.00ms]
// ✓ setInterval doesn't leak memory [80188.00ms]
// TODO: investigate this discrepancy further

it.concurrent(
  "setInterval doesn't run when cancelled after being scheduled",
  async () => {
    expect(await bunRun([`run`, join(import.meta.dir, "setInterval-cancel-fixture.js")])).toSpawn();
  },
  30_000,
);

it.concurrent("a timer that ends itself through _repeat or _idleTimeout does not keep its object", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { heapStats } = require("bun:jsc");
        const count = 50;
        const cases = {
          "interval, _repeat = null"(done) {
            const timer = setInterval(() => {
              timer._repeat = null;
              done();
            }, 1);
          },
          "interval, _idleTimeout = -1"(done) {
            const timer = setInterval(() => {
              timer._idleTimeout = -1;
              done();
            }, 1);
          },
          "interval, _repeat = null before refresh()"(done) {
            const timer = setInterval(() => {
              timer._repeat = null;
              timer.refresh();
              done();
            }, 1);
          },
          "interval, refresh() before _repeat = null"(done) {
            let calls = 0;
            const timer = setInterval(() => {
              if (++calls === 2) return done();
              timer.refresh();
              timer._repeat = null;
            }, 1);
          },
          "timeout, refresh() with _idleTimeout = -1 in the callback"(done) {
            const timer = setTimeout(() => {
              timer._idleTimeout = -1;
              timer.refresh();
              done();
            }, 1);
          },
          "timeout, refresh() with _idleTimeout = -1 after the callback"(done) {
            const timer = setTimeout(() => {
              setImmediate(() => {
                timer._idleTimeout = -1;
                timer.refresh();
                done();
              });
            }, 1);
          },
          "timeout, _repeat = -1"(done) {
            const timer = setTimeout(() => {
              timer._repeat = -1;
              done();
            }, 1);
          },
        };
        const rooted = () => heapStats().protectedObjectTypeCounts.Timeout ?? 0;
        const keepAlive = new MessageChannel();
        keepAlive.port1.onmessage = () => {};
        const result = {};
        for (const [name, start] of Object.entries(cases)) {
          await Promise.all(Array.from({ length: count }, () => new Promise(done => start(done))));
          await new Promise(setImmediate);
          result[name] = rooted();
        }
        keepAlive.port1.close();
        // The probe sees a timer that will fire.
        const pending = setTimeout(() => {}, 100_000);
        result.pending = rooted();
        clearTimeout(pending);
        console.log(JSON.stringify(result));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ rooted: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
    rooted: {
      "interval, _repeat = null": 0,
      "interval, _idleTimeout = -1": 0,
      "interval, _repeat = null before refresh()": 0,
      "interval, refresh() before _repeat = null": 0,
      "timeout, refresh() with _idleTimeout = -1 in the callback": 0,
      "timeout, refresh() with _idleTimeout = -1 after the callback": 0,
      "timeout, _repeat = -1": 0,
      pending: 1,
    },
    stderr: "",
    exitCode: 0,
  });
});

// The innermost run of the callback ends the interval, which makes its object weak, and the outermost one goes on with it.
it.each([1, 2])(
  "an interval that the innermost of %i nested run(s) ended and the outermost goes on with keeps firing",
  depth => {
    jest.useFakeTimers();
    try {
      let calls = 0;
      (function start() {
        let timer = setInterval(() => {
          calls++;
          if (calls === depth + 1) timer._repeat = null;
          if (calls > depth) return;
          const outermost = calls === 1;
          timer.refresh();
          jest.advanceTimersByTime(10);
          timer._repeat = 10;
          if (outermost) timer = null;
        }, 10);
      })();
      jest.advanceTimersByTime(10);
      Bun.gc(true);
      const before = calls;
      jest.advanceTimersByTime(200);
      expect(calls - before).toBeGreaterThanOrEqual(10);
    } finally {
      jest.useRealTimers();
    }
  },
);
