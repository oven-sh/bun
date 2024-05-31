import { test, expect } from "bun:test";
import { join } from "path";

test("issue #11297", async () => {
  expect([join(import.meta.dir, "./11297.fixture.ts")]).toRun();
});
