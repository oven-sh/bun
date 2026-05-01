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

test("jest.mock() with missing callback should throw TypeError", () => {
  const jestObj = Bun.jest(import.meta.path).jest;

  expect(() => {
    jestObj.mock("some-module");
  }).toThrow(TypeError);
});
