import { describe, expect, test } from "bun:test";
import { EventEmitter, once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { AddressInfo, connect } from "node:net";
import { setTimeout as sleepWithSignal } from "node:timers/promises";

// Node only overrides toString() (to `${name} [${code}]: ${message}`) on the
// ERR_* errors defined in lib/internal/errors.js. Everything else that carries
// a `code`, such as AbortError (ABORT_ERR) or the llhttp HPE_* parse errors, is
// a plain Error and stringifies through Error.prototype.toString.
function expectPlainErrorToString(err: any) {
  expect(err).toBeInstanceOf(Error);
  expect(err.toString).toBe(Error.prototype.toString);
  expect(String(err)).toBe(`${err.name}: ${err.message}`);
  // The .stack header already had node's shape; toString() has to agree with it.
  expect(err.stack.split("\n")[0]).toBe(String(err));
}

function expectNodeAbortError(err: any, reason: unknown) {
  expect({ name: err.name, code: err.code, cause: err.cause }).toEqual({
    name: "AbortError",
    code: "ABORT_ERR",
    cause: reason,
  });
  expect(String(err)).toStartWith("AbortError: The operation was aborted");
  expect(String(err)).not.toContain("[ABORT_ERR]");
  expectPlainErrorToString(err);
}

function rejection(promise: Promise<unknown>) {
  return promise.then(
    () => {
      throw new Error("expected the promise to reject");
    },
    err => err,
  );
}

function thrown(fn: () => unknown) {
  try {
    fn();
  } catch (err) {
    return err as any;
  }
  throw new Error("expected the function to throw");
}

describe.concurrent("AbortError toString() matches node", () => {
  test("timers/promises setTimeout({ signal })", async () => {
    const signal = AbortSignal.abort();
    const err = await rejection(sleepWithSignal(1, undefined, { signal }));
    expectNodeAbortError(err, signal.reason);
  });

  test("events.once({ signal })", async () => {
    const reason = new Error("stop");
    const signal = AbortSignal.abort(reason);
    const err = await rejection(once(new EventEmitter(), "never", { signal }));
    expectNodeAbortError(err, reason);
  });

  // fs.promises.readFile checks the signal in native code, so this covers the
  // AbortError created from native code rather than from the JS builtins.
  test("fs.promises.readFile({ signal })", async () => {
    const signal = AbortSignal.abort();
    const err = await rejection(readFile(import.meta.path, { signal }));
    expectNodeAbortError(err, signal.reason);
  });
});

test("http clientError HPE_* errors stringify like node's plain Error", async () => {
  const { promise, resolve } = Promise.withResolvers<any>();
  await using server = createServer(() => {});
  server.on("clientError", (err, socket) => {
    socket.destroy();
    resolve(err);
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;

  const socket = connect(port, "127.0.0.1", () => socket.write("BOGUS\r\n\r\n"));
  socket.on("error", () => {});
  const err = await promise;
  socket.destroy();

  expect({ name: err.name, code: err.code }).toEqual({ name: "Error", code: "HPE_INVALID_METHOD" });
  expect(String(err)).toBe("Error: Parse Error: Invalid method encountered");
  expectPlainErrorToString(err);
});

test("ERR_* errors keep node's bracketed toString()", () => {
  const rangeError = thrown(() => Buffer.alloc(-1));
  expect({ name: rangeError.name, code: rangeError.code }).toEqual({ name: "RangeError", code: "ERR_OUT_OF_RANGE" });
  expect(rangeError.toString).not.toBe(Error.prototype.toString);
  expect(String(rangeError)).toBe(`RangeError [ERR_OUT_OF_RANGE]: ${rangeError.message}`);

  const typeError = thrown(() => new EventEmitter().on("x", 1 as any));
  expect({ name: typeError.name, code: typeError.code }).toEqual({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE" });
  expect(String(typeError)).toBe(`TypeError [ERR_INVALID_ARG_TYPE]: ${typeError.message}`);
});
