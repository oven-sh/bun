import { expect, test } from "bun:test";

test("expect.unreachable()", () => {
  expect(expect.unreachable).toBeTypeOf("function");
  expect(() => expect.unreachable("message here")).toThrow("message here");
  const error = new Error("message here");
  expect(() => expect.unreachable(error)).toThrow(error);
  expect(() => expect.unreachable()).toThrow("reached unreachable code");
});
