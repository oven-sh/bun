import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

test.concurrent("concurrent order", async () => {
  const result = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/concurrent.fixture.ts"],
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
      "exitCode": 0,
      "stderr": 
    "test/js/bun/test/concurrent.fixture.ts:
    (pass) test 1
    (pass) test 2
    (pass) test 3
    (pass) test 4
    (pass) test 5
    (pass) test 6
    (pass) describe group 7 > test 7
    (pass) describe group 8 > test 8

     8 pass
     0 fail
    Ran 8 tests across 1 file."
    ,
      "stdout": 
    "bun test <version> (<revision>)
    [0] start test 1
    [1] end test 1
    --- concurrent boundary ---
    [0] start test 2
    [0] start test 3
    [1] end test 2
    [2] end test 3
    --- concurrent boundary ---
    [0] start test 5
    [0] start test 6
    [0] start before test 7
    [0] start test 8
    [1] end test 5
    [2] end test 6
    [3] end before test 7
    [3] start test 7
    [4] end test 7
    [5] end test 8"
    ,
    }
  `);
});

test.concurrent("concurrent-and-serial --concurrent", async () => {
  const result = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/concurrent-and-serial.fixture.ts", "--concurrent"],
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
    [0] start test default-1
    [0] start test default-2
    [0] start test concurrent-1
    [0] start test concurrent-2
    [1] end test default-1
    [1] end test default-2
    [1] end test concurrent-1
    [1] end test concurrent-2
    [0] start test serial-1
    [1] end test serial-1
    [0] start test serial-2
    [1] end test serial-2"
  `);
});

test.concurrent("concurrent-and-serial, no flag", async () => {
  const result = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/concurrent-and-serial.fixture.ts"],
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
    [0] start test default-1
    [1] end test default-1
    [0] start test default-2
    [1] end test default-2
    [0] start test concurrent-1
    [0] start test concurrent-2
    [1] end test concurrent-1
    [1] end test concurrent-2
    [0] start test serial-1
    [1] end test serial-1
    [0] start test serial-2
    [1] end test serial-2"
  `);
});

test.concurrent("max-concurrency limits concurrent tests", async () => {
  // Test with max-concurrency=3
  const result = await Bun.spawn({
    cmd: [bunExe(), "test", "--max-concurrency", "3", import.meta.dir + "/concurrent-max.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();

  expect(exitCode).toBe(0);

  // Extract max concurrent value from output
  const maxMatch = stdout.match(/Execution pattern: ([^\n]+)/);
  expect(maxMatch).toBeTruthy();
  const executionPattern = JSON.parse(maxMatch![1]);

  // Should be 1,2,3,3,3,3,3,...
  const expected = Array.from({ length: 100 }, (_, i) => Math.min(i + 1, 3));
  expect(executionPattern).toEqual(expected);
});

test.concurrent("max-concurrency default is 20", async () => {
  const result = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/concurrent-max.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();

  expect(exitCode).toBe(0);

  // Extract max concurrent value from output
  const maxMatch = stdout.match(/Execution pattern: ([^\n]+)/);
  expect(maxMatch).toBeTruthy();
  const executionPattern = JSON.parse(maxMatch![1]);

  // Should be 1,2,3,...,18,19,20,20,20,20,20,20,...
  const expected = Array.from({ length: 100 }, (_, i) => Math.min(i + 1, 20));
  expect(executionPattern).toEqual(expected);
});

test.concurrent("zero removes max-concurrency", async () => {
  const result = await Bun.spawn({
    cmd: [bunExe(), "test", "--max-concurrency", "0", import.meta.dir + "/concurrent-max.fixture.ts"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();

  expect(exitCode).toBe(0);

  // Extract max concurrent value from output
  const maxMatch = stdout.match(/Execution pattern: ([^\n]+)/);
  expect(maxMatch).toBeTruthy();
  const executionPattern = JSON.parse(maxMatch![1]);

  // Should be 1,2,3,...,18,19,20,20,20,20,20,20,...
  const expected = Array.from({ length: 100 }, (_, i) => i + 1);
  expect(executionPattern).toEqual(expected);
});
