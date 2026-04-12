import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

test("describe/test", async () => {
  const result = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/bun_test.fixture.ts"],
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
    "test/js/bun/test/bun_test.fixture.ts:

    # Unhandled error between tests
    -------------------------------
    45 |     });
    46 |   });
    47 |   describe("failed describe inner 2", () => {
    48 |     console.log("failed describe inner 2");
    49 |   });
    50 |   throw "failed describe: error";
                 ^
    error: failed describe: error
        at <anonymous> (file:NN:NN)
    -------------------------------

    error: uh oh
    uh oh
    (fail) actual tests > more functions called after delayed done
    (pass) actual tests > another test
    (pass) concurrent describe 1 > item 1
    (pass) concurrent describe 1 > item 2
    (pass) concurrent describe 1 > snapshot in concurrent group
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
      ^ this test timed out after 1ms.
    (fail) this test times out with done
      ^ this test timed out after 1ms, before its done callback was called. If a done callback was not intended, remove the last parameter from the test callback function
    (pass) addition 1 + 2 = 3
    (pass) addition 2 + 3 = 5
    (pass) addition 3 + 4 = 7
    AssertionError: expected 1 assertion, but test ended with 0 assertions
    (fail) expect.assertions
    (pass) expect.assertions not yet supported in concurrent tests
    (pass) expect.assertions not yet supported in concurrent tests
    (pass) expect.assertions works
    (fail) expect.assertions combined with timeout
      ^ this test timed out after 1ms.
    (pass) more functions called after delayed done
    (pass) another test
    (pass) misattributed error
    (pass) passes because it catches the misattributed error
    (pass) hooks > test1
    (pass) hooks > test2
    (pass) done parameter > instant done
    (pass) done parameter > delayed done
    (pass) done parameter > done combined with promise > done combined with promise, promise resolves first
    (pass) done parameter > done combined with promise > done combined with promise, done resolves first
    224 |   });
    225 |   describe("done combined with promise", () => {
    226 |     let completion = 0;
    227 |     beforeEach(() => (completion = 0));
    228 |     afterEach(() => {
    229 |       if (completion != 2) throw "completion is not 2";
                                           ^
    error: completion is not 2
        at <anonymous> (file:NN:NN)
    (fail) done parameter > done combined with promise > fails when completion is not incremented
    error: test error
    test error
    error: promise error
    promise error
    (fail) done parameter > done combined with promise error conditions > both error and done resolves first
    error: done error
    done error
    (fail) done parameter > done combined with promise error conditions > done errors only
    error: promise error
    promise error
    (fail) done parameter > done combined with promise error conditions > promise errors only
    (pass) done parameter > second call of done callback ignores triggers error
    (pass) microtasks and rejections are drained after the test callback is executed
    (pass) after inside test > the test 1
    (pass) after inside test > the test 2
    (pass) beforeEach inside test fails

    2 tests skipped:
    (skip) LINE 67
    (skip) LINE 72


    2 tests todo:
    (todo) LINE 69
    (todo) failing todo passes


    10 tests failed:
    (fail) actual tests > more functions called after delayed done
    (fail) LINE 68
      ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works
    (fail) this test times out
      ^ this test timed out after 1ms.
    (fail) this test times out with done
      ^ this test timed out after 1ms, before its done callback was called. If a done callback was not intended, remove the last parameter from the test callback function
    (fail) expect.assertions
    (fail) expect.assertions combined with timeout
      ^ this test timed out after 1ms.
    (fail) done parameter > done combined with promise > fails when completion is not incremented
    (fail) done parameter > done combined with promise error conditions > both error and done resolves first
    (fail) done parameter > done combined with promise error conditions > done errors only
    (fail) done parameter > done combined with promise error conditions > promise errors only

     32 pass
     2 skip
     2 todo
     10 fail
     1 error
     2 snapshots, 10 expect() calls
    Ran 46 tests across 1 file."
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
    snapshot in concurrent group
    LINE 66
    LINE 68
    LINE 70 1
    LINE 70 2
    LINE 70 3
    LINE 71
    LINE 74
    adding: 1 + 2 = 3
    adding: 2 + 3 = 5
    adding: 3 + 4 = 7
    beforeAll1
    beforeAll2
    beforeEach1
    beforeEach2
    test1
    afterEach1
    afterEach2
    beforeEach1
    beforeEach2
    test2
    afterEach1
    afterEach2
    afterAll1
    afterAll2
    after-inside-test: the test 1
    after-inside-test: afterAll1
    after-inside-test: afterEach1
    after-inside-test: afterEach3
    after-inside-test: the test 2
    after-inside-test: afterAll2
    after-inside-test: afterEach2
    after-inside-test: afterEach3
    after-inside-test: afterAll3"
    ,
    }
  `);
});

test("cross-file safety", async () => {
  const result = await Bun.spawn({
    cmd: [
      bunExe(),
      "test",
      import.meta.dir + "/cross-file-safety/test1.ts",
      import.meta.dir + "/cross-file-safety/test2.ts",
    ],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();
  expect(stderr).toInclude("Snapshot matchers cannot be used outside of a test");
  expect(exitCode).toBe(1);
});

test("multi-file", async () => {
  const result = await Bun.spawn({
    cmd: [
      bunExe(),
      "test",
      import.meta.dir + "/scheduling/multi-file/test1.fixture.ts",
      import.meta.dir + "/scheduling/multi-file/test2.fixture.ts",
      "--preload",
      import.meta.dir + "/scheduling/multi-file/preload.ts",
    ],
    stdio: ["pipe", "pipe", "pipe"],
    env: bunEnv,
  });

  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();
  expect(exitCode).toBe(0);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    preload: before first file
    preload: beforeEach
    test1
    preload: afterEach
    preload: beforeEach
    test2
    preload: afterEach
    preload: after last file"
  `);
});

test("--only flag with multiple files", async () => {
  const result = await Bun.spawn({
    cmd: [
      bunExe(),
      "test",
      import.meta.dir + "/only-flag-fixtures/file0.fixture.ts",
      import.meta.dir + "/only-flag-fixtures/file1.fixture.ts",
      import.meta.dir + "/only-flag-fixtures/file2.fixture.ts",
      "--only",
    ],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...bunEnv, CI: "false" },
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  // Should only run test 1.0 which has `.only()`
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    file1.0 (only)"
  `);
  expect(exitCode).toBe(0);
});

test("no --only flag with multiple files", async () => {
  const result = await Bun.spawn({
    cmd: [
      bunExe(),
      "test",
      import.meta.dir + "/only-flag-fixtures/file0.fixture.ts",
      import.meta.dir + "/only-flag-fixtures/file1.fixture.ts",
      import.meta.dir + "/only-flag-fixtures/file2.fixture.ts",
    ],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...bunEnv, CI: "false" },
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();

  // Should run tests from other files, but only test 1.0 for file1.test.ts
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    file0.0
    file0.1
    file1.0 (only)
    file2.0
    file2.1"
  `);
  expect(exitCode).toBe(0);
});
