import { expect, test } from "bun:test";
import "harness";
import { join } from "node:path";

test("https://github.com/oven-sh/bun/issues/11866", async () => {
  expect([join(import.meta.dirname, "11866.ts")]).toRun();
});
