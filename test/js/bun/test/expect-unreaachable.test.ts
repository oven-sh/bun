import { expect, test } from "bun:test";

test("expect.unreachable()", () => {
  expect(expect.unreachable).toBeTypeOf("function");
  expect(() => expect.unreachable("message here")).toThrow("message here");
  const error = new Error("message here");
  expect(() => expect.unreachable(error)).toThrow(error);
  expect(() => expect.unreachable()).toThrow("reached unreachable code");
});

test("expect.unreachable() with an empty message", () => {
  // Creating an error from an empty user-provided string must not crash
  let thrown: Error | undefined;
  try {
    expect.unreachable("");
  } catch (e) {
    thrown = e as Error;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect(thrown!.name).toBe("UnreachableError");
  expect(thrown!.message).toBe("");
});
