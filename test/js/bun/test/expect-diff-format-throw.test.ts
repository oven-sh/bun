import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The failure message of toEqual/toStrictEqual (and matcherHint) is a diff of the pretty-printed
// values. When pretty-printing one of them throws, the exception must not be left pending while
// the other value is formatted.
//
// The pretty-printer reads `$$typeof` to detect React elements, and deepEquals ignores
// non-enumerable properties, so a non-enumerable throwing `$$typeof` getter only fires while the
// failure message is being built.
test.concurrent("matcher failure message when pretty-printing a value throws", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { expect } = Bun.jest();
      function value(a) {
        const o = { a };
        Object.defineProperty(o, "$$typeof", { get() { throw new Error("getter threw"); } });
        return o;
      }
      function message(fn) {
        try { fn(); } catch (e) { return e.message; }
        return "did not throw";
      }
      let utils;
      expect.extend({ captureUtils() { utils = this.utils; return { pass: true, message: () => "" }; } });
      expect(0).captureUtils();
      console.log(JSON.stringify([
        message(() => expect(value(1)).toStrictEqual({ a: 2 })),
        message(() => expect(value(1)).toEqual({ a: 2 })),
        message(() => expect({ a: 1 }).toStrictEqual(value(2))),
        message(() => utils.matcherHint("toFoo", value(1), { a: 2 })),
      ]));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({
    stdout:
      JSON.stringify([
        "expect(received).toStrictEqual(expected)\n\n",
        "expect(received).toEqual(expected)\n\n",
        "expect(received).toStrictEqual(expected)\n\n",
        "getter threw",
      ]) + "\n",
    stderr: "",
    exitCode: 0,
  });
});

// Same bug as found by the fuzzer: the matcher fails right where the JS stack ran out, so the
// getter the pretty-printer calls while formatting `received` throws a stack overflow, and
// formatting `expected` then ran with that exception still pending.
test.concurrent("matcher failure message when pretty-printing overflows the stack", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { expect } = Bun.jest();
      const received = { get $$typeof() { return undefined; } };
      const expected = new Uint8ClampedArray();
      let ran = false;
      function recurse() {
        try { recurse(); } catch {}
        if (!ran) {
          ran = true;
          try { expect(received).toStrictEqual(expected); } catch {}
        }
      }
      recurse();
      console.log("OK");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "OK\n", stderr: "", exitCode: 0 });
});
