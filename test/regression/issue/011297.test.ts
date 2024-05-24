import { test, expect } from "bun:test";
import { bunExe, isWindows } from "harness";
import { join } from "path";
import "harness";

test("issue #11297", async () => {
  expect([join(import.meta.dir, "./011297.fixture.ts")]).toRun();
});
