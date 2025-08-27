import { test, expect, describe } from "bun:test";
import { bunExe, bunEnv, tempDirWithFiles, tmpdirSync } from "harness";
import path from "node:path";
import fs from "node:fs";

describe("container overlayfs", () => {
  // Skip all tests if not Linux
  if (process.platform !== "linux") {
    test.skip("overlayfs tests are Linux-only", () => {});
    return;
  }

  test("overlayfs with read-only lower layer", async () => {
    // Create lower layer with some files
    const lowerDir = tempDirWithFiles("overlay-lower", {
      "base.txt": "content from lower layer",
      "shared/file.txt": "shared file from lower",
      "readonly.txt": "this should be read-only",
    });

    // Create target mount point
    const mountPoint = path.join(tmpdirSync(), "overlay-mount");
    fs.mkdirSync(mountPoint, { recursive: true });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `
        const fs = require('fs');
        const path = require('path');
        
        // Read file from lower layer
        const baseContent = fs.readFileSync('/mnt/overlay/base.txt', 'utf8');
        console.log('Base file:', baseContent);
        
        // List files in overlay
        const files = fs.readdirSync('/mnt/overlay');
        console.log('Files:', files.sort().join(', '));
        
        // Try to write (should fail since no upper layer)
        try {
          fs.writeFileSync('/mnt/overlay/new.txt', 'should fail');
          console.log('ERROR: Write succeeded when it should have failed');
        } catch (e) {
          console.log('Write failed as expected (read-only):', e.code);
        }
      `],
      env: bunEnv,
      container: {
        namespace: {
          user: true,
          pid: true,
        },
        fs: [
          {
            type: "overlayfs",
            to: "/mnt/overlay",
            options: {
              overlayfs: {
                lower_dirs: [lowerDir],
                // No upper/work dirs - makes it read-only
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
    expect(stdout).toContain("Base file: content from lower layer");
    expect(stdout).toContain("base.txt");
    expect(stdout).toContain("readonly.txt");
    expect(stdout).toContain("shared");
    expect(stdout).toContain("Write failed as expected");
  });

  test("overlayfs with upper layer for read-write", async () => {
    // Create lower layer
    const lowerDir = tempDirWithFiles("overlay-lower-rw", {
      "base.txt": "from lower",
      "subdir/nested.txt": "nested in lower",
    });

    // Create upper and work directories
    const upperDir = path.join(tmpdirSync(), "overlay-upper");
    const workDir = path.join(tmpdirSync(), "overlay-work");
    fs.mkdirSync(upperDir, { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `
        const fs = require('fs');
        
        // Read from lower layer
        console.log('Lower:', fs.readFileSync('/mnt/overlay/base.txt', 'utf8'));
        
        // Write new file (goes to upper layer)
        fs.writeFileSync('/mnt/overlay/new.txt', 'created in overlay');
        console.log('Created new file');
        
        // Modify existing file (copy-on-write to upper)
        fs.writeFileSync('/mnt/overlay/base.txt', 'modified in overlay');
        console.log('Modified base.txt');
        
        // Read modified content
        console.log('Modified:', fs.readFileSync('/mnt/overlay/base.txt', 'utf8'));
        
        // List all files
        const files = fs.readdirSync('/mnt/overlay');
        console.log('All files:', files.sort().join(', '));
      `],
      env: bunEnv,
      container: {
        namespace: {
          user: true,
          pid: true,
        },
        fs: [
          {
            type: "overlayfs",
            to: "/mnt/overlay",
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
    expect(stdout).toContain("Lower: from lower");
    expect(stdout).toContain("Created new file");
    expect(stdout).toContain("Modified base.txt");
    expect(stdout).toContain("Modified: modified in overlay");
    expect(stdout).toContain("new.txt");
    
    // Check that upper layer has the changes
    const upperFiles = fs.readdirSync(upperDir);
    expect(upperFiles).toContain("new.txt");
    expect(upperFiles).toContain("base.txt");
    
    // Original lower layer should be unchanged
    const lowerContent = fs.readFileSync(path.join(lowerDir, "base.txt"), "utf8");
    expect(lowerContent).toBe("from lower");
  });

  test("overlayfs with multiple lower layers", async () => {
    // Create multiple lower layers
    const lower1 = tempDirWithFiles("overlay-lower1", {
      "file1.txt": "from layer 1",
      "shared.txt": "shared from layer 1",
    });

    const lower2 = tempDirWithFiles("overlay-lower2", {
      "file2.txt": "from layer 2",
      "shared.txt": "shared from layer 2 (should be hidden by layer 1)",
      "unique2.txt": "unique to layer 2",
    });

    const lower3 = tempDirWithFiles("overlay-lower3", {
      "file3.txt": "from layer 3",
      "base.txt": "base from layer 3",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `
        const fs = require('fs');
        
        // Read files from different layers
        console.log('File1:', fs.readFileSync('/mnt/overlay/file1.txt', 'utf8'));
        console.log('File2:', fs.readFileSync('/mnt/overlay/file2.txt', 'utf8'));
        console.log('File3:', fs.readFileSync('/mnt/overlay/file3.txt', 'utf8'));
        
        // Shared file should come from the first layer
        console.log('Shared:', fs.readFileSync('/mnt/overlay/shared.txt', 'utf8'));
        
        // List all files (union of all layers)
        const files = fs.readdirSync('/mnt/overlay');
        console.log('All files:', files.sort().join(', '));
      `],
      env: bunEnv,
      container: {
        namespace: {
          user: true,
          pid: true,
        },
        fs: [
          {
            type: "overlayfs",
            to: "/mnt/overlay",
            options: {
              overlayfs: {
                // Order matters: first layer wins for duplicate files
                lower_dirs: [lower1, lower2, lower3],
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
    expect(stdout).toContain("File1: from layer 1");
    expect(stdout).toContain("File2: from layer 2");
    expect(stdout).toContain("File3: from layer 3");
    expect(stdout).toContain("Shared: shared from layer 1"); // Layer 1 wins
    expect(stdout).toContain("file1.txt");
    expect(stdout).toContain("file2.txt");
    expect(stdout).toContain("file3.txt");
    expect(stdout).toContain("unique2.txt");
    expect(stdout).toContain("base.txt");
  });

  test("overlayfs combined with other mount types", async () => {
    const lowerDir = tempDirWithFiles("overlay-combined-lower", {
      "base.txt": "from overlay lower",
    });

    const bindDir = tempDirWithFiles("overlay-combined-bind", {
      "bind.txt": "from bind mount",
    });

    const upperDir = path.join(tmpdirSync(), "overlay-combined-upper");
    const workDir = path.join(tmpdirSync(), "overlay-combined-work");
    fs.mkdirSync(upperDir, { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `
        const fs = require('fs');
        
        // Check overlayfs mount
        console.log('Overlay:', fs.readFileSync('/mnt/overlay/base.txt', 'utf8'));
        fs.writeFileSync('/mnt/overlay/new.txt', 'written to overlay');
        
        // Check bind mount
        console.log('Bind:', fs.readFileSync('/mnt/bind/bind.txt', 'utf8'));
        
        // Check tmpfs mount
        fs.writeFileSync('/tmp/tmpfs-test.txt', 'written to tmpfs');
        console.log('Tmpfs written');
        
        // List each mount
        console.log('Overlay files:', fs.readdirSync('/mnt/overlay').join(', '));
        console.log('Bind files:', fs.readdirSync('/mnt/bind').join(', '));
        console.log('Tmp files:', fs.readdirSync('/tmp').join(', '));
      `],
      env: bunEnv,
      container: {
        namespace: {
          user: true,
          pid: true,
        },
        fs: [
          {
            type: "overlayfs",
            to: "/mnt/overlay",
            options: {
              overlayfs: {
                lower_dirs: [lowerDir],
                upper_dir: upperDir,
                work_dir: workDir,
              },
            },
          },
          {
            type: "bind",
            from: bindDir,
            to: "/mnt/bind",
          },
          {
            type: "tmpfs",
            to: "/tmp",
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
    expect(stdout).toContain("Overlay: from overlay lower");
    expect(stdout).toContain("Bind: from bind mount");
    expect(stdout).toContain("Tmpfs written");
    expect(stdout).toContain("new.txt");
    expect(stdout).toContain("bind.txt");
    expect(stdout).toContain("tmpfs-test.txt");
  });
});