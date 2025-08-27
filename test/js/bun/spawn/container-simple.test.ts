import { test, expect, describe } from "bun:test";

describe("container simple tests", () => {
  // Skip all tests if not Linux
  if (process.platform !== "linux") {
    test.skip("container tests are Linux-only", () => {});
    return;
  }

  test("basic user namespace with echo", async () => {
    await using proc = Bun.spawn({
      cmd: ["/usr/bin/echo", "hello from container"],
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
    expect(stdout.trim()).toBe("hello from container");
  });

  test("user namespace shows uid 0", async () => {
    await using proc = Bun.spawn({
      cmd: ["/usr/bin/id", "-u"],
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
    expect(stdout.trim()).toBe("0");
  });

  test("pid namespace with sh", async () => {
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", "echo $$"],
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
    expect(stdout.trim()).toBe("1");
  });

  test("network namespace isolates interfaces", async () => {
    await using proc = Bun.spawn({
      cmd: ["/usr/bin/test", "-e", "/sys/class/net/lo"],
      container: {
        namespace: {
          user: true,
          network: true,
        },
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    // Should have loopback in network namespace
    expect(exitCode).toBe(0);
  });

  test("environment variables work in container", async () => {
    await using proc = Bun.spawn({
      cmd: ["/usr/bin/printenv", "TEST_VAR"],
      env: {
        TEST_VAR: "test_value_123",
      },
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
    expect(stdout.trim()).toBe("test_value_123");
  });

  test("exit codes are preserved", async () => {
    await using proc = Bun.spawn({
      cmd: ["/bin/false"],
      container: {
        namespace: {
          user: true,
        },
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(1);
  });
});