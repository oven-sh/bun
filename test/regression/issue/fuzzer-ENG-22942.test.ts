import { expect, test } from "bun:test";

// Regression test for ENG-22942: Crash when calling expect.extend with non-function values
// The crash occurred because JSWrappingFunction assumed all callable objects are JSFunction,
// but class constructors like Expect are callable but not JSFunction instances.

test("expect.extend with jest object should throw TypeError, not crash", () => {
  const jest = Bun.jest(import.meta.path);

  expect(() => {
    jest.expect.extend(jest);
  }).toThrow(TypeError);
});

test("expect.extend with object containing non-function values should throw", () => {
  const jest = Bun.jest(import.meta.path);

  expect(() => {
    jest.expect.extend({
      notAFunction: "string value",
    });
  }).toThrow("expect.extend: `notAFunction` is not a valid matcher");
});

test("expect.extend with valid matchers still works", () => {
  const jest = Bun.jest(import.meta.path);

  jest.expect.extend({
    toBeEven(received: number) {
      const pass = received % 2 === 0;
      return {
        message: () => `expected ${received} ${pass ? "not " : ""}to be even`,
        pass,
      };
    },
  });

  jest.expect(4).toBeEven();
  jest.expect(3).not.toBeEven();
});
