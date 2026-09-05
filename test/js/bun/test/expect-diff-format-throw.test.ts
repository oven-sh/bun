import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A failing matcher formats the received and the expected value for its diff.
// Formatting runs user code (getters, Proxy traps, toString), which can throw.
// That error propagates to the caller. DiffFormatter used to format both values
// inside Display::fmt and drop the result, so the exception stayed pending on
// the VM while the other value was formatted, and a debug build aborted on the
// next native call. Every input runs in a child process for that reason.

async function run(script: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

// Each setup defines `value`. The comparison itself never reaches the throwing
// code, so only the formatting of the failure message throws.
const throwingValues: Record<string, { setup: string; error: string }> = {
  "an object whose $$typeof getter throws": {
    setup: `
      const value = {};
      Object.defineProperty(value, "$$typeof", { get() { throw new Error("boom"); } });
    `,
    error: "Error: boom",
  },
  "an object whose Symbol.toStringTag getter throws": {
    setup: `
      const value = { a: 1 };
      Object.defineProperty(value, Symbol.toStringTag, { get() { throw new Error("boom"); } });
    `,
    error: "Error: boom",
  },
  "a function whose Symbol.toStringTag getter throws": {
    setup: `
      const value = function named() {};
      Object.defineProperty(value, Symbol.toStringTag, { get() { throw new Error("boom"); } });
    `,
    error: "Error: boom",
  },
  "a function whose prototype is a Proxy with a throwing has trap": {
    setup: `
      const value = function named() {};
      Object.setPrototypeOf(value, new Proxy(Function.prototype, { has() { throw new Error("boom"); } }));
    `,
    error: "Error: boom",
  },
  "an array Proxy whose get trap throws": {
    setup: `
      const value = new Proxy([1], {
        get(target, key, receiver) {
          if (key === "0") throw new Error("boom");
          return Reflect.get(target, key, receiver);
        },
      });
    `,
    error: "Error: boom",
  },
  "a RegExp whose toString throws": {
    setup: `
      const value = /abc/;
      Object.defineProperty(value, "toString", { value() { throw new Error("boom"); } });
    `,
    error: "Error: boom",
  },
  "a RegExp whose toString returns a Symbol": {
    setup: `
      const value = /u/i;
      value.toString = Symbol;
    `,
    error: "TypeError: Cannot convert a symbol to a string",
  },
  "an object whose $$typeof getter overflows the stack": {
    setup: `
      const value = {};
      Object.defineProperty(value, "$$typeof", { get() { return this.$$typeof; } });
    `,
    error: "RangeError: Maximum call stack size exceeded.",
  },
};

describe.concurrent("a failing matcher propagates the error thrown while its diff is formatted", () => {
  test.each(Object.entries(throwingValues))("%s on either side of the diff", async (_, { setup, error }) => {
    const result = await run(`
      ${setup}
      const { expect } = Bun.jest();
      const results = {};
      const record = (name, fn) => {
        try {
          fn();
          results[name] = "did not throw";
        } catch (e) {
          results[name] = e.constructor.name + ": " + e.message.split("\\n")[0];
        }
      };
      record("toEqual received", () => expect(value).toEqual({ z: 9 }));
      record("toEqual expected", () => expect({ z: 9 }).toEqual(value));
      record("toStrictEqual received", () => expect(value).toStrictEqual({ z: 9 }));
      record("toStrictEqual expected", () => expect({ z: 9 }).toStrictEqual(value));
      record("toMatchObject received", () => expect({ a: value }).toMatchObject({ a: 1 }));
      record("toMatchObject expected", () => expect({ a: 1 }).toMatchObject({ a: value }));
      console.log(JSON.stringify(results));
    `);
    expect(result).toEqual({
      stdout: JSON.stringify({
        "toEqual received": error,
        "toEqual expected": error,
        "toStrictEqual received": error,
        "toStrictEqual expected": error,
        "toMatchObject received": error,
        "toMatchObject expected": error,
      }),
      stderr: "",
      exitCode: 0,
    });
  });

  // matcherHint renders the same diff for a custom matcher and returns it as a
  // string, so the custom matcher can catch the error.
  test("matcherHint throws the error to the custom matcher", async () => {
    const result = await run(`
      ${throwingValues["an object whose Symbol.toStringTag getter throws"].setup}
      const { expect } = Bun.jest();
      let caught;
      expect.extend({
        toBeHinted(received, expected) {
          try {
            this.utils.matcherHint("toBeHinted", received, expected);
            caught = "did not throw";
          } catch (e) {
            caught = e.constructor.name + ": " + e.message;
          }
          return { pass: true, message: () => "" };
        },
      });
      expect(value).toBeHinted({ z: 9 });
      console.log(caught);
    `);
    expect(result).toEqual({ stdout: "Error: boom", stderr: "", exitCode: 0 });
  });

  // The error also propagates when matcherHint runs inside the message callback
  // of a failing custom matcher.
  test("matcherHint inside the message of a failing custom matcher", async () => {
    const result = await run(`
      ${throwingValues["a function whose Symbol.toStringTag getter throws"].setup}
      const { expect } = Bun.jest();
      expect.extend({
        toBeHinted(received, expected) {
          return { pass: false, message: () => this.utils.matcherHint("toBeHinted", received, expected) };
        },
      });
      try {
        expect({ fn: value }).toBeHinted({ b: 16 });
        console.log("did not throw");
      } catch (e) {
        console.log(e.constructor.name + ": " + e.message.split("\\n")[0]);
      }
    `);
    expect(result).toEqual({ stdout: "Error: boom", stderr: "", exitCode: 0 });
  });
});
