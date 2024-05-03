import { $ } from "bun";
import { test, expect } from "bun:test";

test("$ with Bun.file prints the path", async () => {
  expect(await $`echo ${Bun.file(import.meta.path)}`.text()).toBe(`${import.meta.path}\n`);
  expect(await $`echo ${import.meta.path}`.text()).toBe(`${import.meta.path}\n`);
});
