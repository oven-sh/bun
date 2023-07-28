import { test, expect } from "bun:test";
import { readFileSync } from "fs";
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

test("error gc test #3", () => {
  for (let i = 0; i < 1000; i++) {
    var err = new Error();
    Error.captureStackTrace(err);
    Bun.inspect(err);
    Bun.gc();
  }
});

// This test fails if:
// - it crashes
// - The test failure message gets a non-sensical error
test("error gc test #4", () => {
  for (let i = 0; i < 1000; i++) {
    let path =
      // Use a long-enough string for it to be obvious if we leak memory
      "/i/don/t/exist/tmp/i/don/t/exist/tmp/i/don/t/exist/tmp/i/don/t/exist/tmp/i/don/t/exist/tmp/i/don/t/exist/tmp/i/don/t/exist/tmp/ii/don/t/exist/tmp/i/don/t/exist/tmp/i/don/t/exist/tmp/i/don/t/exist/tmp/i/don/t/exist/tmp/i/don/t/exist/tmp/i/don/t/exist/tmp/ii/don/t/exist/tmp/i/don/t/exist/tmp/i/don/t/exist/tmp/i/don/t/exist/tmp/i/don/t/exist/tmp/i/don/t/exist/tmp/i/don/t/exist/tmp/i";
    try {
      readFileSync(path);
      throw new Error("unreachable");
    } catch (e) {
      if (e.message === "unreachable") {
        throw e;
      }

      const inspected = Bun.inspect(e);
      Bun.gc(true);

      // Deliberately avoid using .toContain() directly to avoid
      // BunString shenanigins.
      //
      // Only JSC builtin functions to operate on the string after inspecting it.
      //
      if (!inspected.includes(path)) {
        expect(inspected).toContain(path);
      }

      if (!inspected.includes("ENOENT")) {
        expect(inspected).toContain("ENOENT");
      }
    } finally {
      Bun.gc(true);
    }
  }
});
