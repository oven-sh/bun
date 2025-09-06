import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("--no-env-file flag", () => {
  test("should not load .env files when --no-env-file is specified", async () => {
    using dir = tempDir("test-no-env", {
      ".env": "TEST_VAR=from_env_file",
      ".env.local": "LOCAL_VAR=from_local_file",
      ".env.development": "DEV_VAR=from_dev_file",
      "index.js": `
        console.log(JSON.stringify({
          TEST_VAR: process.env.TEST_VAR || 'undefined',
          LOCAL_VAR: process.env.LOCAL_VAR || 'undefined',
          DEV_VAR: process.env.DEV_VAR || 'undefined',
          PROCESS_VAR: process.env.PROCESS_VAR || 'undefined'
        }));
      `,
    });

    // Test without --no-env-file (should load .env files)
    await using proc1 = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: { ...bunEnv, PROCESS_VAR: "from_process" },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout1, stderr1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);

    expect(exitCode1).toBe(0);
    const result1 = JSON.parse(stdout1);
    expect(result1.TEST_VAR).toBe("from_env_file");
    expect(result1.LOCAL_VAR).toBe("from_local_file");
    expect(result1.DEV_VAR).toBe("from_dev_file");
    expect(result1.PROCESS_VAR).toBe("from_process");

    // Test with --no-env-file (should NOT load .env files)
    await using proc2 = Bun.spawn({
      cmd: [bunExe(), "--no-env-file", "index.js"],
      env: { ...bunEnv, PROCESS_VAR: "from_process" },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

    expect(exitCode2).toBe(0);
    const result2 = JSON.parse(stdout2);
    expect(result2.TEST_VAR).toBe("undefined");
    expect(result2.LOCAL_VAR).toBe("undefined");
    expect(result2.DEV_VAR).toBe("undefined");
    expect(result2.PROCESS_VAR).toBe("from_process"); // Process env should still work
  });

  test("--no-env-file should override --env-file", async () => {
    using dir = tempDir("test-no-env-file-override", {
      ".env.custom": "CUSTOM_VAR=from_custom_file",
      "index.js": `
        console.log(process.env.CUSTOM_VAR || 'undefined');
      `,
    });

    // Test with both --env-file and --no-env-file
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--env-file=.env.custom", "--no-env-file", "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("undefined");
  });

  test.todo("--no-env-file with bun test", async () => {
    using dir = tempDir("test-no-env-file-test", {
      ".env": "TEST_VAR=from_env_file",
      "test.test.js": `
        import { test, expect } from "bun:test";
        
        test("env test", () => {
          expect(process.env.TEST_VAR).toBeUndefined();
          expect(process.env.PROCESS_VAR).toBe("from_process");
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--no-env-file", "test", "test.test.js"],
      env: { ...bunEnv, PROCESS_VAR: "from_process" },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 pass");
  });

  test("--no-env-file with bun run script", async () => {
    using dir = tempDir("test-no-env-file-run", {
      ".env": "TEST_VAR=from_env_file",
      "package.json": JSON.stringify({
        scripts: {
          test: "node -e \"console.log(process.env.TEST_VAR || 'undefined')\"",
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--no-env-file", "run", "test"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("undefined");
  });
});

describe("env.file = false in bunfig.toml", () => {
  test("should not load .env files when env.file = false", async () => {
    using dir = tempDir("test-bunfig-env-false", {
      ".env": "TEST_VAR=from_env_file",
      ".env.local": "LOCAL_VAR=from_local_file",
      "bunfig.toml": `
[env]
file = false
      `,
      "index.js": `
        console.log(JSON.stringify({
          TEST_VAR: process.env.TEST_VAR || 'undefined',
          LOCAL_VAR: process.env.LOCAL_VAR || 'undefined',
          PROCESS_VAR: process.env.PROCESS_VAR || 'undefined'
        }));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: { ...bunEnv, PROCESS_VAR: "from_process" },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.TEST_VAR).toBe("undefined");
    expect(result.LOCAL_VAR).toBe("undefined");
    expect(result.PROCESS_VAR).toBe("from_process");
  });

  test("--env-file should override env.file = false", async () => {
    using dir = tempDir("test-bunfig-override", {
      ".env.custom": "CUSTOM_VAR=from_custom_file",
      "bunfig.toml": `
[env]
file = false
      `,
      "index.js": `
        console.log(process.env.CUSTOM_VAR || 'undefined');
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--env-file=.env.custom", "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("from_custom_file");
  });

  test("env.file = false should disable env loading", async () => {
    using dir = tempDir("test-bunfig-env-false-2", {
      ".env": "TEST_VAR=from_env_file",
      "bunfig.toml": `
[env]
file = false
      `,
      "index.js": `
        console.log(process.env.TEST_VAR || 'undefined');
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("undefined");
  });

  test.todo("bunfig with test command", async () => {
    using dir = tempDir("test-bunfig-test", {
      ".env.test": "TEST_VAR=from_test_env",
      "bunfig.toml": `
[env]
file = false
      `,
      "test.test.js": `
        import { test, expect } from "bun:test";
        
        test("env test", () => {
          expect(process.env.TEST_VAR).toBeUndefined();
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 pass");
  });
});
