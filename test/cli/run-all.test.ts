import { describe, test, expect } from "bun:test";
import { bunExe, bunEnv, tempDirWithFiles } from "harness";

describe("bun run --all", () => {
  test("should run multiple scripts sequentially", async () => {
    const dir = tempDirWithFiles("run-all-basic", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {
          "test:unit": 'echo "Running unit tests"',
          "test:integration": 'echo "Running integration tests"',
          "build": 'echo "Building project"',
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "test:unit", "test:integration"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Running unit tests");
    expect(stdout).toContain("Running integration tests");
    expect(stderr).toBe("");
  });

  test("should support pattern matching with :*", async () => {
    const dir = tempDirWithFiles("run-all-pattern", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {
          "test:unit": 'echo "Unit tests"',
          "test:integration": 'echo "Integration tests"',
          "test:e2e": 'echo "E2E tests"',
          "build": 'echo "Building"',
          "lint": 'echo "Linting"',
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "test:*"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Unit tests");
    expect(stdout).toContain("Integration tests");
    expect(stdout).toContain("E2E tests");
    expect(stdout).not.toContain("Building");
    expect(stdout).not.toContain("Linting");
    expect(stderr).toBe("");
  });

  test("should support pattern matching with : suffix", async () => {
    const dir = tempDirWithFiles("run-all-colon", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {
          "build:dev": 'echo "Dev build"',
          "build:prod": 'echo "Prod build"',
          "build:staging": 'echo "Staging build"',
          "test": 'echo "Testing"',
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "build:"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Dev build");
    expect(stdout).toContain("Prod build");
    expect(stdout).toContain("Staging build");
    expect(stdout).not.toContain("Testing");
    expect(stderr).toBe("");
  });

  test("should run source files when specified", async () => {
    const dir = tempDirWithFiles("run-all-files", {
      "script1.js": 'console.log("Script 1 executed");',
      "script2.js": 'console.log("Script 2 executed");',
      "package.json": JSON.stringify({
        name: "test-package",
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "script1.js", "script2.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Script 1 executed");
    expect(stdout).toContain("Script 2 executed");
    expect(stderr).toBe("");
  });

  test("should handle mix of scripts and files", async () => {
    const dir = tempDirWithFiles("run-all-mixed", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {
          "build": 'echo "Building"',
        },
      }),
      "test.js": 'console.log("Test file executed");',
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "build", "test.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Building");
    expect(stdout).toContain("Test file executed");
    expect(stderr).toBe("");
  });

  test("should error when no targets provided", async () => {
    const dir = tempDirWithFiles("run-all-no-targets", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {
          "test": 'echo "Testing"',
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--all flag requires at least one target");
  });

  test("should continue execution when one target fails", async () => {
    const dir = tempDirWithFiles("run-all-failure", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {
          "success1": 'echo "Success 1"',
          "failure": "exit 1",
          "success2": 'echo "Success 2"',
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "success1", "failure", "success2"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).not.toBe(0); // Should fail overall
    expect(stdout).toContain("Success 1");
    expect(stdout).toContain("Success 2");
    expect(stderr).toContain("failure"); // Should report the failed target
  });

  test("should handle pattern that matches no scripts", async () => {
    const dir = tempDirWithFiles("run-all-no-match", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {
          "build": 'echo "Building"',
          "test": 'echo "Testing"',
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "deploy:*"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("No targets found matching the given patterns");
  });

  test("should work without package.json when running files", async () => {
    const dir = tempDirWithFiles("run-all-no-package", {
      "app.js": 'console.log("App running");',
      "server.js": 'console.log("Server running");',
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "app.js", "server.js"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("App running");
    expect(stdout).toContain("Server running");
    expect(stderr).toBe("");
  });

  test("should execute scripts in order", async () => {
    const dir = tempDirWithFiles("run-all-order", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {
          "first": 'echo "First script"',
          "second": 'echo "Second script"',
          "third": 'echo "Third script"',
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "first", "second", "third"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    const lines = stdout.trim().split('\n');
    expect(lines).toContain("First script");
    expect(lines).toContain("Second script");
    expect(lines).toContain("Third script");
    
    // Check order (allowing for some output variation)
    const firstIndex = lines.findIndex(line => line.includes("First script"));
    const secondIndex = lines.findIndex(line => line.includes("Second script"));
    const thirdIndex = lines.findIndex(line => line.includes("Third script"));
    
    expect(firstIndex).toBeLessThan(secondIndex);
    expect(secondIndex).toBeLessThan(thirdIndex);
  });

  test("should handle complex patterns with multiple matches", async () => {
    const dir = tempDirWithFiles("run-all-complex", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {
          "test:unit:fast": 'echo "Fast unit tests"',
          "test:unit:slow": 'echo "Slow unit tests"',
          "test:integration:api": 'echo "API integration tests"',
          "test:integration:ui": 'echo "UI integration tests"',
          "build:dev": 'echo "Dev build"',
          "build:prod": 'echo "Prod build"',
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "test:unit:", "test:integration:"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Fast unit tests");
    expect(stdout).toContain("Slow unit tests");
    expect(stdout).toContain("API integration tests");
    expect(stdout).toContain("UI integration tests");
    expect(stdout).not.toContain("Dev build");
    expect(stdout).not.toContain("Prod build");
    expect(stderr).toBe("");
  });
});