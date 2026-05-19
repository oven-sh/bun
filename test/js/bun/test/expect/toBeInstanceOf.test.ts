import { expect, test } from "bun:test";

// When Symbol.hasInstance throws during isInstanceOf, the original exception
// must be propagated (not swallowed into a corrupted matcher error message).

test("toBeInstanceOf propagates hasInstance exception", () => {
  class Foo {
    static [Symbol.hasInstance](): boolean {
      throw new Error("boom");
    }
  }
  expect(() => {
    expect({}).toBeInstanceOf(Foo);
  }).toThrow("boom");
});

test("toThrow propagates hasInstance exception", () => {
  class Foo {
    static [Symbol.hasInstance](): boolean {
      throw new Error("boom");
    }
  }
  expect(() => {
    expect(() => {
      throw new TypeError("x");
    }).toThrow(Foo);
  }).toThrow("boom");
});

test("not.toThrow propagates hasInstance exception", () => {
  class Foo {
    static [Symbol.hasInstance](): boolean {
      throw new Error("boom");
    }
  }
  expect(() => {
    expect(() => {
      throw new TypeError("x");
    }).not.toThrow(Foo);
  }).toThrow("boom");
});
