import { describe, expect, it, test } from "bun:test";
import { clearInterval, clearTimeout, promises, setInterval, setTimeout } from "node:timers";
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
