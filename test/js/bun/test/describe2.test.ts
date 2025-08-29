import { test, expect } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

test("describe/test", async () => {
  const result = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/describe2.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();
  expect({
    exitCode,
    stdout: normalizeBunSnapshot(stdout),
    stderr: normalizeBunSnapshot(stderr),
  }).toMatchInlineSnapshot(`
    {
      "exitCode": 1,
      "stderr": 
    "test/js/bun/test/describe2.fixture.ts:

    # Unhandled error between tests
    -------------------------------
    error: uh oh
    uh oh
    -------------------------------

    error: uh oh
    uh oh
    (fail) actual tests > more functions called after delayed done
    (pass) actual tests > another test

     1 pass
     1 fail
     1 error
    Ran 2 tests across 1 file."
    ,
      "stdout": 
    "bun test <version> (<revision>)
    enter
    exit
    describe 1
    describe 2
    describe 3
    describe 4
    describe 5
    describe 6
    describe 7
    describe 8
    describe each 1
    describe each 1a
    describe each 1b
    describe each 1c
    describe each 1d
    describe each 2
    describe each 2a
    describe each 2b
    describe each 2c
    describe each 2d
    describe each 3
    describe each 3a
    describe each 3b
    describe each 3c
    describe each 3d
    describe each 4
    describe each 4a
    describe each 4b
    describe each 4c
    describe each 4d
    failed describe
    async describe 1
    async describe 2
    async describe 3
    async describe 4
    async describe 5
    async describe 6"
    ,
    }
  `);
});
