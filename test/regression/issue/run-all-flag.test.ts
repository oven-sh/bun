import { describe, test, expect } from "bun:test";
import { bunExe, bunEnv, tempDirWithFiles } from "harness";

describe("bun run --all regression tests", () => {
  test("should be a drop-in replacement for npm-run-all basic usage", async () => {
    // This test ensures --all flag works like npm-run-all
    const dir = tempDirWithFiles("npm-run-all-compat", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {
          "clean": 'echo "Cleaning..."',
          "build": 'echo "Building..."',
          "test": 'echo "Testing..."',
        },
      }),
    });

    // Test equivalent to: npm-run-all clean build test
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "clean", "build", "test"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Cleaning...");
    expect(stdout).toContain("Building...");
    expect(stdout).toContain("Testing...");
    expect(stderr).toBe("");
  });

  test("should support npm-run-all pattern syntax", async () => {
    // Test equivalent to: npm-run-all "test:*"
    const dir = tempDirWithFiles("npm-run-all-pattern", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {
          "test:unit": 'echo "Unit tests"',
          "test:integration": 'echo "Integration tests"',
          "test:e2e": 'echo "E2E tests"',
          "build": 'echo "Building"',
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
    expect(stderr).toBe("");
  });

  test("should work with typical build pipeline", async () => {
    // Real-world usage example
    const dir = tempDirWithFiles("build-pipeline", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {
          "clean": 'echo "🧹 Cleaning dist/"',
          "lint": 'echo "🔍 Linting code"',
          "typecheck": 'echo "🔍 Type checking"', 
          "build:lib": 'echo "📦 Building library"',
          "build:docs": 'echo "📚 Building docs"',
          "test:unit": 'echo "🧪 Running unit tests"',
          "test:integration": 'echo "🔧 Running integration tests"',
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "clean", "lint", "typecheck", "build:*", "test:*"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("🧹 Cleaning dist/");
    expect(stdout).toContain("🔍 Linting code");
    expect(stdout).toContain("🔍 Type checking");
    expect(stdout).toContain("📦 Building library");
    expect(stdout).toContain("📚 Building docs");
    expect(stdout).toContain("🧪 Running unit tests");
    expect(stdout).toContain("🔧 Running integration tests");
    expect(stderr).toBe("");
  });

  test("should handle failure gracefully like npm-run-all", async () => {
    const dir = tempDirWithFiles("failure-handling", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {
          "step1": 'echo "Step 1 success"',
          "step2": 'echo "Step 2 fail" && exit 1',
          "step3": 'echo "Step 3 success"',
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "step1", "step2", "step3"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).not.toBe(0); // Should fail overall
    expect(stdout).toContain("Step 1 success");
    expect(stdout).toContain("Step 3 success"); // Should continue after failure
    expect(stderr).toContain("step2"); // Should report which step failed
  });

  test("should preserve script execution order", async () => {
    const dir = tempDirWithFiles("execution-order", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {
          "a": 'echo "A" && sleep 0.05',
          "b": 'echo "B" && sleep 0.05',
          "c": 'echo "C" && sleep 0.05',
          "d": 'echo "D" && sleep 0.05',
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "a", "b", "c", "d"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    
    // Extract the letters in order they appear in output
    const lines = stdout.split('\n').filter(line => line.trim().match(/^[ABCD]$/));
    expect(lines).toEqual(['A', 'B', 'C', 'D']);
    expect(stderr).toBe("");
  });

  test("should work without explicit run command", async () => {
    // Test equivalent to: bun --all script1 script2
    const dir = tempDirWithFiles("implicit-run", {
      "package.json": JSON.stringify({
        name: "test-package",
        scripts: {
          "start": 'echo "Starting app"',
          "dev": 'echo "Development mode"',
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--all", "start", "dev"],
      env: bunEnv,
      cwd: dir,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Starting app");
    expect(stdout).toContain("Development mode");
    expect(stderr).toBe("");
  });

  test("should handle workspace scenarios", async () => {
    // Simulate monorepo workspace scenario
    const dir = tempDirWithFiles("workspace-scenario", {
      "package.json": JSON.stringify({
        name: "monorepo-root",
        scripts: {
          "build:ui": 'echo "Building UI package"',
          "build:api": 'echo "Building API package"',
          "build:shared": 'echo "Building shared package"',
          "test:ui": 'echo "Testing UI package"',
          "test:api": 'echo "Testing API package"',
          "lint:ui": 'echo "Linting UI package"',
          "lint:api": 'echo "Linting API package"',
        },
      }),
    });

    // Build all packages
    await using buildProc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "build:*"],
      env: bunEnv,
      cwd: dir,
    });

    const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
      new Response(buildProc.stdout).text(),
      new Response(buildProc.stderr).text(),
      buildProc.exited,
    ]);

    expect(buildExitCode).toBe(0);
    expect(buildStdout).toContain("Building UI package");
    expect(buildStdout).toContain("Building API package");
    expect(buildStdout).toContain("Building shared package");

    // Test all packages
    await using testProc = Bun.spawn({
      cmd: [bunExe(), "run", "--all", "test:*"],
      env: bunEnv,
      cwd: dir,
    });

    const [testStdout, testStderr, testExitCode] = await Promise.all([
      new Response(testProc.stdout).text(),
      new Response(testProc.stderr).text(),
      testProc.exited,
    ]);

    expect(testExitCode).toBe(0);
    expect(testStdout).toContain("Testing UI package");
    expect(testStdout).toContain("Testing API package");
  });
});