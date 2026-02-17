import * as BunTest from "bun:test";

const mockTrue = BunTest.mock(() => true);

test("should work with namespace import from bun:test", () => {
  expect(mockTrue()).toEqual(true);
});

describe("namespace import with globals should work", () => {
  it("should have access to test globals", () => {
    expect(typeof test).toBe("function");
    expect(typeof describe).toBe("function");
    expect(typeof it).toBe("function");
    expect(typeof expect).toBe("function");
  });
});
