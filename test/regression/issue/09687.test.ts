import { describe, expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/9687
describe("issue #9687 - expect().resolves.not.toThrow() fails incorrectly", () => {
  test("should not throw for async function that returns nothing", async () => {
    async function nop() {}
    await expect(nop()).resolves.not.toThrow();
  });

  test("should not throw for async function that returns a value", async () => {
    async function returnsValue() {
      return "hello";
    }
    await expect(returnsValue()).resolves.not.toThrow();
  });

  test("should not throw for Promise.resolve()", async () => {
    await expect(Promise.resolve()).resolves.not.toThrow();
  });

  test("should not throw for Promise.resolve(undefined)", async () => {
    await expect(Promise.resolve(undefined)).resolves.not.toThrow();
  });

  test("should not throw for Promise.resolve(null)", async () => {
    await expect(Promise.resolve(null)).resolves.not.toThrow();
  });

  test("should correctly detect when promise resolves to a thrown value", async () => {
    async function throwsError() {
      throw new Error("test error");
    }
    await expect(throwsError()).rejects.toThrow("test error");
  });

  test("should pass when expecting a resolved promise to throw", async () => {
    // This should fail the assertion
    await expect(
      (async () => {
        await expect(Promise.resolve("value")).resolves.toThrow();
      })(),
    ).rejects.toBeInstanceOf(Error);
  });
});
