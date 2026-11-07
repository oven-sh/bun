import { expect, test } from "bun:test";
import { bunRun } from "harness";
import { join } from "path";

test.concurrent("issue #11297", async () => {
  const { stderr, exitCode } = await bunRun(join(import.meta.dir, "./11297.fixture.ts"));
  if (exitCode !== 0) console.error(stderr);
  expect(exitCode).toBe(0);
});
