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

test("mock.module does not crash on specifiers that are not valid npm package names", () => {
  const specifiers = [
    "function f2() {\n    const v6 = new ArrayBuffer();\n    v6.transferToFixedLength();\n}",
    "foo\nbar",
    "foo\rbar",
    "has spaces",
    "(parens)",
    "{braces}",
    "[brackets]",
  ];
  for (const specifier of specifiers) {
    expect(() => mock.module(specifier, () => ({ default: 1 }))).not.toThrow();
  }
  for (const specifier of specifiers) {
    // @ts-expect-error missing callback on purpose
    expect(() => mock.module(specifier)).toThrow("mock(module, fn) requires a function");
  }
  Bun.gc(true);
});
