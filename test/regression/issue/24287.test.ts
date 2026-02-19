import { expect, test } from "bun:test";

test("domain.bind() returns the original function's return value", () => {
  const domain = require("domain");
  const d = domain.create();

  const bound = d.bind(() => 42);
  expect(bound()).toBe(42);
});

test("domain.bind() returns the original async function's promise", async () => {
  const domain = require("domain");
  const d = domain.create();

  const bound = d.bind(async () => "hello");
  const result = bound();
  expect(result).toBeInstanceOf(Promise);
  expect(await result).toBe("hello");
});

test("domain.intercept() returns the original function's return value", () => {
  const domain = require("domain");
  const d = domain.create();

  const intercepted = d.intercept((...args: any[]) => args.join(","));
  expect(intercepted(null, "a", "b")).toBe("a,b");
});

test("domain.intercept() returns the original async function's promise", async () => {
  const domain = require("domain");
  const d = domain.create();

  const intercepted = d.intercept(async () => "world");
  const result = intercepted(null);
  expect(result).toBeInstanceOf(Promise);
  expect(await result).toBe("world");
});

test("domain.run() returns the function's return value", () => {
  const domain = require("domain");
  const d = domain.create();

  const result = d.run(() => 99);
  expect(result).toBe(99);
});

test("domain.run() returns the async function's promise", async () => {
  const domain = require("domain");
  const d = domain.create();

  const result = d.run(async () => "done");
  expect(result).toBeInstanceOf(Promise);
  expect(await result).toBe("done");
});
