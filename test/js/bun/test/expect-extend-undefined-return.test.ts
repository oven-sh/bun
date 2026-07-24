import { describe, expect, test } from "bun:test";

describe("expect.extend", () => {
  test("custom matcher returning undefined throws InvalidMatcherError", () => {
    expect.extend({
      _returnsUndefined() {},
    });

    expect(() => expect(42)._returnsUndefined()).toThrow("Unexpected return from matcher function");
  });

  test("custom asymmetric matcher returning undefined does not crash", () => {
    expect.extend({
      _asymmetricReturnsUndefined() {},
    });

    expect({ a: 1 }).not.toEqual({
      a: expect._asymmetricReturnsUndefined(),
    });
  });
});
