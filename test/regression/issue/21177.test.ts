// https://github.com/oven-sh/bun/issues/21177
// beforeAll hooks should not run for describe blocks that have no tests matching the filter

import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

test("beforeAll should not run for unmatched describe blocks when using test filters", async () => {
  const testFile = join(import.meta.dir, "21177.fixture.js");

  await using proc = spawn({
    cmd: [bunExe(), "test", testFile, "-t", "true is true"],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);

  const output = stdout + stderr;

  // The beforeAll hook from "False assertion" describe block should NOT have run
  // because no tests from that block match the filter
  expect(output).not.toContain("Running False assertion tests...");

  // The test should have passed
  expect(output).toContain("1 pass");
  expect(output).toContain("1 filtered out");
});
