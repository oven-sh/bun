import { expect, mock, test } from "bun:test";

test("mock.module throws TypeError for non-string first argument", () => {
  // @ts-expect-error
  expect(() => mock.module(SharedArrayBuffer, () => ({}))).toThrow("mock(module, fn) requires a module name string");
  // @ts-expect-error
  expect(() => mock.module({}, () => ({}))).toThrow("mock(module, fn) requires a module name string");
  // @ts-expect-error
  expect(() => mock.module(123, () => ({}))).toThrow("mock(module, fn) requires a module name string");
  // @ts-expect-error
  expect(() => mock.module(Symbol("test"), () => ({}))).toThrow("mock(module, fn) requires a module name string");
});

test("mock.module still works with valid string argument", async () => {
  mock.module("mock-module-non-string-test-fixture", () => ({ default: 42 }));
  const m = await import("mock-module-non-string-test-fixture");
  expect(m.default).toBe(42);
});

test("mock.module throws TypeError without resolving when callback is missing", () => {
  // Running the resolver on an arbitrary user-provided string can enter the
  // package-manager auto-install code path and crash. When the caller didn't
  // pass a callable second argument, we must fail fast before touching the
  // resolver.
  const specifiers = [
    "function f3() {}",
    "function foo(a, b) { return a + b; }",
    "() => 1",
    "some bogus package name {with braces}",
  ];
  for (const specifier of specifiers) {
    // @ts-expect-error missing callback on purpose
    expect(() => mock.module(specifier)).toThrow("mock(module, fn) requires a function");
  }
});
