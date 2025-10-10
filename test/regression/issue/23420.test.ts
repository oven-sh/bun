import { expect, test } from "bun:test";

test("resolves matcher returns a Promise", () => {
  const promise = Promise.resolve(42);
  const matcherResult = expect(promise).resolves.toBe(42);
  expect(matcherResult).toBeInstanceOf(Promise);
  return matcherResult;
});

test("rejects matcher returns a Promise", () => {
  const promise = Promise.reject(new Error("test error"));
  const matcherResult = expect(promise).rejects.toThrow("test error");
  expect(matcherResult).toBeInstanceOf(Promise);
  return matcherResult;
});

test("resolves.not matcher returns a Promise", () => {
  const promise = Promise.resolve(42);
  const matcherResult = expect(promise).resolves.not.toBe(100);
  expect(matcherResult).toBeInstanceOf(Promise);
  return matcherResult;
});

test("rejects.not matcher returns a Promise", () => {
  const promise = Promise.reject(42);
  const matcherResult = expect(promise).rejects.not.toThrow("wrong error");
  expect(matcherResult).toBeInstanceOf(Promise);
  return matcherResult;
});

test("multiple resolves matchers can be chained with await", async () => {
  const promise1 = Promise.resolve(1);
  const promise2 = Promise.resolve(2);

  await expect(promise1).resolves.toBe(1);
  await expect(promise2).resolves.toBe(2);
});

test("resolves.toEqual returns a Promise", async () => {
  const promise = Promise.resolve({ foo: "bar" });
  const matcherResult = expect(promise).resolves.toEqual({ foo: "bar" });
  expect(matcherResult).toBeInstanceOf(Promise);
  await matcherResult;
});
