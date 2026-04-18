import { describe, expect, test } from "bun:test";

describe("custom asymmetric matcher that throws", () => {
  expect.extend({
    _matcherThatThrows() {
      // throws an error inside the matcher implementation
      expect.closeTo(expect as any);
      return { pass: true };
    },
  });

  test("asymmetricMatch() propagates the exception instead of asserting", () => {
    // @ts-expect-error - custom matcher
    const matcher = expect._matcherThatThrows();
    expect(typeof matcher.asymmetricMatch).toBe("function");
    expect(() => matcher.asymmetricMatch(42)).toThrow("Expected a number value");
  });

  test("deep equality propagates the exception from the custom matcher", () => {
    expect(() => {
      // @ts-expect-error - custom matcher
      expect({ a: 1 }).toEqual({ a: expect._matcherThatThrows() });
    }).toThrow("Expected a number value");
  });
});
