import { expect, test } from "bun:test";
import { bunEnv } from "harness";
import path from "path";

test("--max-http-header-size=1024", async () => {
  const size = 1024;
  bunEnv.BUN_HTTP_MAX_HEADER_SIZE = size;
  expect(["--max-http-header-size=" + size, path.join(import.meta.dir, "max-header-size-fixture.ts")]).toRun();
});

test("--max-http-header-size=NaN", async () => {
  expect(["--max-http-header-size=" + "NaN", path.join(import.meta.dir, "max-header-size-fixture.ts")]).not.toRun();
});

test("--max-http-header-size=16*1024", async () => {
  const size = 16 * 1024;
  bunEnv.BUN_HTTP_MAX_HEADER_SIZE = size;
  expect(["--max-http-header-size=" + size, path.join(import.meta.dir, "max-header-size-fixture.ts")]).toRun();
});
