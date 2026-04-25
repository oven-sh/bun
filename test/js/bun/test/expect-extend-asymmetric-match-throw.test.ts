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

test("asymmetricMatch propagates InvalidMatcherError when matcher returns a non-result object", () => {
  expect.extend({
    _toReturnInvalid(received) {
      // Returning another asymmetric matcher instead of { pass, message } triggers
      // the "Unexpected return from matcher function" error path.
      return expect.any(received);
    },
  });
  // @ts-expect-error: _toReturnInvalid is registered dynamically via expect.extend
  const matcher = expect._toReturnInvalid();
  expect(() => matcher.asymmetricMatch(expect)).toThrow(/Unexpected return from matcher function/);
});

test("custom asymmetric matcher that throws inside toEqual propagates the exception", () => {
  expect.extend({
    _toThrowInDeepEquals() {
      throw new Error("boom from deep-equals matcher");
    },
  });
  // @ts-expect-error: _toThrowInDeepEquals is registered dynamically via expect.extend
  const matcher = expect._toThrowInDeepEquals();
  // Using the matcher inside toEqual exercises the C++ matchAsymmetricMatcher path.
  expect(() => expect({ a: 1 }).toEqual({ a: matcher })).toThrow("boom from deep-equals matcher");
});

test("custom asymmetric matcher returning an invalid result inside toEqual propagates the exception", () => {
  expect.extend({
    _toReturnInvalidInDeepEquals(received) {
      return expect.any(received);
    },
  });
  // @ts-expect-error: _toReturnInvalidInDeepEquals is registered dynamically via expect.extend
  const matcher = expect._toReturnInvalidInDeepEquals();
  expect(() => expect({ a: Date }).toEqual({ a: matcher })).toThrow(/Unexpected return from matcher function/);
});
