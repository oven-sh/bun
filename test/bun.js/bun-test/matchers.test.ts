import { describe, expect, test } from "bun:test";

describe("different kinds of matchers", () => {
  test("toBeInstanceOf", () => {
    expect({}).toBeInstanceOf(Object);
    expect(new String("test")).toBeInstanceOf(String);
    expect(() => {}).toBeInstanceOf(Function);
    class A {}
    expect(new A()).toBeInstanceOf(A);
  });
});