import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { isDebug, tmpdirSync } from "harness";
import { join } from "path";

// This test checks that printing stack traces increments and decrements
// reference-counted strings
//
// Debug builds run Bun.inspect(err) ~30x and Bun.gc(true) ~20x slower than release, which puts every
// test below past the default 5s timeout at the release counts. They also assert the first time a
// string's refcount goes wrong (WTFStringImplStruct::ref/deref in bun_alloc), so they don't need the
// repetition release builds rely on to turn an unbalanced ref into a visible failure.
test("error gc test", () => {
  const errors = isDebug ? 5 : 100;
  const inspectsPerError = isDebug ? 100 : 1000;
  for (let i = 0; i < errors; i++) {
    var fn = function yo() {
      var err = (function innerOne() {
        var err = new Error();
        for (let i = 0; i < inspectsPerError; i++) {
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
  const iterations = isDebug ? 100 : 1000;
  for (let i = 0; i < iterations; i++) {
    new Error().stack;
    Bun.gc();
  }
});

test("error gc test #3", () => {
  const iterations = isDebug ? 100 : 1000;
  for (let i = 0; i < iterations; i++) {
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
  const tmp = tmpdirSync();
  const base = Buffer.from(join(tmp, "does", "not", "exist").repeat(10));

  function iterate() {
    // Use a long-enough string for it to be obvious if we leak memory
    // Use .toString() on the Buffer to ensure we clone the string every time.
    let path = base.toString();
    try {
      readFileSync(path);
      throw new Error("unreachable");
    } catch (e) {
      if (e.message === "unreachable") {
        throw e;
      }

      path = path.replaceAll("\\", "/");
      if (e.path) {
        e.path = e.path.replaceAll("\\", "/");
      }

      let inspected = Bun.inspect(e);
      Bun.gc(true);
      inspected = inspected.replaceAll("\\", "/");

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

  const iterations = isDebug ? 10 : 1000;
  for (let i = 0; i < iterations; i++) {
    iterate();
  }
});
