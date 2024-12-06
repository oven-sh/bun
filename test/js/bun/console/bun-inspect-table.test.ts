import { inspect } from "bun";
import { test, expect, describe } from "bun:test";

const inputs = [
  { a: 1, b: 2 },
  { a: 1, b: 2, c: 3 },
  { a: 1, b: 2, c: 3, d: 4 },
  new Map([
    ["a", 1],
    ["b", 2],
  ]),
  [
    ["a", 1],
    ["b", 2],
  ],
  new Set([1, 2, 3]),
  { 0: 1, 1: 2, 2: 3 },
  [1, 2, 3],
  ["a", 1, "b", 2, "c", 3],
  [/a/, 1, /b/, 2, /c/, 3],
];

describe("inspect.table", () => {
  inputs.forEach(input => {
    test(Bun.inspect(input, { colors: false, sorted: true, compact: true }), () => {
      expect(inspect.table(input, { colors: false, sorted: true })).toMatchSnapshot();
    });
  });
});

describe("inspect.table (ansi)", () => {
  inputs.forEach(input => {
    test(Bun.inspect(input, { colors: false, sorted: true, compact: true }), () => {
      expect(inspect.table(input, { colors: true, sorted: true })).toMatchSnapshot();
    });
  });
});

const withProperties = [
  [{ a: 1, b: 2 }, ["b"]],
  [{ a: 1, b: 2 }, ["a"]],
];

describe("inspect.table (with properties)", () => {
  withProperties.forEach(([input, properties]) => {
    test(Bun.inspect(input, { colors: false, sorted: true, compact: true }), () => {
      expect(inspect.table(input, properties, { colors: false, sorted: true })).toMatchSnapshot();
    });
  });
});

describe("inspect.table (with properties and colors)", () => {
  withProperties.forEach(([input, properties]) => {
    test(Bun.inspect(input, { colors: false, sorted: true, compact: true }), () => {
      expect(inspect.table(input, properties, { colors: true, sorted: true })).toMatchSnapshot();
    });
  });
});

describe("inspect.table (with colors in 2nd position)", () => {
  withProperties.forEach(([input, properties]) => {
    test(Bun.inspect(input, { colors: false, sorted: true, compact: true }), () => {
      expect(inspect.table(input, { colors: true, sorted: true })).toMatchSnapshot();
    });
  });
});
