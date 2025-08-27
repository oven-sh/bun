import { test, expect, describe } from "bun:test";
import { bunExe, bunEnv, tempDirWithFiles, tmpdirSync } from "harness";
import path from "node:path";
import fs from "node:fs";

describe("container pivot_root", () => {
  // Skip all tests if not Linux
  if (process.platform !== "linux") {
    test.skip("pivot_root tests are Linux-only", () => {});
    return;
  }

  test("pivot_root changes filesystem root", async () => {
    // Create a new root filesystem
    const newRoot = tempDirWithFiles("pivot-root-test", {
      "bin/echo": fs.readFileSync("/bin/echo"),
      "bin/ls": fs.readFileSync("/bin/ls"),  
      "etc/passwd": "root:x:0:0:root:/root:/bin/sh\n",
      "home/test.txt": "inside new root",
      "tmp/.keep": "",
    });

    // Make binaries executable
    fs.chmodSync(path.join(newRoot, "bin/echo"), 0o755);
    fs.chmodSync(path.join(newRoot, "bin/ls"), 0o755);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `
        const fs = require('fs');
        
        // Before pivot_root, we're in the host filesystem
        console.log('Current root contents:', fs.readdirSync('/').join(', '));
        
        // After pivot_root, we should be in the new root
        // Check if we can see our test file
        try {
          const content = fs.readFileSync('/home/test.txt', 'utf8');
          console.log('Test file:', content);
        } catch (e) {
          console.log('ERROR: Could not read test file:', e.message);
        }
        
        // Old root should be unmounted and inaccessible
        try {
          fs.readdirSync('/.old_root');
          console.log('ERROR: Old root is still accessible');
        } catch (e) {
          console.log('Old root properly unmounted');
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
            type: "bind",
            from: newRoot,
            to: "/newroot",
          },
        ],
        pivot_root: "/newroot",
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
    expect(stdout).toContain("Test file: inside new root");
    expect(stdout).toContain("Old root properly unmounted");
    expect(stdout).not.toContain("ERROR: Could not read test file");
    expect(stdout).not.toContain("ERROR: Old root is still accessible");
  });

  test("pivot_root with tmpfs as new root", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `
        const fs = require('fs');
        
        // Create some files in the tmpfs root
        fs.writeFileSync('/test.txt', 'in tmpfs root');
        fs.mkdirSync('/app', { recursive: true });
        fs.writeFileSync('/app/data.txt', 'app data');
        
        // List root contents
        const files = fs.readdirSync('/');
        console.log('Root contents:', files.sort().join(', '));
        
        // Verify we're in the tmpfs
        const content = fs.readFileSync('/test.txt', 'utf8');
        console.log('Test file:', content);
        
        // Check that we can't access host filesystem
        const hasHostDirs = files.includes('usr') || files.includes('etc') || files.includes('var');
        console.log('Has host dirs:', hasHostDirs);
      `],
      env: bunEnv,
      container: {
        namespace: {
          user: true,
          pid: true,
        },
        fs: [
          {
            type: "tmpfs",
            to: "/tmproot",
            options: { tmpfs: { size: 10 * 1024 * 1024 } },
          },
        ],
        pivot_root: "/tmproot",
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
    expect(stdout).toContain("Test file: in tmpfs root");
    expect(stdout).toContain("app");
    expect(stdout).toContain("test.txt");
    expect(stdout).toContain("Has host dirs: false");
  });

  test("pivot_root with overlayfs", async () => {
    // Create lower layer with base system files
    const lowerDir = tempDirWithFiles("pivot-overlay-lower", {
      "bin/sh": fs.readFileSync("/bin/sh"),
      "etc/hostname": "container",
      "usr/share/data.txt": "from lower layer",
    });
    fs.chmodSync(path.join(lowerDir, "bin/sh"), 0o755);

    // Create upper and work dirs for overlayfs
    const upperDir = path.join(tmpdirSync(), "pivot-overlay-upper");
    const workDir = path.join(tmpdirSync(), "pivot-overlay-work");
    fs.mkdirSync(upperDir, { recursive: true });
    fs.mkdirSync(workDir, { recursive: true });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `
        const fs = require('fs');
        
        // We should be in the overlay root
        console.log('Root contents:', fs.readdirSync('/').sort().join(', '));
        
        // Read file from lower layer
        const lowerContent = fs.readFileSync('/usr/share/data.txt', 'utf8');
        console.log('Lower layer file:', lowerContent);
        
        // Write new file (goes to upper layer)
        fs.writeFileSync('/newfile.txt', 'created after pivot');
        console.log('Created new file');
        
        // Verify hostname from lower layer
        const hostname = fs.readFileSync('/etc/hostname', 'utf8').trim();
        console.log('Hostname:', hostname);
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
            to: "/overlay",
            options: {
              overlayfs: {
                lower_dirs: [lowerDir],
                upper_dir: upperDir,
                work_dir: workDir,
              },
            },
          },
        ],
        pivot_root: "/overlay",
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
    expect(stdout).toContain("Lower layer file: from lower layer");
    expect(stdout).toContain("Created new file");
    expect(stdout).toContain("Hostname: container");
    expect(stdout).toContain("bin");
    expect(stdout).toContain("etc");
    expect(stdout).toContain("usr");
  });

  test("pivot_root requires mount namespace", async () => {
    // Try to pivot_root without mount namespace - should fail
    const newRoot = tempDirWithFiles("pivot-no-mount-ns", {
      "test.txt": "test",
    });

    try {
      await using proc = Bun.spawn({
        cmd: ["echo", "test"],
        container: {
          namespace: {
            user: true,
            pid: true,
            // Note: no mount namespace
          },
          pivot_root: newRoot,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      // Should fail because pivot_root requires mount namespace
      expect(exitCode).not.toBe(0);
    } catch (e: any) {
      // Expected to fail
      expect(e.message).toContain("pivot_root");
    }
  });
});