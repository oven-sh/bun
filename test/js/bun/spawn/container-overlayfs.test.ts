import { test, expect, describe } from "bun:test";
import { bunExe, bunEnv } from "harness";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, symlinkSync } from "fs";
import { join } from "path";
import { existsSync } from "fs";

describe("container overlayfs functionality", () => {
  // Skip all tests if not Linux
  if (process.platform !== "linux") {
    test.skip("container tests are Linux-only", () => {});
    return;
  }

  function setupMinimalRootfs(dir: string) {
    // Create essential directories
    mkdirSync(join(dir, "bin"), { recursive: true });
    mkdirSync(join(dir, "lib"), { recursive: true });
    mkdirSync(join(dir, "lib64"), { recursive: true });
    mkdirSync(join(dir, "usr", "bin"), { recursive: true });
    mkdirSync(join(dir, "usr", "lib"), { recursive: true });
    mkdirSync(join(dir, "proc"), { recursive: true });
    mkdirSync(join(dir, "dev"), { recursive: true });
    mkdirSync(join(dir, "tmp"), { recursive: true });
    
    // Copy essential binaries
    if (existsSync("/bin/sh")) {
      copyFileSync("/bin/sh", join(dir, "bin", "sh"));
    }
    if (existsSync("/bin/cat")) {
      copyFileSync("/bin/cat", join(dir, "bin", "cat"));
    }
    if (existsSync("/bin/echo")) {
      copyFileSync("/bin/echo", join(dir, "bin", "echo"));
    }
    if (existsSync("/usr/bin/echo")) {
      copyFileSync("/usr/bin/echo", join(dir, "usr", "bin", "echo"));
    }
    if (existsSync("/bin/test")) {
      copyFileSync("/bin/test", join(dir, "bin", "test"));
    }
    if (existsSync("/usr/bin/test")) {
      copyFileSync("/usr/bin/test", join(dir, "usr", "bin", "test"));
    }
    
    // We need to copy the dynamic linker and libraries
    // This is very system-specific, but we'll try common locations
    const commonLibs = [
      "/lib/x86_64-linux-gnu/libc.so.6",
      "/lib64/libc.so.6",
      "/lib/libc.so.6",
      "/lib/x86_64-linux-gnu/libdl.so.2",
      "/lib64/libdl.so.2",
      "/lib/x86_64-linux-gnu/libm.so.6",
      "/lib64/libm.so.6",
      "/lib/x86_64-linux-gnu/libpthread.so.0",
      "/lib64/libpthread.so.0",
      "/lib/x86_64-linux-gnu/libresolv.so.2",
      "/lib64/libresolv.so.2",
    ];
    
    for (const lib of commonLibs) {
      if (existsSync(lib)) {
        const targetPath = join(dir, lib);
        mkdirSync(join(targetPath, ".."), { recursive: true });
        try {
          copyFileSync(lib, targetPath);
        } catch {}
      }
    }
    
    // Copy the dynamic linker
    const linkers = [
      "/lib64/ld-linux-x86-64.so.2",
      "/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2",
      "/lib/ld-linux.so.2",
    ];
    
    for (const linker of linkers) {
      if (existsSync(linker)) {
        const targetPath = join(dir, linker);
        mkdirSync(join(targetPath, ".."), { recursive: true });
        try {
          copyFileSync(linker, targetPath);
        } catch {}
      }
    }
  }

  test("overlayfs with data directory mount", async () => {
    // Create temporary directories for overlay
    const tmpBase = mkdtempSync(join("/tmp", "bun-overlay-test-"));
    const lowerDir = join(tmpBase, "lower");
    const upperDir = join(tmpBase, "upper");
    const workDir = join(tmpBase, "work");
    
    mkdirSync(lowerDir, { recursive: true });
    mkdirSync(upperDir, { recursive: true });
    mkdirSync(workDir, { recursive: true });
    
    // Create a test file in lower layer
    writeFileSync(join(lowerDir, "test.txt"), "lower content");
    
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", "echo hello && cat /data/test.txt"],
      env: bunEnv,
      container: {
        namespace: {
          user: true,
          mount: true,
        },
        mounts: [
          {
            from: null,
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

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      console.log("Test failed with stderr:", stderr);
      console.log("stdout:", stdout);
    }
    
    expect(exitCode).toBe(0);
    expect(stdout).toContain("hello");
    expect(stdout).toContain("lower content");
  });

  test("overlayfs modifications persist in upper layer", async () => {
    const tmpBase = mkdtempSync(join("/tmp", "bun-overlay-mod-"));
    const lowerDir = join(tmpBase, "lower");
    const upperDir = join(tmpBase, "upper");
    const workDir = join(tmpBase, "work");
    
    mkdirSync(lowerDir, { recursive: true });
    mkdirSync(upperDir, { recursive: true });
    mkdirSync(workDir, { recursive: true });
    
    // Create initial file
    writeFileSync(join(lowerDir, "data.txt"), "original");
    
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", "echo modified > /mnt/data.txt && cat /mnt/data.txt"],
      env: bunEnv,
      container: {
        namespace: {
          user: true,
          mount: true,
        },
        mounts: [
          {
            from: null,
            to: "/mnt",
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

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("modified");
    
    // Check that lower layer is unchanged
    const lowerContent = await Bun.file(join(lowerDir, "data.txt")).text();
    expect(lowerContent).toBe("original");
    
    // Check that upper layer has the modification
    const upperFile = join(upperDir, "data.txt");
    if (existsSync(upperFile)) {
      const upperContent = await Bun.file(upperFile).text();
      expect(upperContent).toBe("modified\n");
    }
  });

  test("overlayfs with multiple lower layers", async () => {
    const tmpBase = mkdtempSync(join("/tmp", "bun-overlay-multi-"));
    const lower1 = join(tmpBase, "lower1");
    const lower2 = join(tmpBase, "lower2");
    const upperDir = join(tmpBase, "upper");
    const workDir = join(tmpBase, "work");
    
    mkdirSync(lower1, { recursive: true });
    mkdirSync(lower2, { recursive: true });
    mkdirSync(upperDir, { recursive: true });
    mkdirSync(workDir, { recursive: true });
    
    // Create files in different layers
    writeFileSync(join(lower1, "file1.txt"), "from lower1");
    writeFileSync(join(lower2, "file2.txt"), "from lower2");
    
    // Test overlay priority - same file in both layers
    writeFileSync(join(lower1, "common.txt"), "lower1 version");
    writeFileSync(join(lower2, "common.txt"), "lower2 version");
    
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", "cat /overlay/file1.txt && cat /overlay/file2.txt && cat /overlay/common.txt"],
      env: bunEnv,
      container: {
        namespace: {
          user: true,
          mount: true,
        },
        mounts: [
          {
            from: null,
            to: "/overlay",
            options: {
              overlayfs: {
                lower_dirs: [lower1, lower2], // lower1 has higher priority
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

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("from lower1");
    expect(stdout).toContain("from lower2");
    expect(stdout).toContain("lower1 version"); // Should see lower1's version of common.txt
  });

  test("overlayfs file creation in container", async () => {
    const tmpBase = mkdtempSync(join("/tmp", "bun-overlay-create-"));
    const lowerDir = join(tmpBase, "lower");
    const upperDir = join(tmpBase, "upper");
    const workDir = join(tmpBase, "work");
    
    mkdirSync(lowerDir, { recursive: true });
    mkdirSync(upperDir, { recursive: true });
    mkdirSync(workDir, { recursive: true });
    
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", "echo 'new file' > /work/newfile.txt && cat /work/newfile.txt"],
      env: bunEnv,
      container: {
        namespace: {
          user: true,
          mount: true,
        },
        mounts: [
          {
            from: null,
            to: "/work",
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

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("new file");
    
    // Verify file was created in upper layer only
    expect(existsSync(join(upperDir, "newfile.txt"))).toBe(true);
    expect(existsSync(join(lowerDir, "newfile.txt"))).toBe(false);
  });

  test("overlayfs with readonly lower layer", async () => {
    const tmpBase = mkdtempSync(join("/tmp", "bun-overlay-readonly-"));
    const lowerDir = join(tmpBase, "lower");
    const upperDir = join(tmpBase, "upper");
    const workDir = join(tmpBase, "work");
    
    mkdirSync(lowerDir, { recursive: true });
    mkdirSync(upperDir, { recursive: true });
    mkdirSync(workDir, { recursive: true });
    
    // Create a file in lower
    writeFileSync(join(lowerDir, "readonly.txt"), "immutable content");
    
    // Try to modify it through overlayfs
    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", "echo 'modified' >> /storage/readonly.txt && cat /storage/readonly.txt"],
      env: bunEnv,
      container: {
        namespace: {
          user: true,
          mount: true,
        },
        mounts: [
          {
            from: null,
            to: "/storage",
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

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("immutable content");
    expect(stdout).toContain("modified");
    
    // Original file in lower should be unchanged
    const lowerContent = await Bun.file(join(lowerDir, "readonly.txt")).text();
    expect(lowerContent).toBe("immutable content");
    
    // Modified version should be in upper
    const upperFile = join(upperDir, "readonly.txt");
    expect(existsSync(upperFile)).toBe(true);
  });
});