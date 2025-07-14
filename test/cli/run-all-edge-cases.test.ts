import { describe, test, expect } from "bun:test";
import { bunExe, bunEnv, tempDirWithFiles } from "harness";

describe("bun run --all edge cases", () => {
  test("should handle empty scripts in package.json", async () => {
    const dir = tempDirWithFiles("run-all-empty-scripts", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {},
      }),
      "app.js": 'console.log("Running app");',
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "app.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Running app");
    expect(stderr).toBe("");
  });

  test("should handle scripts with special characters", async () => {
    const dir = tempDirWithFiles("run-all-special-chars", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {
          "test:with-dashes": 'echo "Test with dashes"',
          "test_with_underscores": 'echo "Test with underscores"',
          "test.with.dots": 'echo "Test with dots"',
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "test:with-dashes", "test_with_underscores", "test.with.dots"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Test with dashes");
    expect(stdout).toContain("Test with underscores");
    expect(stdout).toContain("Test with dots");
    expect(stderr).toBe("");
  });

  test("should handle very long script output", async () => {
    const dir = tempDirWithFiles("run-all-long-output", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {
          "long": 'for i in {1..100}; do echo "Line $i"; done',
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "long"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Line 1");
    expect(stdout).toContain("Line 100");
    expect(stderr).toBe("");
  });

  test("should handle scripts that take time", async () => {
    const dir = tempDirWithFiles("run-all-timing", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {
          "first": 'echo "Starting"; sleep 0.1; echo "First done"',
          "second": 'echo "Second done"',
        },
      }),
    });

    const startTime = Date.now();
    
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "first", "second"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const endTime = Date.now();
    
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Starting");
    expect(stdout).toContain("First done");
    expect(stdout).toContain("Second done");
    expect(endTime - startTime).toBeGreaterThan(90); // Should take at least 100ms
    expect(stderr).toBe("");
  });

  test("should handle absolute paths", async () => {
    const dir = tempDirWithFiles("run-all-absolute", {
      "script.js": 'console.log("Absolute path script");',
    });

    const absolutePath = `${dir}/script.js`;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", absolutePath],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Absolute path script");
    expect(stderr).toBe("");
  });

  test("should handle relative paths with ./", async () => {
    const dir = tempDirWithFiles("run-all-relative", {
      "script.js": 'console.log("Relative path script");',
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "./script.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Relative path script");
    expect(stderr).toBe("");
  });

  test("should handle non-existent scripts gracefully", async () => {
    const dir = tempDirWithFiles("run-all-nonexistent", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {
          "existing": 'echo "This exists"',
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "existing", "nonexistent"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).not.toBe(0);
    expect(stdout).toContain("This exists"); // Should run the existing script
    expect(stderr).toContain("nonexistent"); // Should report the error
  });

  test("should handle non-existent files gracefully", async () => {
    const dir = tempDirWithFiles("run-all-nonexistent-file", {
      "existing.js": 'console.log("This file exists");',
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "existing.js", "nonexistent.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).not.toBe(0);
    expect(stdout).toContain("This file exists"); // Should run the existing file
    expect(stderr).toContain("nonexistent.js"); // Should report the error
  });

  test("should handle patterns with no package.json", async () => {
    const dir = tempDirWithFiles("run-all-no-package-pattern", {
      "app.js": 'console.log("App running");',
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "test:*", "app.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // Should handle pattern as literal when no package.json
    // and continue with the file execution
    expect(stdout).toContain("App running");
    // May have warnings about test:* but should continue
  });

  test("should handle scripts with environment variables", async () => {
    const dir = tempDirWithFiles("run-all-env", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {
          "env-test": 'echo "NODE_ENV is $NODE_ENV"',
          "custom-env": 'echo "CUSTOM_VAR is $CUSTOM_VAR"',
        },
      }),
    });

    const customEnv = {
      ...bunEnv,
      NODE_ENV: "test",
      CUSTOM_VAR: "hello-world",
    };

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "env-test", "custom-env"],
      env: customEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("NODE_ENV is test");
    expect(stdout).toContain("CUSTOM_VAR is hello-world");
    expect(stderr).toBe("");
  });

  test("should handle scripts with complex commands", async () => {
    const dir = tempDirWithFiles("run-all-complex-cmd", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {
          "complex": 'echo "Start" && echo "Middle" && echo "End"',
          "with-pipe": 'echo "Hello World" | grep "World"',
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "complex", "with-pipe"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Start");
    expect(stdout).toContain("Middle");
    expect(stdout).toContain("End");
    expect(stdout).toContain("World");
    expect(stderr).toBe("");
  });

  test("should handle duplicate targets", async () => {
    const dir = tempDirWithFiles("run-all-duplicates", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {
          "test": 'echo "Running test"',
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "test", "test", "test"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    // Should run the script multiple times
    const testOutputs = (stdout.match(/Running test/g) || []).length;
    expect(testOutputs).toBe(3);
    expect(stderr).toBe("");
  });
});