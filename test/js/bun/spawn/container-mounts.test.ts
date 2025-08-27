import { test, expect, describe } from "bun:test";
import { bunExe, bunEnv, tempDirWithFiles } from "harness";
import path from "node:path";

describe("container mount namespace", () => {
  // Skip all tests if not Linux
  if (process.platform !== "linux") {
    test.skip("mount tests are Linux-only", () => {});
    return;
  }

  test("tmpfs mount creates isolated temporary filesystem", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `
        const fs = require('fs');
        
        // Write to /tmp in container
        fs.writeFileSync('/tmp/container-test.txt', 'hello from container');
        
        // Read it back
        const content = fs.readFileSync('/tmp/container-test.txt', 'utf8');
        console.log('Content:', content);
        
        // List /tmp
        const files = fs.readdirSync('/tmp');
        console.log('Files in /tmp:', files.join(', '));
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
            to: "/tmp",
            options: { tmpfs: { size: 10 * 1024 * 1024 } }, // 10MB
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
    expect(stdout).toContain("Content: hello from container");
    expect(stdout).toContain("container-test.txt");
    
    // Verify the file doesn't exist on host /tmp
    const hostTmpFiles = await Bun.file("/tmp/container-test.txt").exists();
    expect(hostTmpFiles).toBe(false);
  });

  test("bind mount allows sharing directories with host", async () => {
    const testDir = tempDirWithFiles("mount-test", {
      "host-file.txt": "content from host",
      "subdir/nested.txt": "nested content",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `
        const fs = require('fs');
        
        // Read file from bind mount
        const content = fs.readFileSync('/mnt/test/host-file.txt', 'utf8');
        console.log('Host file:', content);
        
        // List mounted directory
        const files = fs.readdirSync('/mnt/test');
        console.log('Mounted files:', files.join(', '));
        
        // Try to write (should work since not readonly)
        fs.writeFileSync('/mnt/test/container-created.txt', 'created in container');
        console.log('Write succeeded');
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
            from: testDir,
            to: "/mnt/test",
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
    expect(stdout).toContain("Host file: content from host");
    expect(stdout).toContain("host-file.txt");
    expect(stdout).toContain("subdir");
    expect(stdout).toContain("Write succeeded");
    
    // Verify file was created on host
    const createdFile = await Bun.file(path.join(testDir, "container-created.txt")).text();
    expect(createdFile).toBe("created in container");
  });

  test("readonly bind mount prevents writes", async () => {
    const testDir = tempDirWithFiles("readonly-mount-test", {
      "readonly-file.txt": "readonly content",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `
        const fs = require('fs');
        
        // Read should work
        const content = fs.readFileSync('/mnt/readonly/readonly-file.txt', 'utf8');
        console.log('Read:', content);
        
        // Write should fail
        try {
          fs.writeFileSync('/mnt/readonly/new-file.txt', 'should fail');
          console.log('ERROR: Write succeeded when it should have failed');
        } catch (e) {
          console.log('Write failed as expected:', e.code);
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
            from: testDir,
            to: "/mnt/readonly",
            options: { bind: { readonly: true } },
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
    expect(stdout).toContain("Read: readonly content");
    expect(stdout).toContain("Write failed as expected");
  });

  test("multiple mounts work together", async () => {
    const bindDir = tempDirWithFiles("multi-mount-test", {
      "bind-file.txt": "from bind mount",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `
        const fs = require('fs');
        
        // Check tmpfs mount
        fs.writeFileSync('/tmp/tmpfs-test.txt', 'tmpfs content');
        console.log('Tmpfs:', fs.readFileSync('/tmp/tmpfs-test.txt', 'utf8'));
        
        // Check bind mount
        console.log('Bind:', fs.readFileSync('/mnt/bind/bind-file.txt', 'utf8'));
        
        // List both
        console.log('Tmp files:', fs.readdirSync('/tmp').join(', '));
        console.log('Bind files:', fs.readdirSync('/mnt/bind').join(', '));
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
            to: "/tmp",
          },
          {
            type: "bind", 
            from: bindDir,
            to: "/mnt/bind",
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
    expect(stdout).toContain("Tmpfs: tmpfs content");
    expect(stdout).toContain("Bind: from bind mount");
    expect(stdout).toContain("tmpfs-test.txt");
    expect(stdout).toContain("bind-file.txt");
  });
});