import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("test.define in bunfig.toml", async () => {
  // Create a test directory with bunfig.toml and a test file
  const dir = tempDirWithFiles("bunfig-test-define", {
    "bunfig.toml": `
[test]
define = { "process.env.TEST_DEFINE" = '"from_bunfig_test"', "MY_GLOBAL" = '"hello_world"' }
`,
    "test.test.js": `
import { test, expect } from "bun:test";

test("define values are replaced", () => {
  expect(process.env.TEST_DEFINE).toBe("from_bunfig_test");
  expect(MY_GLOBAL).toBe("hello_world");
});
`,
  });

  // Run the test
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("1 pass");
  expect(stdout).toContain("define values are replaced");
});

test("test.define works alongside global define", async () => {
  // Create a test directory with bunfig.toml having both global and test-specific defines
  const dir = tempDirWithFiles("bunfig-test-and-global-define", {
    "bunfig.toml": `
# Global define
define = { "GLOBAL_VAR" = '"global_value"' }

[test]
# Test-specific define
define = { "TEST_VAR" = '"test_value"', "GLOBAL_VAR" = '"overridden_in_test"' }
`,
    "test.test.js": `
import { test, expect } from "bun:test";

test("both global and test defines work", () => {
  expect(TEST_VAR).toBe("test_value");
  // Test-specific define should override global define
  expect(GLOBAL_VAR).toBe("overridden_in_test");
});
`,
  });

  // Run the test
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("1 pass");
  expect(stdout).toContain("both global and test defines work");
});

test("test.define with different value types", async () => {
  // Create a test directory with various define value types
  const dir = tempDirWithFiles("bunfig-test-define-types", {
    "bunfig.toml": `
[test]
define = { "STRING_VAR" = '"hello"', "NUMBER_VAR" = '42', "BOOLEAN_VAR" = 'true', "NULL_VAR" = 'null', "UNDEFINED_VAR" = 'undefined', "OBJECT_VAR" = '{"key": "value"}', "ARRAY_VAR" = '[1, 2, 3]' }
`,
    "test.test.js": `
import { test, expect } from "bun:test";

test("different value types work correctly", () => {
  expect(STRING_VAR).toBe("hello");
  expect(NUMBER_VAR).toBe(42);
  expect(BOOLEAN_VAR).toBe(true);
  expect(NULL_VAR).toBe(null);
  expect(UNDEFINED_VAR).toBe(undefined);
  expect(OBJECT_VAR).toEqual({key: "value"});
  expect(ARRAY_VAR).toEqual([1, 2, 3]);
});
`,
  });

  // Run the test
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("1 pass");
  expect(stdout).toContain("different value types work correctly");
});
