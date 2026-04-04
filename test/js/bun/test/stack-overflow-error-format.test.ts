import { expect, test } from "bun:test";

test("toHaveReturnedWith on non-mock formats error without crash", () => {
  const obj = { nested: { value: 42 }, fn: () => {} };
  expect(() => {
    expect(obj).toHaveReturnedWith();
  }).toThrow("Expected value must be a mock function");
});
