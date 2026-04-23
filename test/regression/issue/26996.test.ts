import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/26996
// Error messages should say "Received value" (the value passed to expect()),
// not "Expected value" (which refers to the matcher argument in testing terminology).

test("toThrow on non-function says 'Received value'", () => {
  try {
    expect(123).toThrow(Error);
    throw new Error("should not reach here");
  } catch (e: any) {
    expect(e.message).toBe("Received value must be a function");
  }
});

test("toHaveBeenCalled on non-mock says 'Received value'", () => {
  try {
    expect(123).toHaveBeenCalled();
    throw new Error("should not reach here");
  } catch (e: any) {
    expect(e.message).toContain("Received value must be a mock function");
  }
});

test("toHaveBeenCalledTimes on non-mock says 'Received value'", () => {
  try {
    expect(123).toHaveBeenCalledTimes(1);
    throw new Error("should not reach here");
  } catch (e: any) {
    expect(e.message).toContain("Received value must be a mock function");
  }
});

test("toContainKey on non-object says 'Received value'", () => {
  try {
    expect(123).toContainKey("foo");
    throw new Error("should not reach here");
  } catch (e: any) {
    expect(e.message).toContain("Received value must be an object");
  }
});
