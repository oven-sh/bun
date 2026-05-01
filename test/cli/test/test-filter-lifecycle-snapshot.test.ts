import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";
import { join } from "node:path";

test("snapshot", () => {
  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "test", join(import.meta.dirname, "test-filter-lifecycle.js"), "-t", "should run test"],
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: bunEnv,
  });

  expect(normalizeBunSnapshot(stdout.toString() + stderr.toString())).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    <parent beforeAll>
    <beforeAll>
    <parent beforeEach>
    <beforeEach>
    <test 1>
    <afterEach>
    <parent afterEach>
    <parent beforeEach>
    <beforeEach>
    <test 2>
    <afterEach>
    <parent afterEach>
    <afterAll>
    <parent afterAll>

    test/cli/test/test-filter-lifecycle.js:
    (pass) parent > should run > test
    (pass) parent > should run > test 2

     2 pass
     4 filtered out
     0 fail
    Ran 2 tests across 1 file."
  `);
  expect(exitCode).toBe(0);
});
