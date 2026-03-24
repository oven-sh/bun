import { expect, mock, test } from "bun:test";

test("mock.module throws TypeError for non-string first argument", () => {
  expect(() => mock.module(SharedArrayBuffer, () => ({}))).toThrow("mock(module, fn) requires a module name string");
  expect(() => mock.module({}, () => ({}))).toThrow("mock(module, fn) requires a module name string");
  expect(() => mock.module(123, () => ({}))).toThrow("mock(module, fn) requires a module name string");
  expect(() => mock.module(Symbol("test"), () => ({}))).toThrow("mock(module, fn) requires a module name string");
});

test("mock.module still works with valid string argument", async () => {
  mock.module("mock-module-non-string-test-fixture", () => ({ default: 42 }));
  const m = await import("mock-module-non-string-test-fixture");
  expect(m.default).toBe(42);
});
