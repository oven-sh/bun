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

// No test name is long enough for a{4294967295}b or x{4294967295}. The pattern is valid all the same:
// that alternative never matches, and the other one selects a test.
test.concurrent.each(["should run test 2|a{4294967295}b", "(?:z)?x{4294967295}|should run test 2"])(
  "-t %s",
  async pattern => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", join(import.meta.dirname, "test-filter-lifecycle.js"), "-t", pattern],
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      env: bunEnv,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const output = normalizeBunSnapshot(stdout + stderr);
    expect(output).toContain("(pass) parent > should run > test 2");
    expect(output).toContain(" 1 pass\n 5 filtered out\n 0 fail");
    expect(exitCode).toBe(0);
  },
);
