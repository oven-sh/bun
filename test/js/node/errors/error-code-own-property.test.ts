import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import fs from "node:fs";

// Node.js defines `code` on ERR_* errors as an own, enumerable, writable,
// configurable data property on the instance. That makes it visible to
// Object.keys, JSON.stringify, spread and hasOwnProperty, which structured
// error loggers rely on.

function capture(fn: () => void): Error & { code?: string } {
  try {
    fn();
  } catch (e) {
    return e as Error & { code?: string };
  }
  throw new Error("expected throw");
}

describe("Node.js ERR_* error .code is an own property", () => {
  const cases: Array<[string, string, () => void]> = [
    ["fs options ERR_INVALID_ARG_TYPE", "ERR_INVALID_ARG_TYPE", () => fs.rmSync("/x", { recursive: "yes" as any })],
    ["fs ERR_OUT_OF_RANGE", "ERR_OUT_OF_RANGE", () => fs.mkdirSync("/x", { mode: -1 })],
    ["Buffer ERR_OUT_OF_RANGE", "ERR_OUT_OF_RANGE", () => Buffer.alloc(-1)],
    ["URL ERR_INVALID_URL", "ERR_INVALID_URL", () => new URL("nope")],
    ["events ERR_INVALID_ARG_TYPE", "ERR_INVALID_ARG_TYPE", () => new EventEmitter().setMaxListeners("x" as any)],
  ];

  test.each(cases)("%s", (_label, expectedCode, fn) => {
    const err = capture(fn);

    expect(err.code).toBe(expectedCode);

    const desc = Object.getOwnPropertyDescriptor(err, "code");
    expect(desc).toEqual({
      value: expectedCode,
      writable: true,
      enumerable: true,
      configurable: true,
    });

    expect(Object.prototype.hasOwnProperty.call(err, "code")).toBe(true);
    expect(Object.keys(err)).toContain("code");
    expect({ ...err }.code).toBe(expectedCode);
    expect(JSON.parse(JSON.stringify(err)).code).toBe(expectedCode);
  });

  test("for...in only enumerates own 'code', not prototype name/toString", () => {
    const err = capture(() => Buffer.alloc(-1));
    const keys: string[] = [];
    for (const k in err) keys.push(k);
    expect(keys).toContain("code");
    expect(keys).not.toContain("name");
    expect(keys).not.toContain("toString");
  });

  test("prototype does not carry 'code'", () => {
    const err = capture(() => Buffer.alloc(-1));
    const proto = Object.getPrototypeOf(err);
    expect(Object.prototype.hasOwnProperty.call(proto, "code")).toBe(false);
  });

  test("toString() still includes the code", () => {
    const err = capture(() => Buffer.alloc(-1));
    expect(String(err)).toContain("[ERR_OUT_OF_RANGE]");
    expect(err.name).toBe("RangeError");
  });

  test("errno errors (control) also have own 'code'", () => {
    const err = capture(() => fs.openSync("/nonexistent-" + Math.random().toString(36).slice(2), "r"));
    expect(err.code).toBe("ENOENT");
    expect(Object.prototype.hasOwnProperty.call(err, "code")).toBe(true);
  });
});
