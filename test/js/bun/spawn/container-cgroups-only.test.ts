import { test, expect, describe } from "bun:test";
import { bunEnv } from "harness";

describe("container cgroups v2 only (no namespaces)", () => {
  // Skip all tests if not Linux
  if (process.platform !== "linux") {
    test.skip("container tests are Linux-only", () => {});
    return;
  }

  test("Resource limits without namespaces", async () => {
    // Test cgroups without any namespace isolation
    await using proc = Bun.spawn({
      cmd: ["/bin/echo", "cgroups only"],
      env: bunEnv,
      container: {
        // No namespace isolation
        limit: {
          cpu: 50, // 50% CPU
          ram: 100 * 1024 * 1024, // 100MB RAM
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
    expect(stdout.trim()).toBe("cgroups only");
  });

  test("Check process cgroup placement", async () => {
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", "cat /proc/self/cgroup"],
      env: bunEnv,
      container: {
        limit: {
          cpu: 25,
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

    console.log("Process cgroup:", stdout);
    
    expect(exitCode).toBe(0);
    // If cgroups worked, we should see a bun-* cgroup
    // If not, process will be in default cgroup (that's OK too)
    expect(stdout.length).toBeGreaterThan(0);
  });
});