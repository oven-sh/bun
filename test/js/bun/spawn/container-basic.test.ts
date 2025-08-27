import { test, expect, describe } from "bun:test";
import { bunExe, bunEnv } from "harness";
import { existsSync } from "fs";

describe("container basic functionality", () => {
  // Skip all tests if not Linux
  if (process.platform !== "linux") {
    test.skip("container tests are Linux-only", () => {});
    return;
  }

  test("user namespace isolation", async () => {
    // Use /bin/sh which exists on all Linux systems
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", "id -u; id -g; whoami 2>/dev/null || echo root"],
      env: bunEnv,
      container: {
        namespace: {
          user: true,
        },
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    const lines = stdout.trim().split('\n');
    expect(lines[0]).toBe("0"); // UID should be 0 in container
    expect(lines[1]).toBe("0"); // GID should be 0 in container
    expect(lines[2]).toBe("root"); // Should appear as root
  });

  test("pid namespace isolation", async () => {
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", "echo $$"],  // $$ is the PID of the shell
      env: bunEnv,
      container: {
        namespace: {
          user: true,
          pid: true,
        },
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    // In a PID namespace, the first process gets PID 1
    expect(stdout.trim()).toBe("1");
  });

  test("network namespace isolation", async () => {
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", "ip link show 2>/dev/null | grep '^[0-9]' | wc -l"],
      env: bunEnv,
      container: {
        namespace: {
          user: true,
          network: true,
        },
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    // In a new network namespace, should only have loopback interface
    expect(stdout.trim()).toBe("1");
  });

  test("combined namespaces", async () => {
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", "id -u && echo $$ && hostname"],
      env: bunEnv,
      container: {
        namespace: {
          user: true,
          pid: true,
          network: true,
        },
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    const lines = stdout.trim().split('\n');
    expect(lines[0]).toBe("0"); // UID 0
    expect(lines[1]).toBe("1"); // PID 1
    // hostname in isolated namespace
    expect(lines[2]).toBeTruthy();
  });

  test("environment variables are preserved", async () => {
    const testEnv = { ...bunEnv, TEST_VAR: "hello_container" };
    
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", "echo $TEST_VAR"],
      env: testEnv,
      container: {
        namespace: {
          user: true,
        },
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("hello_container");
  });

  test("working directory is preserved", async () => {
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", "pwd"],
      env: bunEnv,
      cwd: "/tmp",
      container: {
        namespace: {
          user: true,
        },
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("/tmp");
  });

  test("stdin/stdout/stderr work correctly", async () => {
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", "cat && echo stderr_test >&2"],
      env: bunEnv,
      container: {
        namespace: {
          user: true,
        },
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    proc.stdin.write("test_input\n");
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toBe("test_input\n");
    expect(stderr).toBe("stderr_test\n");
  });

  test("exit codes are properly propagated", async () => {
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", "exit 42"],
      env: bunEnv,
      container: {
        namespace: {
          user: true,
        },
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(42);
  });

  test("signals are properly handled", async () => {
    const proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", "sleep 10"],
      env: bunEnv,
      container: {
        namespace: {
          user: true,
        },
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Give it time to start
    await Bun.sleep(100);
    
    // Kill the process
    proc.kill("SIGTERM");

    const exitCode = await proc.exited;
    // Process killed by SIGTERM should have exit code 143 (128 + 15)
    expect(exitCode).toBe(143);
  });
});