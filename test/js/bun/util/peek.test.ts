import { peek } from "bun";
import { expect, test } from "bun:test";

test("peek", () => {
  const promise = Promise.resolve(true);

  // no await necessary!
  expect(peek(promise)).toBe(true);

  // if we peek again, it returns the same value
  const again = peek(promise);
  expect(again).toBe(true);

  // if we peek a non-promise, it returns the value
  const value = peek(42);
  expect(value).toBe(42);

  // if we peek a pending promise, it returns the promise again
  const pending = new Promise(() => {});
  expect(peek(pending)).toBe(pending);

  // If we peek a rejected promise, it:
  // - returns the error
  // - does not mark the promise as handled
  const rejected = Promise.reject<Error>(new Error("Succesfully tested promise rejection"));
  const peeked = peek(rejected);
  expect(peeked instanceof Error).toBe(true);
  expect((peeked as Error).message).toBe("Succesfully tested promise rejection");
  rejected.catch(() => {});

  expect(peek(new (class extends Promise<any> {})(() => {}))).toBeInstanceOf(Promise);
  expect(peek({ __proto__: Promise.prototype })).toBeInstanceOf(Promise);
});

test("peek.status", () => {
  const promise = Promise.resolve(true);
  expect(peek.status(promise)).toBe("fulfilled");

  const pending = new Promise(() => {});
  expect(peek.status(pending)).toBe("pending");

  const rejected = Promise.reject(new Error("oh nooo"));
  expect(peek.status(rejected)).toBe("rejected");
  rejected.catch(() => {});

  expect(peek.status(1)).toBe("fulfilled");
});
