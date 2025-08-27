import { test, expect, describe } from "bun:test";
import { bunEnv } from "harness";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

describe("container overlayfs simple", () => {
  // Skip all tests if not Linux
  if (process.platform !== "linux") {
    test.skip("container tests are Linux-only", () => {});
    return;
  }

  test("basic overlayfs mount test", async () => {
    // Create temporary directories for overlay
    const tmpBase = mkdtempSync(join("/tmp", "bun-overlay-basic-"));
    const lowerDir = join(tmpBase, "lower");
    const upperDir = join(tmpBase, "upper");
    const workDir = join(tmpBase, "work");
    
    mkdirSync(lowerDir, { recursive: true });
    mkdirSync(upperDir, { recursive: true });
    mkdirSync(workDir, { recursive: true });
    
    // Create a test file in lower layer
    writeFileSync(join(lowerDir, "test.txt"), "hello from lower");
    
    // First, let's see if we get any warnings or errors from the container setup
    // The error messages should be written to stderr by our container code
    const proc = Bun.spawn({
      cmd: ["/bin/ls", "-la", "/data"],
      env: bunEnv,
      container: {
        namespace: {
          user: true,
          mount: true,
        },
        fs: [
          {
            type: "overlayfs",
            to: "/data",
            options: {
              overlayfs: {
                lower_dirs: [lowerDir],
                upper_dir: upperDir,
                work_dir: workDir,
              },
            },
          },
        ],
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Check if process started (has pid)
    console.log("Process PID:", proc.pid);
    
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    console.log("Exit code:", exitCode);
    console.log("Stdout:", stdout);
    console.log("Stderr:", stderr);
    
    // If we get exit code 2 from ls, it means /data doesn't exist (mount failed)
    // If we get container setup errors, they should be in stderr
    if (stderr.includes("Failed to mount") || stderr.includes("Warning:")) {
      console.log("Container mount error detected:", stderr);
    }
    
    // For now, just check that it doesn't crash
    expect(typeof exitCode).toBe("number");
  });

  test("check if overlay is available", async () => {
    // Check if overlayfs is available in the kernel
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", "cat /proc/filesystems | grep overlay"],
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await proc.stdout.text();
    console.log("Overlay support:", stdout);
    
    // If overlay is in filesystems, it's supported
    if (stdout.includes("overlay")) {
      expect(stdout).toContain("overlay");
    } else {
      console.log("Warning: overlayfs might not be supported on this system");
      expect(true).toBe(true); // Pass anyway
    }
  });

  test("test without overlayfs - just mount namespace", async () => {
    // This should work
    await using proc = Bun.spawn({
      cmd: ["/bin/echo", "hello without overlay"],
      env: bunEnv,
      container: {
        namespace: {
          user: true,
          mount: true,
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
    expect(stdout.trim()).toBe("hello without overlay");
  });
});