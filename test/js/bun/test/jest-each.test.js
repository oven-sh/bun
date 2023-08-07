import { it, describe, expect } from "@jest/globals";

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
  it.each(NUMBERS)("add two numbers", (a, b, e) => {
    expect(a + b).toBe(e);
  });

  it.each(NUMBERS)("add two numbers with callback", (a, b, e, done) => {
    expect(a + b).toBe(e);
    expect(done).toBeDefined();
    done();
  });
  it.each([
    ["a", "b", "ab"],
    ["c", "d", "cd"],
    ["e", "f", "ef"],
  ])(`adds two strings`, (a, b, res) => {
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
    { a: 2, b: 13, e: 15 },
    { a: 2, b: 13, e: 15 },
  ])("add two numbers with object", ({ a, b, e }, cb) => {
    expect(a + b).toBe(e);
    cb();
  });
});
