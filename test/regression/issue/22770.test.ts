import { expect, test } from "bun:test";

// Regression test for issue #22770
// https://github.com/oven-sh/bun/issues/22770
// Arrow functions defined in tests should preserve their name property

test("arrow function names are preserved inside tests", () => {
  // Basic arrow function
  const arrow1 = () => {};
  expect(arrow1.name).toBe("arrow1");

  // Arrow function with parameters
  const arrow2 = (x: number) => x * 2;
  expect(arrow2.name).toBe("arrow2");

  // Arrow function with body
  const arrow3 = () => {
    return 42;
  };
  expect(arrow3.name).toBe("arrow3");

  // Async arrow function
  const arrow4 = async () => {};
  expect(arrow4.name).toBe("arrow4");

  // Arrow function in object literal
  const obj = {
    method: () => {},
  };
  expect(obj.method.name).toBe("method");

  // Arrow function in nested scope
  function nested() {
    const arrow5 = () => {};
    expect(arrow5.name).toBe("arrow5");
  }
  nested();

  // Arrow function assigned later
  let arrow6: () => void;
  arrow6 = () => {};
  expect(arrow6.name).toBe("arrow6");
});

test("arrow function names work with destructuring", () => {
  const { foo = () => {} } = {};
  expect(foo.name).toBe("foo");

  const [bar = () => {}] = [];
  expect(bar.name).toBe("bar");
});

test("anonymous arrow functions remain anonymous", () => {
  const anon = (() => () => {})();
  expect(anon.name).toBe("");

  const arr = [() => {}];
  expect(arr[0].name).toBe("");
});
