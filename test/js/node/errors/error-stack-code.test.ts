import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import util from "node:util";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";

function capture(fn: () => unknown): NodeJS.ErrnoException {
  try {
    fn();
  } catch (e) {
    return e as NodeJS.ErrnoException;
  }
  throw new Error("expected function to throw");
}

describe("Node.js ERR_* error .stack header includes [code]", () => {
  const cases: Array<[string, () => unknown, string, string]> = [
    ["fs ERR_INVALID_ARG_TYPE", () => fs.rmSync("/x", { recursive: "yes" as any }), "TypeError", "ERR_INVALID_ARG_TYPE"],
    ["Buffer ERR_OUT_OF_RANGE", () => Buffer.alloc(-1), "RangeError", "ERR_OUT_OF_RANGE"],
    ["URL ERR_INVALID_URL", () => new URL("nope"), "TypeError", "ERR_INVALID_URL"],
    ["events ERR_INVALID_ARG_TYPE", () => new EventEmitter().setMaxListeners("x" as any), "TypeError", "ERR_INVALID_ARG_TYPE"],
  ];

  test.each(cases)("%s", (_, fn, expectedName, expectedCode) => {
    const err = capture(fn);

    // .name stays the plain constructor name (Node compat: tests assert name === 'TypeError')
    expect(err.name).toBe(expectedName);
    expect(err.code).toBe(expectedCode);

    // .stack's first line is `${name} [${code}]: ${message}`
    const header = String(err.stack).split("\n")[0];
    expect(header).toStartWith(`${expectedName} [${expectedCode}]: `);

    // toString() already returned the bracketed form; still does
    expect(err.toString()).toStartWith(`${expectedName} [${expectedCode}]: `);

    // util.inspect(err) renders .stack as its header, so the code must appear
    expect(util.inspect(err)).toContain(expectedCode);
  });

  test("header reflects overwritten instance .code", () => {
    const err = capture(() => fs.rmSync("/x", { recursive: "yes" as any }));
    err.code = "OVERWRITTEN_CODE";
    Error.captureStackTrace(err);
    const header = String(err.stack).split("\n")[0];
    expect(header).toStartWith("TypeError [OVERWRITTEN_CODE]: ");
  });

  test("plain errors with .code do not get a bracket", () => {
    const err: any = new TypeError("hi");
    err.code = "ERR_FAKE";
    Error.captureStackTrace(err);
    expect(String(err.stack).split("\n")[0]).toBe("TypeError: hi");
  });

  test("errno errors do not get a bracket", () => {
    const err = capture(() => fs.readFileSync("/nonexistent-path-for-bun-errno-test"));
    expect(err.code).toBe("ENOENT");
    expect(String(err.stack).split("\n")[0]).not.toContain("[ENOENT]");
  });

  test("default Error.prepareStackTrace() uses name and bracketed code", () => {
    const err = capture(() => fs.rmSync("/x", { recursive: "yes" as any }));
    const out = Error.prepareStackTrace!(err, []);
    expect(out).toStartWith("TypeError [ERR_INVALID_ARG_TYPE]: ");

    const plain = new RangeError("hello");
    expect(Error.prepareStackTrace!(plain, [])).toStartWith("RangeError: hello");
  });
});
