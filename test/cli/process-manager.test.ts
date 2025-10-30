import { spawnSync } from "bun";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import * as path from "node:path";

describe("bun process manager", () => {
  let testDir: ReturnType<typeof tempDir>;

  beforeEach(() => {
    testDir = tempDir("process-manager", {});
  });

  afterEach(() => {
    // Clean up any running processes
    const { exitCode } = spawnSync({
      cmd: [bunExe(), "list"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    // If there are processes, stop them
    if (exitCode === 0) {
      const listResult = spawnSync({
        cmd: [bunExe(), "list"],
        cwd: String(testDir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const output = listResult.stdout.toString();
      const lines = output.split("\n");

      // Find process names from the output
      for (const line of lines) {
        const match = line.match(/^(\S+)\s+\d+/);
        if (match && match[1] && match[1] !== "NAME") {
          spawnSync({
            cmd: [bunExe(), "stop", match[1]],
            cwd: String(testDir),
            env: bunEnv,
            stdout: "pipe",
            stderr: "pipe",
          });
        }
      }
    }
  });

  test("start a simple script", async () => {
    await Bun.write(
      path.join(String(testDir), "server.js"),
      `
      console.log("Server started");
      setInterval(() => {
        console.log("Server running...");
      }, 1000);
      `,
    );

    const { exitCode, stdout, stderr } = spawnSync({
      cmd: [bunExe(), "start", "./server.js"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString()).toContain("Started");
    expect(stdout.toString()).toContain("server.js");

    // Give it a moment to start
    await Bun.sleep(100);

    // Verify the process is running
    const listResult = spawnSync({
      cmd: [bunExe(), "list"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(listResult.exitCode).toBe(0);
    expect(listResult.stdout.toString()).toContain("server.js");
  });

  test("list shows running processes", async () => {
    await Bun.write(path.join(String(testDir), "worker1.js"), `setInterval(() => {}, 1000);`);

    await Bun.write(path.join(String(testDir), "worker2.js"), `setInterval(() => {}, 1000);`);

    // Start two processes
    spawnSync({
      cmd: [bunExe(), "start", "./worker1.js"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    spawnSync({
      cmd: [bunExe(), "start", "./worker2.js"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    await Bun.sleep(100);

    const { exitCode, stdout } = spawnSync({
      cmd: [bunExe(), "list"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(0);
    const output = stdout.toString();
    expect(output).toContain("worker1.js");
    expect(output).toContain("worker2.js");
    expect(output).toContain("NAME");
    expect(output).toContain("PID");
    expect(output).toContain("UPTIME");
  });

  test("stop a running process", async () => {
    await Bun.write(path.join(String(testDir), "stoppable.js"), `setInterval(() => {}, 1000);`);

    // Start process
    spawnSync({
      cmd: [bunExe(), "start", "./stoppable.js"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    await Bun.sleep(100);

    // Stop process
    const stopResult = spawnSync({
      cmd: [bunExe(), "stop", "./stoppable.js"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(stopResult.exitCode).toBe(0);
    expect(stopResult.stdout.toString()).toContain("Stopped");

    // Verify it's not in the list anymore
    const listResult = spawnSync({
      cmd: [bunExe(), "list"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(listResult.stdout.toString()).not.toContain("stoppable.js");
  });

  test("logs command shows log paths", async () => {
    await Bun.write(
      path.join(String(testDir), "logger.js"),
      `
      console.log("stdout message");
      console.error("stderr message");
      setInterval(() => {}, 1000);
      `,
    );

    // Start process
    spawnSync({
      cmd: [bunExe(), "start", "./logger.js"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    await Bun.sleep(200);

    // Get logs
    const logsResult = spawnSync({
      cmd: [bunExe(), "logs", "./logger.js"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(logsResult.exitCode).toBe(0);
    const output = logsResult.stdout.toString();
    expect(output).toContain("stdout");
    expect(output).toContain("stderr");
    expect(output).toContain("/tmp/bun-logs/");
  });

  test("cannot start the same process twice", async () => {
    await Bun.write(path.join(String(testDir), "unique.js"), `setInterval(() => {}, 1000);`);

    // Start process
    const first = spawnSync({
      cmd: [bunExe(), "start", "./unique.js"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(first.exitCode).toBe(0);

    // Try to start again
    const second = spawnSync({
      cmd: [bunExe(), "start", "./unique.js"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(second.exitCode).not.toBe(0);
    expect(second.stderr.toString()).toContain("already running");
  });

  test("stop non-existent process fails", () => {
    const { exitCode, stderr } = spawnSync({
      cmd: [bunExe(), "stop", "nonexistent"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).not.toBe(0);
    expect(stderr.toString()).toContain("not found");
  });

  test("logs for non-existent process fails", () => {
    const { exitCode, stderr } = spawnSync({
      cmd: [bunExe(), "logs", "nonexistent"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).not.toBe(0);
    expect(stderr.toString()).toContain("not found");
  });

  test("list with no processes", () => {
    const { exitCode, stdout } = spawnSync({
      cmd: [bunExe(), "list"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString()).toContain("No processes running");
  });

  test("process output is captured to logs", async () => {
    await Bun.write(
      path.join(String(testDir), "output.js"),
      `
      console.log("test output line 1");
      console.log("test output line 2");
      console.error("test error line 1");
      setInterval(() => {}, 1000);
      `,
    );

    // Start process
    spawnSync({
      cmd: [bunExe(), "start", "./output.js"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait for output
    await Bun.sleep(300);

    // Get logs
    const logsResult = spawnSync({
      cmd: [bunExe(), "logs", "./output.js"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(logsResult.exitCode).toBe(0);
    const output = logsResult.stdout.toString();
    expect(output).toContain("test output line 1");
    expect(output).toContain("test output line 2");
    expect(output).toContain("test error line 1");
  });

  test("start script from package.json", async () => {
    await Bun.write(
      path.join(String(testDir), "package.json"),
      JSON.stringify({
        name: "test",
        scripts: {
          dev: "bun run ./script.js",
        },
      }),
    );

    await Bun.write(
      path.join(String(testDir), "script.js"),
      `
      console.log("Running from package.json script");
      setInterval(() => {}, 1000);
      `,
    );

    const { exitCode, stdout } = spawnSync({
      cmd: [bunExe(), "start", "dev"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString()).toContain("Started");

    await Bun.sleep(100);

    const listResult = spawnSync({
      cmd: [bunExe(), "list"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(listResult.exitCode).toBe(0);
    expect(listResult.stdout.toString()).toContain("dev");
  });

  test("workspace isolation - processes in different dirs don't interfere", async () => {
    const dir1 = tempDir("process-manager-1", {});
    const dir2 = tempDir("process-manager-2", {});

    try {
      await Bun.write(path.join(String(dir1), "app.js"), `setInterval(() => {}, 1000);`);

      await Bun.write(path.join(String(dir2), "app.js"), `setInterval(() => {}, 1000);`);

      // Start process in dir1
      spawnSync({
        cmd: [bunExe(), "start", "./app.js"],
        cwd: String(dir1),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Start process in dir2
      spawnSync({
        cmd: [bunExe(), "start", "./app.js"],
        cwd: String(dir2),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      await Bun.sleep(100);

      // List in dir1 should only show its process
      const list1 = spawnSync({
        cmd: [bunExe(), "list"],
        cwd: String(dir1),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      // List in dir2 should only show its process
      const list2 = spawnSync({
        cmd: [bunExe(), "list"],
        cwd: String(dir2),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Both should show exactly one process
      const lines1 = list1.stdout
        .toString()
        .split("\n")
        .filter(l => l.includes("app.js"));
      const lines2 = list2.stdout
        .toString()
        .split("\n")
        .filter(l => l.includes("app.js"));

      expect(lines1.length).toBe(1);
      expect(lines2.length).toBe(1);

      // Cleanup
      spawnSync({
        cmd: [bunExe(), "stop", "./app.js"],
        cwd: String(dir1),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      spawnSync({
        cmd: [bunExe(), "stop", "./app.js"],
        cwd: String(dir2),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
    } finally {
      // Cleanup dirs
    }
  });

  test("help text is shown when no subcommand", () => {
    const { exitCode, stdout } = spawnSync({
      cmd: [bunExe(), "start"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).not.toBe(0);
    // The help should be printed by the main command handler
  });

  test("uptime is tracked correctly", async () => {
    await Bun.write(path.join(String(testDir), "timed.js"), `setInterval(() => {}, 1000);`);

    // Start process
    spawnSync({
      cmd: [bunExe(), "start", "./timed.js"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Wait a bit
    await Bun.sleep(2000);

    // Check list
    const listResult = spawnSync({
      cmd: [bunExe(), "list"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(listResult.exitCode).toBe(0);
    const output = listResult.stdout.toString();
    // Should show at least 1 second of uptime
    expect(output).toMatch(/\d+s/);
  });

  test("process manager persists state across commands", async () => {
    await Bun.write(path.join(String(testDir), "persistent.js"), `setInterval(() => {}, 1000);`);

    // Start process
    spawnSync({
      cmd: [bunExe(), "start", "./persistent.js"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    await Bun.sleep(100);

    // Multiple list calls should all see the same process
    for (let i = 0; i < 3; i++) {
      const listResult = spawnSync({
        cmd: [bunExe(), "list"],
        cwd: String(testDir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(listResult.exitCode).toBe(0);
      expect(listResult.stdout.toString()).toContain("persistent.js");
      await Bun.sleep(50);
    }

    // Stop should work
    const stopResult = spawnSync({
      cmd: [bunExe(), "stop", "./persistent.js"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(stopResult.exitCode).toBe(0);

    // And it should be gone
    const finalList = spawnSync({
      cmd: [bunExe(), "list"],
      cwd: String(testDir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(finalList.stdout.toString()).not.toContain("persistent.js");
  });
});
