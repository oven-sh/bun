import { spawn, spawnSync } from "bun";
import { test, expect, beforeAll, describe } from "bun:test";
import { isLinux } from "harness";

// Only run container tests on Linux
const describeContainer = isLinux ? describe : describe.skip;

describeContainer("Bun.spawn container", () => {
  beforeAll(() => {
    // Check if we have necessary permissions for container tests
    try {
      const result = spawnSync({
        cmd: ["unshare", "--user", "--pid", "--net", "/bin/true"],
        stdio: ["ignore", "ignore", "ignore"],
      });
      if (result.exitCode !== 0) {
        console.warn("Container tests may not work properly - missing namespace support");
      }
    } catch (err) {
      console.warn("Container tests may not work - unshare not available:", err);
    }
  });

  test("should support basic container options", async () => {
    const proc = spawn({
      cmd: ["echo", "hello from container"],
      container: {
        cgroup: true,
        userNamespace: true,
        pidNamespace: true,
        networkNamespace: true,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const result = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    
    expect(result).toBe(0);
    expect(stdout.trim()).toBe("hello from container");
  });

  test("should support memory limits in cgroup", async () => {
    const proc = spawn({
      cmd: ["echo", "memory limited"],
      container: {
        cgroup: true,
        memoryLimit: 128 * 1024 * 1024, // 128MB
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const result = await proc.exited;
    expect(result).toBe(0);
  });

  test("should support CPU limits in cgroup", async () => {
    const proc = spawn({
      cmd: ["echo", "cpu limited"],
      container: {
        cgroup: true,
        cpuLimit: 50, // 50%
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const result = await proc.exited;
    expect(result).toBe(0);
  });

  test("should isolate process in PID namespace", async () => {
    // Test that the process sees itself as PID 1 in the PID namespace
    const proc = spawn({
      cmd: ["sh", "-c", "echo $$"],
      container: {
        pidNamespace: true,
        userNamespace: true, // Required for rootless PID namespace
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const result = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    
    expect(result).toBe(0);
    // In PID namespace, process should see itself as PID 1
    expect(stdout.trim()).toBe("1");
  });

  test("should isolate network namespace", async () => {
    // Test that the process has limited network access
    const proc = spawn({
      cmd: ["ip", "link", "show"],
      container: {
        networkNamespace: true,
        userNamespace: true, // Required for rootless network namespace
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const result = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    
    expect(result).toBe(0);
    // Should only see loopback interface in isolated network namespace
    expect(stdout).toContain("lo:");
    expect(stdout).not.toContain("eth0");
    expect(stdout).not.toContain("wlan0");
  });

  test("should handle container option validation", () => {
    expect(() => {
      spawn({
        cmd: ["echo", "test"],
        container: "invalid" as any,
      });
    }).toThrow("container must be an object");
  });

  test("should work with spawnSync", () => {
    const result = spawnSync({
      cmd: ["echo", "sync container"],
      container: {
        cgroup: true,
        userNamespace: true,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe("sync container");
  });

  test("should handle invalid memory limits", () => {
    // Negative memory limit should be ignored
    const proc = spawn({
      cmd: ["echo", "test"],
      container: {
        memoryLimit: -1,
      },
      stdout: "pipe",
    });

    // Should not throw an error, just ignore the invalid limit
    expect(proc).toBeDefined();
  });

  test("should handle invalid CPU limits", () => {
    // CPU limit > 100% should be ignored
    const proc = spawn({
      cmd: ["echo", "test"],
      container: {
        cpuLimit: 150,
      },
      stdout: "pipe",
    });

    // Should not throw an error, just ignore the invalid limit
    expect(proc).toBeDefined();
  });

  test("should work with boolean container options", async () => {
    const proc = spawn({
      cmd: ["echo", "boolean test"],
      container: {
        cgroup: false,
        userNamespace: true,
        pidNamespace: false,
        networkNamespace: true,
      },
      stdout: "pipe",
    });

    const result = await proc.exited;
    expect(result).toBe(0);
  });

  test("should handle empty container object", async () => {
    const proc = spawn({
      cmd: ["echo", "empty container"],
      container: {},
      stdout: "pipe",
    });

    const result = await proc.exited;
    expect(result).toBe(0);
  });
});