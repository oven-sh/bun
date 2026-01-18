import { $ } from "bun";
import { expect, test } from "bun:test";
import { tempDir } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/25885
// Shell command resolution should respect PATH set via .env()
test("shell respects PATH set via .env() for command resolution", async () => {
  using dir = tempDir("shell-path-env", {
    "mytest": '#!/bin/bash\necho "hello from mytest"',
  });

  // Make the script executable
  await $`chmod +x ${String(dir)}/mytest`.quiet();

  const enhancedPath = `${String(dir)}:${process.env.PATH}`;

  // Both `which` builtin and direct command execution should find the binary
  const whichResult = await $`which mytest`.env({ ...process.env, PATH: enhancedPath }).quiet();
  expect(whichResult.stdout.toString().trim()).toBe(`${String(dir)}/mytest`);

  // This was the bug: direct execution failed even though `which` worked
  const execResult = await $`mytest`.env({ ...process.env, PATH: enhancedPath }).quiet();
  expect(execResult.stdout.toString().trim()).toBe("hello from mytest");
  expect(execResult.exitCode).toBe(0);
});

test("shell respects PATH set via export for command resolution", async () => {
  using dir = tempDir("shell-path-export", {
    "mytest2": '#!/bin/bash\necho "hello from mytest2"',
  });

  // Make the script executable
  await $`chmod +x ${String(dir)}/mytest2`.quiet();

  const enhancedPath = `${String(dir)}:${process.env.PATH}`;

  // Test with export (export_env)
  const result = await $`export PATH=${enhancedPath}; mytest2`.quiet();
  expect(result.stdout.toString().trim()).toBe("hello from mytest2");
  expect(result.exitCode).toBe(0);
});

test("shell PATH lookup priority: cmd_local_env > export_env", async () => {
  using dir1 = tempDir("shell-path-priority-1", {
    "prioritytest": '#!/bin/bash\necho "from dir1"',
  });
  using dir2 = tempDir("shell-path-priority-2", {
    "prioritytest": '#!/bin/bash\necho "from dir2"',
  });

  await $`chmod +x ${String(dir1)}/prioritytest`.quiet();
  await $`chmod +x ${String(dir2)}/prioritytest`.quiet();

  // cmd_local_env (PATH=x command) should take priority over export_env
  const path1 = `${String(dir1)}:${process.env.PATH}`;
  const path2 = `${String(dir2)}:${process.env.PATH}`;

  // export sets export_env, then PATH=x sets cmd_local_env for that command
  // cmd_local_env should win for command resolution
  const result = await $`export PATH=${path2}; PATH=${path1} prioritytest`.quiet();
  expect(result.stdout.toString().trim()).toBe("from dir1");
});
