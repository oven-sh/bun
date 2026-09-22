import { inspect } from "bun";
import { describe, expect, it, test } from "bun:test";

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

  it.each([
    null,
    undefined,
    true,
    false,
    Symbol(), //
    "",
    "foobar",
  ])("returns an empty string for bad inputs (%p)", (input: any) => {
    expect(inspect.table(input)).toBe("");
  });
  it("returns an empty string when called with no arguments", () => {
    // @ts-expect-error
    expect(inspect.table()).toBe("");
  });

  it("works on functions", () => {
    expect(inspect.table(function () {})).not.toBeEmpty();
  });

  it("a depth option above the cell depth cap prints cells like the default", () => {
    const rows = [{ a: [1, 2], m: new Map([[1, 2]]), s: new Set([1]), o: { x: 1 } }];
    const byDefault = inspect.table(rows);
    expect(byDefault).toContain("[ 1, 2 ]");
    expect(byDefault).toContain("Map(1) { 1: 2 }");
    expect(byDefault).toContain("Set(1) { 1 }");
    expect(byDefault).toContain("{ x: 1 }");
    expect(inspect.table(rows, { depth: 10 })).toBe(byDefault);
    expect(inspect.table(rows, { depth: Infinity })).toBe(byDefault);
  });

  it("a container nested in a cell prints as a marker", () => {
    const rows = [{ o: { x: { y: 1 } }, n: [[1]], m: new Map([[1, new Map([[2, 3]])]]) }];
    const out = inspect.table(rows);
    expect(out).toContain("[Object ...]");
    expect(out).toContain("[ [Array ...] ]");
    expect(out).toContain("Map(1) { 1: [Map ...] }");
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
