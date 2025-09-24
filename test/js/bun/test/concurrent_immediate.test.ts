import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

test("describe/test", async () => {
  const result = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/concurrent_immediate.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();
  expect(exitCode).toBe(0);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    beforeEach
    start test 1
    afterEach
    beforeEach
    start test 2
    afterEach
    beforeEach
    start test 3
    afterEach"
    `);
});

test("describe/test", async () => {
  const result = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/concurrent_immediate_error.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();
  expect(exitCode).toBe(1);
  expect(normalizeBunSnapshot(stderr)).toMatchInlineSnapshot(`
    "test/js/bun/test/concurrent_immediate_error.fixture.ts:
    (pass) test 1
     6 | });
     7 | test.concurrent("test 1", () => {
     8 |   console.log("start test 1");
     9 | });
    10 | test.concurrent("test 2", () => {
    11 |   throw new Error("test 2 error");
                                         ^
    error: test 2 error
        at <anonymous> (file:NN:NN)
    (fail) test 2
    (pass) test 3

     2 pass
     1 fail
    Ran 3 tests across 1 file."
    `);
});
