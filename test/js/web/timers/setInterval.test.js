import { it, expect } from "bun:test";
import { join } from "path";
import "harness";
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
  expect(performance.now() - start >= 10).toBe(true);
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

it("setInterval if refreshed before run, should reschedule to run later", done => {
  let start = Date.now();
  let timer = setInterval(() => {
    let end = Date.now();
    clearInterval(timer);
    expect(end - start).toBeGreaterThanOrEqual(150);
    done();
  }, 100);

  setTimeout(() => {
    timer.refresh();
  }, 50);
});

it("setInterval runs with at least the delay time", () => {
  expect([`run`, join(import.meta.dir, "setInterval-fixture.js")]).toRun();
});

it("setInterval doesn't leak memory", () => {
  expect([`run`, join(import.meta.dir, "setInterval-leak-fixture.js")]).toRun();
}, 30_000);

it("setInterval doesn't run when cancelled after being scheduled", () => {
  expect([`run`, join(import.meta.dir, "setInterval-cancel-fixture.js")]).toRun();
}, 30_000);
