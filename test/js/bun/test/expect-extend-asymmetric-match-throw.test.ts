import { expect, test } from "bun:test";

test("asymmetricMatch propagates exceptions thrown by the matcher", () => {
  expect.extend({
    _toThrowOnMatch() {
      throw new Error("boom from matcher");
    },
  });
  // @ts-expect-error: _toThrowOnMatch is registered dynamically via expect.extend
  const matcher = expect._toThrowOnMatch();
  expect(() => matcher.asymmetricMatch({})).toThrow("boom from matcher");
});
