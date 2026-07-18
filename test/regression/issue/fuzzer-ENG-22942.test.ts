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

  // Use a unique matcher name: expect.extend mutates the shared matcher table,
  // so shadowing a built-in like toBeEven leaks into later files in the same run.
  jest.expect.extend({
    toBeEvenENG22942(received: number) {
      const pass = received % 2 === 0;
      return {
        message: () => `expected ${received} ${pass ? "not " : ""}to be even`,
        pass,
      };
    },
  });

  jest.expect(4).toBeEvenENG22942();
  jest.expect(3).not.toBeEvenENG22942();
});
