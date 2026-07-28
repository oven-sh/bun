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
    stdout | test/cli/test/test-filter-lifecycle.js > parent
    <parent beforeAll>
    stdout | test/cli/test/test-filter-lifecycle.js > parent > should run
    <beforeAll>
    stdout | test/cli/test/test-filter-lifecycle.js > parent > should run > test
    <parent beforeEach>
    <beforeEach>
    <test 1>
    <afterEach>
    <parent afterEach>
    stdout | test/cli/test/test-filter-lifecycle.js > parent > should run > test 2
    <parent beforeEach>
    <beforeEach>
    <test 2>
    <afterEach>
    <parent afterEach>
    stdout | test/cli/test/test-filter-lifecycle.js > parent > should run
    <afterAll>
    stdout | test/cli/test/test-filter-lifecycle.js > parent
    <parent afterAll>

    (pass) test/cli/test/test-filter-lifecycle.js:
    (pass) parent
      (pass) should run
        (pass) test
        (pass) test 2

     2 pass
     4 filtered out
     0 fail
    Ran 2 tests across 1 file."
  `);
  expect(exitCode).toBe(0);
});
