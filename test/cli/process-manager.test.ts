import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

describe("bun process manager", () => {
  test("bun start - starts a process", async () => {
    using dir = tempDir("process-manager-start", {
      "server.js": `
        console.log("Server started");
        setInterval(() => {}, 1000); // Keep alive
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "start", "server.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`"✓ Started: server.js"`);
    expect(exitCode).toBe(0);

    // Clean up - stop the process
    const stopProc = Bun.spawn({
      cmd: [bunExe(), "stop", "server.js"],
      env: bunEnv,
      cwd: String(dir),
    });
    await stopProc.exited;
  });

  test("bun list - lists running processes", async () => {
    using dir = tempDir("process-manager-list", {
      "worker.js": `
        console.log("Worker started");
        setInterval(() => {}, 1000);
      `,
    });

    // Start a process first
    const startProc = Bun.spawn({
      cmd: [bunExe(), "start", "worker.js"],
      env: bunEnv,
      cwd: String(dir),
    });
    await startProc.exited;

    // Now list processes
    await using listProc = Bun.spawn({
      cmd: [bunExe(), "list"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      listProc.stdout.text(),
      listProc.stderr.text(),
      listProc.exited,
    ]);

    // Should show the worker process
    expect(stdout).toContain("worker.js");
    expect(stdout).toContain("NAME");
    expect(stdout).toContain("PID");
    expect(exitCode).toBe(0);

    // Clean up
    const stopProc = Bun.spawn({
      cmd: [bunExe(), "stop", "worker.js"],
      env: bunEnv,
      cwd: String(dir),
    });
    await stopProc.exited;
  });

  test("bun stop - stops a running process", async () => {
    using dir = tempDir("process-manager-stop", {
      "service.js": `
        console.log("Service running");
        setInterval(() => {}, 1000);
      `,
    });

    // Start a process
    const startProc = Bun.spawn({
      cmd: [bunExe(), "start", "service.js"],
      env: bunEnv,
      cwd: String(dir),
    });
    await startProc.exited;

    // Stop the process
    await using stopProc = Bun.spawn({
      cmd: [bunExe(), "stop", "service.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      stopProc.stdout.text(),
      stopProc.stderr.text(),
      stopProc.exited,
    ]);

    expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`"✓ Stopped: service.js"`);
    expect(exitCode).toBe(0);

    // Verify it's not in the list anymore
    const listProc = Bun.spawn({
      cmd: [bunExe(), "list"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
    });

    const listOutput = await listProc.stdout.text();
    await listProc.exited;

    // Should either show no processes or not include service.js
    if (!listOutput.includes("No processes")) {
      expect(listOutput).not.toContain("service.js");
    }
  });

  test("bun logs - shows process logs", async () => {
    using dir = tempDir("process-manager-logs", {
      "logger.js": `
        console.log("Log message 1");
        console.error("Error message 1");
        console.log("Log message 2");
      `,
    });

    // Start and let it finish
    const startProc = Bun.spawn({
      cmd: [bunExe(), "start", "logger.js"],
      env: bunEnv,
      cwd: String(dir),
    });
    await startProc.exited;

    // Wait a bit for logs to be written
    await Bun.sleep(100);

    // Check logs
    await using logsProc = Bun.spawn({
      cmd: [bunExe(), "logs", "logger.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      logsProc.stdout.text(),
      logsProc.stderr.text(),
      logsProc.exited,
    ]);

    expect(stdout).toContain("Log message 1");
    expect(stdout).toContain("Log message 2");
    expect(exitCode).toBe(0);

    // Clean up
    const stopProc = Bun.spawn({
      cmd: [bunExe(), "stop", "logger.js"],
      env: bunEnv,
      cwd: String(dir),
    });
    await stopProc.exited;
  });

  test("bun start - prevents duplicate process names", async () => {
    using dir = tempDir("process-manager-duplicate", {
      "app.js": `
        console.log("App started");
        setInterval(() => {}, 1000);
      `,
    });

    // Start first process
    const start1 = Bun.spawn({
      cmd: [bunExe(), "start", "app.js"],
      env: bunEnv,
      cwd: String(dir),
    });
    await start1.exited;

    // Try to start again with same name
    await using start2 = Bun.spawn({
      cmd: [bunExe(), "start", "app.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([start2.stdout.text(), start2.stderr.text(), start2.exited]);

    expect(exitCode).not.toBe(0);
    expect(stderr.toLowerCase()).toMatch(/already|exists/);

    // Clean up
    const stopProc = Bun.spawn({
      cmd: [bunExe(), "stop", "app.js"],
      env: bunEnv,
      cwd: String(dir),
    });
    await stopProc.exited;
  });

  test("bun list - shows empty list when no processes running", async () => {
    using dir = tempDir("process-manager-empty");

    await using listProc = Bun.spawn({
      cmd: [bunExe(), "list"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      listProc.stdout.text(),
      listProc.stderr.text(),
      listProc.exited,
    ]);

    expect(stdout.toLowerCase()).toMatch(/no processes|not running/);
    expect(exitCode).toBe(0);
  });

  test("workspace isolation - processes in different directories are separate", async () => {
    using dir1 = tempDir("process-manager-ws1", {
      "proc.js": `setInterval(() => {}, 1000);`,
    });

    using dir2 = tempDir("process-manager-ws2", {
      "proc.js": `setInterval(() => {}, 1000);`,
    });

    // Start process in dir1
    const start1 = Bun.spawn({
      cmd: [bunExe(), "start", "proc.js"],
      env: bunEnv,
      cwd: String(dir1),
    });
    await start1.exited;

    // Start process in dir2
    const start2 = Bun.spawn({
      cmd: [bunExe(), "start", "proc.js"],
      env: bunEnv,
      cwd: String(dir2),
    });
    await start2.exited;

    // List in dir1 should only show dir1's process
    const list1 = Bun.spawn({
      cmd: [bunExe(), "list"],
      env: bunEnv,
      cwd: String(dir1),
      stdout: "pipe",
    });
    const out1 = await list1.stdout.text();
    await list1.exited;

    // List in dir2 should only show dir2's process
    const list2 = Bun.spawn({
      cmd: [bunExe(), "list"],
      env: bunEnv,
      cwd: String(dir2),
      stdout: "pipe",
    });
    const out2 = await list2.stdout.text();
    await list2.exited;

    // Both should show exactly one process
    const count1 = (out1.match(/proc\.js/g) || []).length;
    const count2 = (out2.match(/proc\.js/g) || []).length;
    expect(count1).toBe(1);
    expect(count2).toBe(1);

    // Clean up
    Bun.spawn({ cmd: [bunExe(), "stop", "proc.js"], env: bunEnv, cwd: String(dir1) });
    Bun.spawn({ cmd: [bunExe(), "stop", "proc.js"], env: bunEnv, cwd: String(dir2) });
  });
});
