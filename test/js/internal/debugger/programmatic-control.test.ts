import { expect, test, describe } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// PR1 tests: internal/debugger programmatic control
//
// PR1 adds these capabilities to internal/debugger.ts:
// 1. setInspectorUrl callback (reports real URL when port=0)
// 2. reportError callback (non-fatal error handling)
// 3. fatalOnError parameter
// 4. stop command (empty URL stops server)
// 5. activeDebugger global for safe multi-call
//
// These new parameters are optional with defaults, so existing CLI --inspect
// continues to work. The new callbacks will be used by node:inspector (PR2).
//
// These tests verify that:
// 1. Existing --inspect CLI functionality is not broken
// 2. port=0 works correctly (ephemeral port binding)
// 3. Process exits cleanly with inspector active

describe("internal/debugger programmatic control", () => {
  test("--inspect with port=0 starts successfully", async () => {
    using dir = tempDir("debugger-port0", {
      "test.js": `
        console.log("started");
        process.exit(0);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--inspect=0", "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // Should have started successfully
    expect(stdout).toContain("started");
    expect(exitCode).toBe(0);

    // If stderr contains inspector URL, verify port > 0
    const urlMatch = stderr.match(/ws:\/\/[\w.-]+:(\d+)\//);
    if (urlMatch) {
      const port = parseInt(urlMatch[1], 10);
      expect(port).toBeGreaterThan(0);
    }
  });

  test("--inspect starts without crashing", async () => {
    using dir = tempDir("debugger-basic", {
      "test.js": `
        console.log("inspector started");
        process.exit(0);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--inspect=0", "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, _stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout).toContain("inspector started");
    expect(exitCode).toBe(0);
  });

  test("process exits cleanly with inspector", async () => {
    using dir = tempDir("debugger-exit", {
      "test.js": `
        setTimeout(() => {
          console.log("done");
          process.exit(0);
        }, 100);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--inspect=0", "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, _stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout).toContain("done");
    expect(exitCode).toBe(0);
  });

  test("--inspect with specific host:port format works", async () => {
    using dir = tempDir("debugger-host-port", {
      "test.js": `
        console.log("host port test");
        process.exit(0);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--inspect=127.0.0.1:0", "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, _stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout).toContain("host port test");
    expect(exitCode).toBe(0);
  });

  test("multiple sequential inspector processes work", async () => {
    // This tests that inspector resources are properly cleaned up
    // between process runs (no port conflicts, no crashes)
    for (let i = 0; i < 2; i++) {
      using dir = tempDir(`debugger-sequential-${i}`, {
        "test.js": `
          console.log("run ${i}");
          process.exit(0);
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "--inspect=0", "test.js"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, _stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(stdout).toContain(`run ${i}`);
      expect(exitCode).toBe(0);
    }
  });
});
