import { test, expect } from "bun:test";

test("bun-file-exists", async () => {
  expect(await Bun.file(import.meta.path).exists()).toBeTrue();
  expect(await Bun.file(import.meta.path + "boop").exists()).toBeFalse();
  expect(await Bun.file(import.meta.dir).exists()).toBeFalse();
  expect(await Bun.file(import.meta.dir + "/").exists()).toBeFalse();
});
