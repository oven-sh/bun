import { expect, it } from "bun:test";
import { isWindows } from "harness";
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

it("setInterval runs with at least the delay time", () => {
  expect([`run`, join(import.meta.dir, "setInterval-fixture.js")]).toRun();
});

it("setInterval canceling with unref, close, _idleTimeout, and _onTimeout", () => {
  expect([join(import.meta.dir, "timers-fixture-unref.js"), "setInterval"]).toRun();
});

it(
  "setInterval doesn't leak memory",
  () => {
    expect([`run`, join(import.meta.dir, "setInterval-leak-fixture.js")]).toRun();
  },
  !isWindows ? 30_000 : 90_000,
);
// ✓ setInterval doesn't leak memory [9930.00ms]
// ✓ setInterval doesn't leak memory [80188.00ms]
// TODO: investigate this discrepancy further

it("setInterval doesn't run when cancelled after being scheduled", () => {
  expect([`run`, join(import.meta.dir, "setInterval-cancel-fixture.js")]).toRun();
}, 30_000);
