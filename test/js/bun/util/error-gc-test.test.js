import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";
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

// Appending an error's stack trace to itself made Vector::appendVector read
// from its own freed buffer once the append grew past the vector's capacity.
// Malloc=1 routes WTF allocations through the system allocator so ASan builds
// can see the use-after-free.
test("Error.appendStackTrace with the same error as source and destination", async () => {
  const code = `
    function f(n) {
      if (n > 0) return f(n - 1) + 1;
      try {
        null();
      } catch (e) {
        Error.appendStackTrace(e, e);
      }
      return 0;
    }
    f(64);
    console.log("ok");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: { ...bunEnv, Malloc: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});

test("Error.appendStackTrace moves the source stack trace into the destination", () => {
  function inner() {
    try {
      null();
    } catch (e) {
      return e;
    }
  }
  const src = inner();
  const dst = new Error("dst");
  Error.appendStackTrace(src, dst);
  expect(dst.stack).toContain("inner");
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

  for (let i = 0; i < 1000; i++) {
    iterate();
  }
});
