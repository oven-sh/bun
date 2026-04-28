import { expect, test } from "bun:test";

// Regression test for ENG-24434
// jest.mock() with invalid arguments should throw TypeError, not crash
test("jest.mock() with non-string first argument should throw TypeError", () => {
  const jestObj = Bun.jest(import.meta.path).jest;

  // Passing the jest object itself as the first argument should throw
  // a TypeError, not crash with stack-buffer-overflow
  expect(() => {
    jestObj.mock(jestObj);
  }).toThrow(TypeError);
});

test("jest.mock() with object as first argument should throw TypeError", () => {
  const jestObj = Bun.jest(import.meta.path).jest;

  expect(() => {
    jestObj.mock({});
  }).toThrow(TypeError);
});

test("jest.mock() with missing callback auto-mocks and surfaces resolution errors", () => {
  // As of #29836, `jest.mock(specifier)` with no factory is auto-mock mode —
  // not a TypeError. For a non-existent specifier the require() under the
  // hood throws a resolution error; that's the regression signal for ENG-24434
  // (we must fail cleanly, not crash with a stack-buffer-overflow).
  const jestObj = Bun.jest(import.meta.path).jest;

  expect(() => {
    jestObj.mock("some-module-that-does-not-exist-abcdef");
  }).toThrow(/Cannot find package|Module not found|find module/);
});
