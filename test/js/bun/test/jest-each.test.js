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

const NUMBERS = [
  [1, 1, 2],
  [1, 2, 3],
  [2, 1, 3],
];

describe("jest-each", () => {
  it.each(NUMBERS)("adds", (a, b, e) => {
    expect(a + b).toBe(e);
  });

  it.each(NUMBERS)("adds with callback", (a, b, e, done) => {
    expect(a + b).toBe(e);
    expect(done).toBeDefined();
    done();
  });

  it.each([1])("times out correctly", async () => Bun.sleep(3000), 1000);
});
