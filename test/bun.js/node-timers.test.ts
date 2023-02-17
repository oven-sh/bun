import { describe, test } from "bun:test";
import { setTimeout, clearTimeout, setInterval, setImmediate } from "node:timers";

for (const fn of [setTimeout, setInterval, setImmediate]) {
  describe(fn.name, () => {
    test("unref is possible", done => {
      const timer = fn(() => {
        done(new Error("should not be called"));
      }, 1);
      fn(() => {
        done();
      }, 2);
      timer.unref();
      if (fn !== setImmediate) clearTimeout(timer);
    });
  });
}
