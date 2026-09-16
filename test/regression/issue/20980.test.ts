import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

// error in beforeEach should prevent the test from running
test("20980", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/20980.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  expect(exitCode).toBe(1);
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "test/regression/issue/20980.fixture.ts:
    1 | import { beforeEach, it, expect } from "bun:test";
    2 | beforeEach(async () => {
    3 |   await Bun.sleep(100);
    4 |   throw 5;
                ^
    error: 5
    5
        at <anonymous> (file:NN:NN)
    (fail) test 0

     0 pass
     1 fail
    Ran 1 test across 1 file."
  `);
});
