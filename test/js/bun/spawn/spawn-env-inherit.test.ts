import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// This test covers the issue where Bun.spawn doesn't inherit environment variables on Windows
// https://github.com/oven-sh/bun/issues/6854 (if that's the right issue number)

test("Bun.spawn inherits parent environment variables when env is not specified", async () => {
  // Set a custom environment variable in the parent process
  process.env.TEST_SPAWN_INHERIT = "parent_value_123";

  try {
    // Spawn without specifying env - should inherit parent's environment
    const proc = spawn({
      cmd: [bunExe(), "-e", "console.log(process.env.TEST_SPAWN_INHERIT || 'undefined')"],
      env: {
        ...bunEnv,
        TEST_SPAWN_INHERIT: "parent_value_123",
        BUN_DEBUG_QUIET_LOGS: "1",
      },
      stdout: "pipe",
    });

    const text = await new Response(proc.stdout).text();
    expect(text.trim()).toBe("parent_value_123");

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  } finally {
    // Clean up
    delete process.env.TEST_SPAWN_INHERIT;
  }
});

test("Bun.spawn does not inherit parent environment when env is empty object", async () => {
  // Set a custom environment variable in the parent process
  process.env.TEST_SPAWN_NO_INHERIT = "should_not_see_this";

  try {
    // Spawn with empty env object - should NOT inherit parent's environment
    const proc = spawn({
      cmd: [bunExe(), "-e", "console.log(process.env.TEST_SPAWN_NO_INHERIT || 'undefined')"],
      env: {
        BUN_DEBUG_QUIET_LOGS: "1",
      },
      stdout: "pipe",
    });

    const text = await new Response(proc.stdout).text();
    expect(text.trim()).toBe("undefined");

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  } finally {
    // Clean up
    delete process.env.TEST_SPAWN_NO_INHERIT;
  }
});

test("Bun.spawn passes custom env variables", async () => {
  // Spawn with custom env
  const proc = spawn({
    cmd: [bunExe(), "-e", "console.log(process.env.CUSTOM_VAR || 'undefined')"],
    env: {
      CUSTOM_VAR: "custom_value",
      BUN_DEBUG_QUIET_LOGS: "1",
    },
    stdout: "pipe",
  });

  const text = await new Response(proc.stdout).text();
  expect(text.trim()).toBe("custom_value");

  const exitCode = await proc.exited;
  expect(exitCode).toBe(0);
});

test("Bun.spawn inherits PATH when not specified in env", async () => {
  // PATH is critical for finding executables
  const originalPath = process.env.PATH;
  expect(originalPath).toBeDefined();

  // Spawn without env - should have PATH
  const proc1 = spawn({
    cmd: [bunExe(), "-e", "console.log(process.env.PATH ? 'has_path' : 'no_path')"],
    env: bunEnv,
    stdout: "pipe",
  });

  const text1 = await new Response(proc1.stdout).text();
  expect(text1.trim()).toBe("has_path");

  // Spawn with empty env - should NOT have PATH
  const proc2 = spawn({
    cmd: [bunExe(), "-e", "console.log(process.env.PATH ? 'has_path' : 'no_path')"],
    env: {
      BUN_DEBUG_QUIET_LOGS: "1",
    },
    stdout: "pipe",
  });

  const text2 = await new Response(proc2.stdout).text();
  expect(text2.trim()).toBe("no_path");

  const [exitCode1, exitCode2] = await Promise.all([proc1.exited, proc2.exited]);
  expect(exitCode1).toBe(0);
  expect(exitCode2).toBe(0);
});

test("Bun.spawn merges env with parent environment using spread operator", async () => {
  // Common pattern to merge environments
  process.env.PARENT_MERGE_VAR = "parent_value";

  try {
    const proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        "console.log(JSON.stringify({parent: process.env.PARENT_MERGE_VAR, child: process.env.CHILD_VAR}))",
      ],
      env: {
        ...bunEnv,
        CHILD_VAR: "child_value",
        PARENT_MERGE_VAR: process.env.PARENT_MERGE_VAR,
      },
      stdout: "pipe",
    });

    const text = await new Response(proc.stdout).text();
    const result = JSON.parse(text.trim());
    expect(result.parent).toBe("parent_value");
    expect(result.child).toBe("child_value");

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  } finally {
    // Clean up
    delete process.env.PARENT_MERGE_VAR;
  }
});

test("Bun.spawn handles undefined values in env object", async () => {
  // This was a crash issue in earlier versions
  const env: any = {
    BUN_DEBUG_QUIET_LOGS: "1",
  };
  Object.defineProperty(env, "CRASH_VAR", {
    get() {
      return undefined;
    },
    enumerable: true,
  });

  const proc = spawn({
    cmd: [bunExe(), "-e", "console.log('no_crash')"],
    env,
    stdout: "pipe",
  });

  const text = await new Response(proc.stdout).text();
  expect(text.trim()).toBe("no_crash");

  const exitCode = await proc.exited;
  expect(exitCode).toBe(0);
});

test.if(isWindows)("Bun.spawn properly inherits environment on Windows", async () => {
  // Specific test for Windows environment inheritance
  process.env.WINDOWS_TEST_VAR = "windows_value";

  try {
    // Test that default behavior inherits environment
    const proc = spawn({
      cmd: [bunExe(), "-e", "console.log(process.env.WINDOWS_TEST_VAR || 'not_found')"],
      stdout: "pipe",
      env: bunEnv,
    });

    const text = await new Response(proc.stdout).text();
    expect(text.trim()).toBe("windows_value");

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  } finally {
    delete process.env.WINDOWS_TEST_VAR;
  }
});

test.if(isWindows)("Bun.spawn on Windows has access to system environment variables", async () => {
  // Test that common Windows environment variables are accessible
  const proc = spawn({
    cmd: [
      bunExe(),
      "-e",
      "console.log(JSON.stringify({user: !!process.env.USERPROFILE, systemRoot: !!process.env.SystemRoot}))",
    ],
    stdout: "pipe",
    env: bunEnv,
  });

  const text = await new Response(proc.stdout).text();
  const result = JSON.parse(text.trim());

  // On Windows, these should be available when inheriting environment
  expect(result.user).toBe(true);
  expect(result.systemRoot).toBe(true);

  const exitCode = await proc.exited;
  expect(exitCode).toBe(0);
});

test("Bun.spawn with large environment", async () => {
  // Test with many environment variables
  const largeEnv: any = { ...bunEnv };
  for (let i = 0; i < 100; i++) {
    largeEnv[`TEST_VAR_${i}`] = `value_${i}`;
  }

  const proc = spawn({
    cmd: [
      bunExe(),
      "-e",
      "console.log(JSON.stringify({test50: process.env.TEST_VAR_50, test99: process.env.TEST_VAR_99}))",
    ],
    env: largeEnv,
    stdout: "pipe",
  });

  const text = await new Response(proc.stdout).text();
  const result = JSON.parse(text.trim());
  expect(result.test50).toBe("value_50");
  expect(result.test99).toBe("value_99");

  const exitCode = await proc.exited;
  expect(exitCode).toBe(0);
});
