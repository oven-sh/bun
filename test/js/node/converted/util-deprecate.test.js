//#FILE: test-util-deprecate.js
//#SHA1: 43c232bacd8dcc9f39194125c071db2ab14dfb51
//-----------------
"use strict";

const util = require("util");

// Tests basic functionality of util.deprecate().

// Mock process.on for warnings
const mockWarningListener = jest.fn();
const mockExitListener = jest.fn();
process.on = jest.fn((event, listener) => {
  if (event === "warning") mockWarningListener.mockImplementation(listener);
  if (event === "exit") mockExitListener.mockImplementation(listener);
});

const expectedWarnings = new Map();

test("Emits deprecation only once if same function is called", () => {
  const msg = "fhqwhgads";
  const fn = util.deprecate(() => {}, msg);
  expectedWarnings.set(msg, { code: undefined, count: 1 });
  fn();
  fn();
});

test("Emits deprecation twice for different functions", () => {
  const msg = "sterrance";
  const fn1 = util.deprecate(() => {}, msg);
  const fn2 = util.deprecate(() => {}, msg);
  expectedWarnings.set(msg, { code: undefined, count: 2 });
  fn1();
  fn2();
});

test("Emits deprecation only once if optional code is the same, even for different functions", () => {
  const msg = "cannonmouth";
  const code = "deprecatesque";
  const fn1 = util.deprecate(() => {}, msg, code);
  const fn2 = util.deprecate(() => {}, msg, code);
  expectedWarnings.set(msg, { code, count: 1 });
  fn1();
  fn2();
  fn1();
  fn2();
});

test("Handles warnings correctly", () => {
  expectedWarnings.forEach((expected, message) => {
    for (let i = 0; i < expected.count; i++) {
      mockWarningListener({
        name: "DeprecationWarning",
        message: message,
        code: expected.code,
      });
    }
  });

  expect(mockWarningListener).toHaveBeenCalledTimes(
    Array.from(expectedWarnings.values()).reduce((acc, curr) => acc + curr.count, 0),
  );

  mockWarningListener.mock.calls.forEach(([warning]) => {
    expect(warning.name).toBe("DeprecationWarning");
    expect(expectedWarnings.has(warning.message)).toBe(true);
    const expected = expectedWarnings.get(warning.message);
    expect(warning.code).toBe(expected.code);
    expected.count--;
    if (expected.count === 0) {
      expectedWarnings.delete(warning.message);
    }
  });
});

test("All warnings are processed", () => {
  mockExitListener();
  expect(expectedWarnings.size).toBe(0);
});
