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
    (pass) concurrent describe 1 > item 1
    (pass) concurrent describe 1 > item 2
    error: Snapshot matchers are not supported in concurrent tests
    Snapshot matchers are not supported in concurrent tests
    (fail) concurrent describe 1 > snapshot in concurrent group
    (pass) LINE 66
    (skip) LINE 67
    (fail) LINE 68
      ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works
    (todo) LINE 69
    (pass) LINE 70
    (pass) LINE 70
    (pass) LINE 70
    (pass) LINE 71
    (skip) LINE 72
    (pass) LINE 74
    (todo) failing todo passes
    (pass) failing failing passes
    (fail) this test times out
      ^ this test timed out.
    (fail) this test times out with done
      ^ this test timed out before the done callback was called. If a done callback was not intended, remove the last parameter from the test callback function
    (pass) addition 1 + 2 = 3
    (pass) addition 2 + 3 = 5
    (pass) addition 3 + 4 = 7
    AssertionError: expected 1 assertion, but test ended with 0 assertions
    (fail) expect.assertions
    (pass) expect.assertions not yet supported in concurrent tests
    (pass) expect.assertions not yet supported in concurrent tests
    (pass) expect.assertions works
    (pass) more functions called after delayed done
    (pass) another test
    (pass) misattributed error
    (pass) passes because it catches the misattributed error

     20 pass
     2 skip
     2 todo
     6 fail
     1 error
     1 snapshots, 9 expect() calls
    Ran 30 tests across 1 file."
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
    async describe 6
    LINE 66
    LINE 68
    LINE 70 1
    LINE 70 2
    LINE 70 3
    LINE 71
    LINE 74
    adding: 1 + 2 = 3
    adding: 2 + 3 = 5
    adding: 3 + 4 = 7"
    ,
    }
  `);
});
