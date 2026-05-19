import { describe, expect, it, test } from "bun:test";

const NUMBERS = [
  [1, 1, 2],
  [1, 2, 3],
  [2, 1, 3],
];

describe("jest-each", () => {
  it("check types", () => {
    expect(it.each).toBeTypeOf("function");
    expect(it.each([])).toBeTypeOf("function");
  });
  it.each(NUMBERS)("%i + %i = %i", (a, b, e) => {
    expect(a + b).toBe(e);
  });
  it.each(NUMBERS)("with callback: %f + %d = %f", (a, b, e, done) => {
    expect(a + b).toBe(e);
    expect(done).toBeDefined();
    // We cast here because we cannot type done when typing args as ...T
    (done as unknown as (err?: unknown) => void)();
  });
  it.each([
    ["a", "b", "ab"],
    ["c", "d", "cd"],
    ["e", "f", "ef"],
  ])("%s + %s = %s", (a, b, res) => {
    expect(typeof a).toBe("string");
    expect(typeof b).toBe("string");
    expect(typeof res).toBe("string");
    expect(a.concat(b)).toBe(res);
  });
  it.each([
    { a: 1, b: 1, e: 2 },
    { a: 1, b: 2, e: 3 },
    { a: 2, b: 13, e: 15 },
    { a: 2, b: 13, e: 15 },
    { a: 2, b: 123, e: 125 },
    { a: 15, b: 13, e: 28 },
  ])("add two numbers with object: %o", ({ a, b, e }, cb) => {
    expect(a + b).toBe(e);
    cb();
  });

  it.each([undefined, null, NaN, Infinity])("stringify %#: %j", (arg, cb) => {
    cb();
  });
});

describe.each(["some", "cool", "strings"])("works with describe: %s", s => {
  it(`has access to params : ${s}`, done => {
    expect(s).toBeTypeOf("string");
    done();
  });
});

describe("does not return zero", () => {
  expect(it.each([1, 2])("wat", () => {})).toBeUndefined();
});

describe("tagged template literal format", () => {
  it.each`
    a    | b    | expected
    ${1} | ${2} | ${3}
    ${4} | ${5} | ${9}
  `("$a + $b = $expected", ({ a, b, expected }) => {
    expect(a + b).toBe(expected);
  });

  it.each`
    name       | value
    ${"hello"} | ${42}
    ${"world"} | ${0}
  `("$name has value $value", ({ name, value }) => {
    expect(typeof name).toBe("string");
    expect(typeof value).toBe("number");
  });

  it.each`
    input        | expected
    ${null}      | ${null}
    ${undefined} | ${undefined}
    ${0}         | ${0}
  `("handles falsy value: $input", ({ input, expected }) => {
    expect(input).toBe(expected);
  });
});

describe.each`
  multiplier | value | expected
  ${2}       | ${3}  | ${6}
  ${3}       | ${4}  | ${12}
`("describe.each tagged template: multiplier $multiplier", ({ multiplier, value, expected }) => {
  it("computes correctly", () => {
    expect(multiplier * value).toBe(expected);
  });
});

test.each`
  input | output
  ${1}  | ${2}
  ${2}  | ${4}
`("test.each tagged template: $input -> $output", ({ input, output }) => {
  expect(input * 2).toBe(output);
});
