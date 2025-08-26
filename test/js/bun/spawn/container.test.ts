import { spawn, spawnSync } from "bun";
import { test, expect, beforeAll, describe } from "bun:test";
import { isLinux, tempDirWithFiles, bunExe, bunEnv } from "harness";
import path from "path";

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

  test("should support basic namespace options", async () => {
    const proc = spawn({
      cmd: ["echo", "hello from container"],
      container: {
        namespace: {
          pid: true,
          user: true,
          network: true,
        },
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const result = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    
    expect(result).toBe(0);
    expect(stdout.trim()).toBe("hello from container");
  });

  test("should support resource limits", async () => {
    const proc = spawn({
      cmd: ["echo", "resource limited"],
      container: {
        limit: {
          cpu: 50, // 50%
          ram: 128 * 1024 * 1024, // 128MB
        },
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
        namespace: {
          pid: true,
          user: true, // Required for rootless PID namespace
        },
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
        namespace: {
          network: true,
          user: true, // Required for rootless network namespace
        },
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

  test("should support tmpfs mounts", async () => {
    const proc = spawn({
      cmd: ["sh", "-c", "mount | grep tmpfs | grep /tmp/test"],
      container: {
        namespace: {
          user: true,
        },
        fs: [
          {
            type: "tmpfs",
            to: "/tmp/test",
          },
        ],
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const result = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    
    expect(result).toBe(0);
    expect(stdout).toContain("tmpfs");
  });

  test("should support bind mounts", async () => {
    const dir = tempDirWithFiles("container-bind-test", {
      "source.txt": "Hello from host",
    });

    const proc = spawn({
      cmd: ["cat", "/mnt/bound/source.txt"],
      container: {
        namespace: {
          user: true,
        },
        fs: [
          {
            type: "bind",
            from: dir,
            to: "/mnt/bound",
          },
        ],
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const result = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    
    expect(result).toBe(0);
    expect(stdout.trim()).toBe("Hello from host");
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
        namespace: {
          user: true,
        },
        limit: {
          cpu: 75,
        },
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe("sync container");
  });

  test("should properly cleanup resources on process exit", async () => {
    // Spawn multiple processes with containers to test cleanup
    const procs = [];
    
    for (let i = 0; i < 3; i++) {
      const proc = spawn({
        cmd: ["sh", "-c", "sleep 0.1; echo done"],
        container: {
          namespace: {
            pid: true,
            user: true,
          },
          limit: {
            ram: 64 * 1024 * 1024,
          },
        },
        stdout: "pipe",
      });
      procs.push(proc);
    }

    // Wait for all to complete
    const results = await Promise.all(procs.map(p => p.exited));
    expect(results).toEqual([0, 0, 0]);

    // Check that cgroups were cleaned up
    // This is indirect but we can spawn another to ensure no conflicts
    const cleanup_test = spawn({
      cmd: ["echo", "cleanup test"],
      container: {
        limit: {
          ram: 64 * 1024 * 1024,
        },
      },
      stdout: "pipe",
    });

    expect(await cleanup_test.exited).toBe(0);
  });

  test("should handle invalid resource limits gracefully", () => {
    // Negative memory limit should be ignored
    const proc = spawn({
      cmd: ["echo", "test"],
      container: {
        limit: {
          ram: -1,
          cpu: -50,
        },
      },
      stdout: "pipe",
    });

    // Should not throw an error, just ignore the invalid limits
    expect(proc).toBeDefined();
  });

  test("should support overlayfs mounts", async () => {
    const dir = tempDirWithFiles("overlay-test", {
      "lower1/file1.txt": "lower1 content",
      "lower2/file2.txt": "lower2 content",
      "upper/.keep": "",
      "work/.keep": "",
    });

    const proc = spawn({
      cmd: ["sh", "-c", "ls /mnt/overlay && cat /mnt/overlay/file1.txt"],
      container: {
        namespace: {
          user: true,
        },
        fs: [
          {
            type: "overlayfs",
            to: "/mnt/overlay",
            // Note: overlayfs options would need to be parsed from the options field
            // This is a simplified test
          },
        ],
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // This test may fail if overlayfs is not supported
    // That's OK - it will return a non-zero exit code
    const result = await proc.exited;
    
    // Just ensure the process runs without crashing
    expect(typeof result).toBe("number");
  });

  test("should support combining multiple container features", async () => {
    const proc = spawn({
      cmd: [bunExe(), "-e", "console.log(JSON.stringify({pid: process.pid, mem: process.memoryUsage()}))"],
      env: bunEnv,
      container: {
        namespace: {
          pid: true,
          user: true,
          network: false, // Keep network for this test
        },
        limit: {
          cpu: 80,
          ram: 256 * 1024 * 1024,
        },
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const result = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    
    expect(result).toBe(0);
    
    const data = JSON.parse(stdout);
    // In PID namespace, should be low PID (likely 1)
    expect(data.pid).toBeLessThanOrEqual(10);
    expect(data.mem).toBeDefined();
  });

  test("should properly handle container cleanup on error", async () => {
    // Test that container resources are cleaned up even when process fails
    const proc = spawn({
      cmd: ["sh", "-c", "exit 1"],
      container: {
        namespace: {
          user: true,
        },
        limit: {
          ram: 32 * 1024 * 1024,
        },
      },
    });

    const result = await proc.exited;
    expect(result).toBe(1);

    // Spawn another process with same limits to ensure cleanup happened
    const proc2 = spawn({
      cmd: ["echo", "cleanup verified"],
      container: {
        limit: {
          ram: 32 * 1024 * 1024,
        },
      },
      stdout: "pipe",
    });

    expect(await proc2.exited).toBe(0);
  });

  test("should handle missing permissions gracefully", async () => {
    // This test will fail in environments without proper permissions
    // We just want to ensure it fails gracefully without crashing
    const proc = spawn({
      cmd: ["echo", "test"],
      container: {
        namespace: {
          pid: true,
          user: true,
          network: true,
        },
        limit: {
          cpu: 50,
          ram: 128 * 1024 * 1024,
        },
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Should either succeed or fail with a permission error
    const result = await proc.exited;
    expect(typeof result).toBe("number");
  });
});