import { describe, expect, test } from "bun:test";
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

// https://github.com/oven-sh/bun/issues/34398
// A GC between an async throw and the first .stack access used to cache the
// stack string from the GC finalizer without the error's name and message.
describe("error.stack after GC keeps name and message", () => {
  const cases = [
    {
      label: "async-thrown Error, GC before first .stack access",
      script: `
        async function boom() { throw new Error("the message"); }
        try { await boom(); } catch (e) {
          Bun.gc(true);
          console.log(JSON.stringify({ message: e.message, stackHead: e.stack.split("\\n")[0] }));
        }`,
      expected: { message: "the message", stackHead: "Error: the message" },
    },
    {
      label: "async-thrown TypeError, name comes from the prototype",
      script: `
        async function boom() { throw new TypeError("boom"); }
        try { await boom(); } catch (e) {
          Bun.gc(true);
          console.log(JSON.stringify({ message: e.message, stackHead: e.stack.split("\\n")[0] }));
        }`,
      expected: { message: "boom", stackHead: "TypeError: boom" },
    },
    {
      label: "async-thrown subclass with an own name property",
      script: `
        class MyError extends Error { name = "MyError"; }
        async function boom() { throw new MyError("custom"); }
        try { await boom(); } catch (e) {
          Bun.gc(true);
          console.log(JSON.stringify({ message: e.message, stackHead: e.stack.split("\\n")[0] }));
        }`,
      expected: { message: "custom", stackHead: "MyError: custom" },
    },
    {
      label: "sync-thrown Error stays correct",
      script: `
        function boomSync() { throw new Error("sync message"); }
        try { boomSync(); } catch (e) {
          Bun.gc(true);
          console.log(JSON.stringify({ message: e.message, stackHead: e.stack.split("\\n")[0] }));
        }`,
      expected: { message: "sync message", stackHead: "Error: sync message" },
    },
    {
      label: ".stack primed before GC stays correct",
      script: `
        async function boom() { throw new Error("primed message"); }
        try { await boom(); } catch (e) {
          const before = e.stack.split("\\n")[0];
          Bun.gc(true);
          console.log(JSON.stringify({ before, after: e.stack.split("\\n")[0] }));
        }`,
      expected: { before: "Error: primed message", after: "Error: primed message" },
    },
  ];

  for (const { label, script, expected } of cases) {
    test.concurrent(label, async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      if (exitCode !== 0) {
        throw new Error(`exited with ${exitCode}: ${stderr}`);
      }
      expect(JSON.parse(stdout)).toEqual(expected);
    });
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
