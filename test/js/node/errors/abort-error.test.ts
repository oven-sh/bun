import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { inspect } from "node:util";

// node's AbortError is `class AbortError extends Error` (lib/internal/errors.js). Its
// constructor assigns `code` and `name`, so they are own enumerable properties, and it
// does not override toString. The other ERR_* codes are plain Error/TypeError/RangeError
// instances, which is why `err.constructor.name` tells the two apart.
function expectNodeAbortError(err: any, cause: unknown) {
  const proto = Object.getPrototypeOf(err);
  expect({
    constructorName: err.constructor.name,
    name: err.name,
    code: err.code,
    message: err.message,
    string: String(err),
    enumerableOwnKeys: Object.keys(err),
    protoOwnNames: Object.getOwnPropertyNames(proto),
    protoInheritsError: Object.getPrototypeOf(proto) === Error.prototype,
    constructorPrototype: err.constructor.prototype === proto,
    constructorInheritsError: Object.getPrototypeOf(err.constructor) === Error,
    instanceOfOwnClass: err instanceof err.constructor,
    isDOMException: err instanceof DOMException,
  }).toEqual({
    constructorName: "AbortError",
    name: "AbortError",
    code: "ABORT_ERR",
    message: "The operation was aborted",
    string: "AbortError: The operation was aborted",
    enumerableOwnKeys: ["code", "name"],
    protoOwnNames: ["constructor"],
    protoInheritsError: true,
    constructorPrototype: true,
    constructorInheritsError: true,
    instanceOfOwnClass: true,
    isDOMException: false,
  });
  expect(err.cause).toBe(cause);
}

describe("AbortError has node's class shape", () => {
  test("child_process.spawn with a pre-aborted signal", async () => {
    const signal = AbortSignal.abort();
    const err = await new Promise<any>((resolve, reject) => {
      const child = spawn("/bin/sh", ["-c", "echo hi"], { signal });
      child.on("error", resolve);
      child.on("close", () => reject(new Error("closed without an error event")));
    });
    expectNodeAbortError(err, signal.reason);
  });

  test("fs.promises.readFile with a pre-aborted signal", async () => {
    using dir = tempDir("abort-error-readfile", { "f.txt": "hello" });
    const signal = AbortSignal.abort();
    const err = await fs.readFile(join(String(dir), "f.txt"), { signal }).then(
      () => {
        throw new Error("expected a rejection");
      },
      e => e,
    );
    expectNodeAbortError(err, signal.reason);
  });

  test("http.request with a pre-aborted signal", async () => {
    const server = http.createServer((req, res) => res.end("ok"));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as { port: number };
      const signal = AbortSignal.abort();
      const err = await new Promise<any>((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path: "/", signal }, () =>
          reject(new Error("got a response")),
        );
        req.on("error", resolve);
        req.end();
      });
      expectNodeAbortError(err, signal.reason);
    } finally {
      server.close();
    }
  });

  test("util.inspect lists the own code like node", async () => {
    const signal = AbortSignal.abort();
    const err = await fs.readFile(import.meta.path, { signal }).catch(e => e);
    const text = inspect(err, { depth: 0 });
    expect(text).toStartWith("AbortError: The operation was aborted");
    expect(text).toContain("code: 'ABORT_ERR'");
  });

  describe("err.constructor is the AbortError class", () => {
    async function abortError() {
      return await fs.readFile(import.meta.path, { signal: AbortSignal.abort() }).catch(e => e);
    }

    test("new AbortError() uses node's default message", async () => {
      const AbortError = (await abortError()).constructor;
      const err = new AbortError();
      expectNodeAbortError(err, undefined);
      expect(Object.hasOwn(err, "cause")).toBe(false);
    });

    test("new AbortError(message, { cause })", async () => {
      const AbortError = (await abortError()).constructor;
      const cause = new Error("why");
      const err = new AbortError("custom message", { cause });
      expect({ message: err.message, cause: err.cause, name: err.name, code: err.code }).toEqual({
        message: "custom message",
        cause,
        name: "AbortError",
        code: "ABORT_ERR",
      });
    });

    test("rejects a non-object options argument like node", async () => {
      const AbortError = (await abortError()).constructor;
      expect(() => new AbortError("x", 5)).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE", name: "TypeError" }),
      );
      // `typeof null === "object"` passes node's check.
      expect(new AbortError("x", null).message).toBe("x");
    });

    test("can be subclassed", async () => {
      const AbortError = (await abortError()).constructor;
      class Cancelled extends AbortError {}
      const err = new Cancelled("stop");
      expect({
        isCancelled: err instanceof Cancelled,
        isAbortError: err instanceof AbortError,
        isError: err instanceof Error,
        constructorName: err.constructor.name,
        name: err.name,
        code: err.code,
        message: err.message,
      }).toEqual({
        isCancelled: true,
        isAbortError: true,
        isError: true,
        constructorName: "Cancelled",
        name: "AbortError",
        code: "ABORT_ERR",
        message: "stop",
      });
    });
  });
});
