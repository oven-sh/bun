import { expect, test } from "bun:test";

test("expect.unreachable()", () => {
  expect(expect.unreachable).toBeTypeOf("function");
  expect(() => expect.unreachable("message here")).toThrow("message here");
  const error = new Error("message here");
  expect(() => expect.unreachable(error)).toThrow(error);
  expect(() => expect.unreachable()).toThrow("reached unreachable code");
});

test("expect.unreachable('') throws an UnreachableError with an empty message", () => {
  let error: Error | undefined;
  try {
    expect.unreachable("");
  } catch (e) {
    error = e as Error;
  }
  expect(error).toBeInstanceOf(Error);
  expect(error!.name).toBe("UnreachableError");
  expect(error!.message).toBe("");
});
