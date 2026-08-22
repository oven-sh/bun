import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { addAbortSignal, Readable } from "node:stream";
import util from "node:util";

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
    [
      "fs ERR_INVALID_ARG_TYPE",
      () => fs.rmSync("/x", { recursive: "yes" as any }),
      "TypeError",
      "ERR_INVALID_ARG_TYPE",
    ],
    ["Buffer ERR_OUT_OF_RANGE", () => Buffer.alloc(-1), "RangeError", "ERR_OUT_OF_RANGE"],
    ["URL ERR_INVALID_URL", () => new URL("nope"), "TypeError", "ERR_INVALID_URL"],
    [
      "events ERR_INVALID_ARG_TYPE",
      () => new EventEmitter().setMaxListeners("x" as any),
      "TypeError",
      "ERR_INVALID_ARG_TYPE",
    ],
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

  test("non-string .code is coerced (primitive) or falls back (object)", () => {
    const e1 = capture(() => fs.rmSync("/x", { recursive: "yes" as any }));
    (e1 as any).code = 42;
    Error.captureStackTrace(e1);
    expect(String(e1.stack).split("\n")[0]).toStartWith("TypeError [42]: ");

    const e2 = capture(() => fs.rmSync("/x", { recursive: "yes" as any }));
    (e2 as any).code = { toString: () => "ignored" };
    Error.captureStackTrace(e2);
    expect(String(e2.stack).split("\n")[0]).toStartWith("TypeError [ERR_INVALID_ARG_TYPE]: ");
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

  test("AbortError (ABORT_ERR) does not get a bracket", async () => {
    const ac = new AbortController();
    const r = new Readable({ read() {} });
    addAbortSignal(ac.signal, r);
    const { promise, resolve } = Promise.withResolvers<NodeJS.ErrnoException>();
    r.on("error", resolve);
    ac.abort();
    const err = await promise;
    expect(err.code).toBe("ABORT_ERR");
    expect(err.name).toBe("AbortError");
    Error.captureStackTrace(err);
    expect(String(err.stack).split("\n")[0]).toStartWith("AbortError: ");
  });

  test("default Error.prepareStackTrace() uses name and bracketed code", () => {
    const err = capture(() => fs.rmSync("/x", { recursive: "yes" as any }));
    const out = Error.prepareStackTrace!(err, []);
    expect(out).toStartWith("TypeError [ERR_INVALID_ARG_TYPE]: ");

    const plain = new RangeError("hello");
    expect(Error.prepareStackTrace!(plain, [])).toStartWith("RangeError: hello");
  });
});
