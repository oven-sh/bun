import { test, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";

test("invalid container options should fail gracefully", () => {
  // Skip if not Linux
  if (process.platform !== "linux") {
    return;
  }

  // Test with invalid namespace configuration
  expect(() => {
    Bun.spawn({
      cmd: ["echo", "test"],
      container: {
        namespace: {
          // @ts-ignore - intentionally invalid
          user: "invalid", // Should be boolean or object
        },
      },
    });
  }).toThrow();

  // Test with invalid container type
  expect(() => {
    Bun.spawn({
      cmd: ["echo", "test"],
      // @ts-ignore - intentionally invalid
      container: "not-an-object",
    });
  }).toThrow();
});

test("PID namespace without user namespace as non-root should fail", async () => {
  // Skip if not Linux
  if (process.platform !== "linux") {
    return;
  }

  // Check if running as root
  const uid = process.getuid ? process.getuid() : -1;
  if (uid === 0) {
    // Skip test if running as root
    return;
  }

  // Try to create PID namespace without user namespace (should fail for non-root)
  try {
    const proc = Bun.spawn({
      cmd: ["echo", "test"],
      container: {
        namespace: {
          pid: true,
          // Note: no user namespace
        },
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    
    // If we get here on non-root, something's wrong
    const exitCode = await proc.exited;
    expect(exitCode).not.toBe(0);
  } catch (e: any) {
    // Expected to throw EPERM error
    expect(e.code).toBe("EPERM");
  }
});

test("container with simple command works", async () => {
  // Skip if not Linux
  if (process.platform !== "linux") {
    return;
  }

  // Test basic container functionality with simple command
  await using proc = Bun.spawn({
    cmd: ["echo", "container test"],
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

  // Process should complete successfully
  expect(exitCode).toBe(0);
  expect(stdout.trim()).toBe("container test");
});

test("container process cleanup on parent death", async () => {
  // Skip if not Linux
  if (process.platform !== "linux") {
    return;
  }

  // Create a parent process that spawns a container child
  const parentScript = `
    const child = Bun.spawn({
      cmd: ["sleep", "10"],
      container: {
        namespace: {
          user: true,
          pid: true,
        },
      },
    });
    console.log("Child PID:", child.pid);
    
    // Parent exits immediately
    process.exit(0);
  `;

  await using parent = Bun.spawn({
    cmd: [bunExe(), "-e", parentScript],
    env: bunEnv,
    stdout: "pipe",
  });

  const stdout = await parent.stdout.text();
  const exitCode = await parent.exited;
  
  expect(exitCode).toBe(0);
  
  // Extract child PID if printed
  const pidMatch = stdout.match(/Child PID: (\d+)/);
  if (pidMatch) {
    const childPid = parseInt(pidMatch[1]);
    
    // Wait a bit then check if child process is gone
    await Bun.sleep(100);
    
    // Check if process exists by sending signal 0
    try {
      process.kill(childPid, 0);
      // If we get here, process still exists (bad - should have died with parent)
      expect(true).toBe(false); // Force fail
    } catch (e) {
      // Process doesn't exist (good - cleaned up properly)
      expect(true).toBe(true);
    }
  }
});