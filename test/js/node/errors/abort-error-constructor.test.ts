import { describe, expect, test } from "bun:test";
import { EventEmitter, once } from "node:events";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { inspect } from "node:util";

// Node's AbortError is `class AbortError extends Error` (lib/internal/errors.js), so
// `err.constructor` is a function named AbortError. Bun builds these errors natively
// (ErrorCode.cpp) from two entry points, `$makeAbortError` in the JS builtins and
// `Bun__wrapAbortError` for Rust callers; both must produce the same class shape.
// Except for the bun:test formatting case, every assertion here also holds on Node v26.

async function rejection(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("expected the operation to reject");
}

function thrown(fn: () => unknown): any {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected the operation to throw");
}

async function abortErrors() {
  const signal = AbortSignal.abort();
  return {
    // $makeAbortError (JS builtins)
    "timers/promises": await rejection(sleep(1, undefined, { signal })),
    "events.once": await rejection(once(new EventEmitter(), "never", { signal })),
    // Bun__wrapAbortError (Rust callers)
    "fs.promises.readFile": await rejection(readFile(import.meta.path, { signal })),
    "Bun.spawn": thrown(() => Bun.spawn({ cmd: ["this-command-is-never-spawned"], signal })),
  };
}

describe("node-style AbortError", () => {
  test("util.inspect prints it under its own class name", async () => {
    const errors = await abortErrors();
    const firstLines = Object.fromEntries(
      Object.entries(errors).map(([producer, err]) => [producer, inspect(err).split("\n")[0]]),
    );
    expect(firstLines).toEqual({
      "timers/promises": "AbortError: The operation was aborted",
      "events.once": "AbortError: The operation was aborted",
      "fs.promises.readFile": "AbortError: The operation was aborted",
      "Bun.spawn": "AbortError: The operation was aborted",
    });
  });

  test("every producer shares one AbortError class", async () => {
    const errors = await abortErrors();
    const AbortError = errors["timers/promises"].constructor;
    const prototype = Object.getPrototypeOf(errors["timers/promises"]);

    for (const err of Object.values(errors)) {
      expect(err.constructor).toBe(AbortError);
      expect(err).toBeInstanceOf(AbortError);
      expect(Object.getPrototypeOf(err)).toBe(prototype);
    }

    expect(AbortError).not.toBe(Error);
    expect({ name: AbortError.name, length: AbortError.length }).toEqual({ name: "AbortError", length: 0 });
    expect(AbortError.prototype).toBe(prototype);
    expect(Object.getPrototypeOf(AbortError)).toBe(Error);
    expect(Object.getPrototypeOf(prototype)).toBe(Error.prototype);

    // Same attributes `class AbortError extends Error {}` would produce.
    const { value: constructorValue, ...constructorAttributes } = Object.getOwnPropertyDescriptor(
      prototype,
      "constructor",
    )!;
    expect(constructorValue).toBe(AbortError);
    expect(constructorAttributes).toEqual({ writable: true, enumerable: false, configurable: true });
    const { value: prototypeValue, ...prototypeAttributes } = Object.getOwnPropertyDescriptor(AbortError, "prototype")!;
    expect(prototypeValue).toBe(prototype);
    expect(prototypeAttributes).toEqual({ writable: false, enumerable: false, configurable: false });
  });

  test("err.constructor constructs AbortErrors", async () => {
    const { "timers/promises": err } = await abortErrors();
    const AbortError = err.constructor;
    const cause = new Error("why");

    const custom = new AbortError("custom message", { cause });
    expect(custom).toBeInstanceOf(AbortError);
    expect({ name: custom.name, code: custom.code, message: custom.message, cause: custom.cause }).toEqual({
      name: "AbortError",
      code: "ABORT_ERR",
      message: "custom message",
      cause,
    });
    expect(inspect(custom).split("\n")[0]).toBe("AbortError: custom message");

    const defaults = new AbortError();
    expect(defaults).toBeInstanceOf(AbortError);
    expect({ name: defaults.name, code: defaults.code, message: defaults.message, cause: defaults.cause }).toEqual({
      name: "AbortError",
      code: "ABORT_ERR",
      message: "The operation was aborted",
      cause: undefined,
    });

    const withNull = new AbortError("message", null);
    expect(withNull).toBeInstanceOf(AbortError);
    expect({ name: withNull.name, code: withNull.code, message: withNull.message, cause: withNull.cause }).toEqual({
      name: "AbortError",
      code: "ABORT_ERR",
      message: "message",
      cause: undefined,
    });
  });

  test("err.constructor rejects options that are not typeof object", async () => {
    const { "timers/promises": err } = await abortErrors();
    const AbortError = err.constructor;
    const values = {
      number: 42,
      boolean: true,
      bigint: 0n,
      string: "not an object",
      symbol: Symbol("options"),
      function: function named() {},
    };
    const rejected = Object.fromEntries(
      Object.entries(values).map(([label, options]) => {
        const invalid = thrown(() => new AbortError("message", options));
        return [label, { name: invalid.name, code: invalid.code, message: invalid.message }];
      }),
    );
    const typeError = (received: string) => ({
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: `The "options" argument must be of type object. Received ${received}`,
    });
    expect(rejected).toEqual({
      number: typeError("type number (42)"),
      boolean: typeError("type boolean (true)"),
      bigint: typeError("type bigint (0n)"),
      string: typeError("type string ('not an object')"),
      symbol: typeError("type symbol (Symbol(options))"),
      function: typeError("function named"),
    });
  });

  test("ERR_INVALID_ARG_TYPE describes it as an instance of AbortError", async () => {
    const { "fs.promises.readFile": err } = await abortErrors();
    const invalid = thrown(() => Buffer.from(err));
    expect({ code: invalid.code, message: invalid.message }).toEqual({
      code: "ERR_INVALID_ARG_TYPE",
      message:
        "The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object. Received an instance of AbortError",
    });
  });

  test("bun:test formats it under its class name, like jest does for node's AbortError", async () => {
    const { "events.once": err } = await abortErrors();
    expect(err).toMatchInlineSnapshot(`[AbortError: The operation was aborted]`);
  });

  test("ERR_* errors still report the base constructor, like node", () => {
    // Node keeps `constructor` pointing at the base class for its ERR_* codes; only
    // AbortError is a class of its own.
    const err = thrown(() => Buffer.from(1 as any));
    expect({ code: err.code, constructor: err.constructor, name: err.name }).toEqual({
      code: "ERR_INVALID_ARG_TYPE",
      constructor: TypeError,
      name: "TypeError",
    });
  });
});
