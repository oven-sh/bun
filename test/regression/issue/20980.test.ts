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
    "(fail) test/regression/issue/20980.fixture.ts:
    (fail) test 0

    1 test failed:

    (fail) test/regression/issue/20980.fixture.ts > test 0
    error: 5
    5

     0 pass
     1 fail
    Ran 1 test across 1 file."
  `);
});
