// const { test, it, expect, describe } = require("@jest/globals");
import { it, describe, expect } from "@jest/globals";

describe("normal test", () => {
  it("Still works", () => {
    expect(1).toBe(1);
  });

  it("Still works with callback", done => {
    expect(done).toBeDefined();
    done();
  });

  it("Doesn't pass extra args", (done, unused, useless) => {
    expect(done).toBeDefined();
    expect(unused).toBeUndefined();
    expect(useless).toBeUndefined();
    done();
  });
});

describe("jest-each", () => {
  const foo = it.each([
    [1, 1, 2],
    [1, 2, 3],
    [2, 1, 3],
  ]);

  foo("adds %i + %i to equal %i", (a, b, expected) => {
    console.log("a", a);
    console.log("b", b);
    console.log("expected", expected);
    expect(a + b).toBe(expected);
  });
});
