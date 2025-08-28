import { test, expect } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

test("concurrent order", async () => {
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
