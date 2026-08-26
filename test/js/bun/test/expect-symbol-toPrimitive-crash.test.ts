import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("expect does not crash when value has Symbol.toPrimitive returning a Symbol", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const obj = /foo/;
      obj[Symbol.toPrimitive] = Symbol;
      try { Bun.jest().expect(obj).toBeFalse(); } catch {}
    `,
    ],
    env: bunEnv,
  });

  const exitCode = await proc.exited;

  expect(exitCode).toBe(0);
});

// The diff printed by a failed toEqual/toStrictEqual formats both values. When
// the first one throws, the second must not be formatted with that exception
// still pending. The matcher throws its own error with the partial message.
// matcherHint returns a string to user code, so it surfaces the exception.
test("expect does not crash when value.toString() returns a Symbol while printing a diff", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import { expect } from "bun:test";
        const re = /u/i;
        re.toString = Symbol;
        const results = {};
        const record = (name, fn) => {
          try {
            fn();
            results[name] = "did not throw";
          } catch (e) {
            results[name] = e.constructor.name + ": " + e.message.split("\\n")[0];
          }
        };
        record("toStrictEqual", () => expect(re).toStrictEqual({}));
        record("toEqual", () => expect(re).toEqual(/x/i));
        record("toMatchObject", () => expect({ a: re }).toMatchObject({ a: 1 }));
        expect.extend({
          _hint(received) {
            record("matcherHint", () => this.utils.matcherHint("_hint", received, 1));
            return { pass: true, message: () => "" };
          },
        });
        expect(re)._hint();
        console.log(JSON.stringify(results));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify({
      toStrictEqual: "Error: expect(received).toStrictEqual(expected)",
      toEqual: "Error: expect(received).toEqual(expected)",
      toMatchObject: "Error: expect(received).toMatchObject(expected)",
      matcherHint: "TypeError: Cannot convert a symbol to a string",
    }),
    stderr: "",
    exitCode: 0,
  });
});
