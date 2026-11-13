import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

test("Error.isError accepts DOMException and AbortSignal reasons", () => {
  const error = new DOMException("aborted", "AbortError");
  const controller = new AbortController();
  controller.abort();
  expect(Error.isError(error)).toBe(true);
  expect(Error.isError(controller.signal.reason)).toBe(true);

  // Real errors from another JS realm have the same native Error brand.
  expect(Error.isError(new Error("ordinary"))).toBe(true);
  expect(Error.isError(new AggregateError([], "aggregate"))).toBe(true);
  expect(Error.isError(runInNewContext("new Error('cross realm')"))).toBe(true);
});

test("Error.isError checks the internal error brand rather than prototypes", () => {
  const error = new DOMException("aborted", "AbortError");
  Object.setPrototypeOf(error, null);
  expect(Error.isError(error)).toBe(true);

  expect(Error.isError(Object.create(DOMException.prototype))).toBe(false);
  expect(Error.isError(new Proxy(new DOMException("wrapped"), {}))).toBe(false);
  expect(Error.isError(new Proxy(new Error("wrapped"), {}))).toBe(false);
  expect(Error.isError({ name: "Error", message: "spoof" })).toBe(false);
  expect(Error.isError(null)).toBe(false);
  expect(Error.isError("Error")).toBe(false);
});

test("Error.isError keeps its standard function attributes", () => {
  const descriptor = Object.getOwnPropertyDescriptor(Error, "isError");
  expect(descriptor).toMatchObject({
    writable: true,
    enumerable: false,
    configurable: true,
  });
  expect(descriptor?.value).toBe(Error.isError);
});
