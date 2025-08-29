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
      "exitCode": 0,
      "stderr": 
    "test/js/bun/test/describe2.fixture.ts:

     0 pass
     0 fail
    Ran 0 tests across 1 file."
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
