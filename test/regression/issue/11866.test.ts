import { expect, test } from "bun:test";
import { bunRun } from "harness";
import { join } from "node:path";

test.concurrent("https://github.com/oven-sh/bun/issues/11866", async () => {
  expect(await bunRun(join(import.meta.dirname, "11866.ts"))).toSpawn();
});
