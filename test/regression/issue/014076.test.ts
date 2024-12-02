import { test, expect } from "bun:test";

test("resolves not toThrow", async () => {
  await expect(Promise.resolve("hello, world")).resolves.not.toThrow();
  await expect(
    (async () => {
      await expect(Promise.resolve("hello, world")).resolves.toThrow();
    })(),
  ).rejects.toBeInstanceOf(Error);

  await expect(
    (async () => {
      await expect(Promise.resolve(new Error("abc"))).resolves.not.toThrow("abc");
    })(),
  ).rejects.toBeInstanceOf(Error);

  await expect(Promise.resolve(new Error("abc"))).resolves.toThrow("abc");
  await expect(Promise.reject(new Error("abc"))).rejects.toThrow("abc");
});
