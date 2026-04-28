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
    // @ts-expect-error non-callable second argument on purpose
    expect(() => mock.module(specifier, 123)).toThrow("mock(module, fn) requires a function");
  }
  Bun.gc(true);
});

test("mock.module throws TypeError when the second argument is non-callable", () => {
  const specifiers = [
    // valid npm package name — bypasses the isNPMPackageName gate in the resolver
    "PbQ",
    "some-package-that-does-not-exist",
    "@scope/pkg",
    "function f3() {}",
    "() => 1",
  ];
  for (const specifier of specifiers) {
    // @ts-expect-error non-callable second argument on purpose
    expect(() => mock.module(specifier, 123)).toThrow("mock(module, fn) requires a function");
  }
  Bun.gc(true);
});

test("mock.module throws a resolution error (not a TypeError) for an auto-mock with a non-existent package", () => {
  // `mock.module(specifier)` with no second argument is auto-mock mode: it
  // synchronously loads the real module to seed the mock. For a specifier
  // that doesn't exist, we surface the require() error rather than a bogus
  // "requires a function" TypeError (which was the pre-auto-mock behaviour).
  expect(() =>
    // @ts-expect-error missing callback on purpose
    mock.module("this-package-is-not-real-and-never-will-be-abcdef", undefined),
  ).toThrow(/Cannot find package|Module not found|find module/);
});
