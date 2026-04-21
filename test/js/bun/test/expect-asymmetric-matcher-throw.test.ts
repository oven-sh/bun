import { expect, test } from "bun:test";

expect.extend({
  customMatcherThatThrows() {
    throw new Error("thrown from custom matcher");
  },
});

test("asymmetricMatch() propagates exceptions thrown by custom matchers", () => {
  // @ts-expect-error
  const matcher = expect.customMatcherThatThrows();
  expect(() => matcher.asymmetricMatch({})).toThrow("thrown from custom matcher");
});

test("asymmetric custom matchers that throw surface as failures in deep equality", () => {
  // @ts-expect-error
  expect(() => expect({}).toEqual(expect.customMatcherThatThrows())).toThrow("thrown from custom matcher");
});
