import { test, expect } from "bun:test";

// This test checks that printing stack traces increments and decrements
// reference-counted strings
test("error gc test", () => {
  for (let i = 0; i < 100; i++) {
    var fn = function yo() {
      var err = (function innerOne() {
        var err = new Error();
        for (let i = 0; i < 1000; i++) {
          Bun.inspect(err);
        }
        Bun.gc(true);
        return err;
      })();
      err.stack += "";
    };

    Object.defineProperty(fn, "name", {
      value:
        "yoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyoyo" +
        i,
    });

    fn();
    Bun.gc(true);
  }
});

test("error gc test #2", () => {
  for (let i = 0; i < 1000; i++) {
    new Error().stack;
    Bun.gc();
  }
});

test("error gc test #2", () => {
  for (let i = 0; i < 1000; i++) {
    var err = new Error();
    Error.captureStackTrace(err);
    Bun.inspect(err);
    Bun.gc();
  }
});
