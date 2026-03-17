import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import fs from "node:fs";
import path from "path";

// https://github.com/oven-sh/bun/issues/28038
// fs.watch() should not throw EACCES when a file inside the watched directory
// is not readable. Like Node.js/libuv, the directory-level inotify watch is
// sufficient — individual files don't need to be opened.
describe("issue #28038", () => {
  test.skipIf(isWindows)("fs.watch should not error when directory contains unreadable files", async () => {
    using dir = tempDir("watch-eacces", {});
    const dirStr = String(dir);

    // Create a file that is not world-readable
    const privatePath = path.join(dirStr, "private.txt");
    fs.writeFileSync(privatePath, "secret");
    fs.chmodSync(privatePath, 0o000);

    // Create a normal file we'll modify to trigger events
    const normalPath = path.join(dirStr, "normal.txt");
    fs.writeFileSync(normalPath, "hello");
    fs.chmodSync(normalPath, 0o666);

    // Make directory world-accessible so subprocess can list it
    fs.chmodSync(dirStr, 0o777);

    // Write the watch script to a temp file to avoid quoting issues with su -c
    const scriptPath = path.join(dirStr, "watch-script.js");
    fs.writeFileSync(
      scriptPath,
      `
      const fs = require("fs");
      const dir = ${JSON.stringify(dirStr)};
      const normalPath = ${JSON.stringify(normalPath)};

      try {
        const watcher = fs.watch(dir, (eventType, filename) => {
          if (filename === "normal.txt") {
            console.log("OK:" + eventType + ":" + filename);
            watcher.close();
            process.exit(0);
          }
        });
        watcher.on("error", (err) => {
          console.log("ERROR:" + err.code);
          watcher.close();
          process.exit(1);
        });
        // Trigger a file write on next tick — the watcher is already active
        // after fs.watch() returns synchronously.
        process.nextTick(() => {
          fs.writeFileSync(normalPath, "world");
        });
      } catch (e) {
        console.log("THROW:" + e.code);
        process.exit(1);
      }
    `,
    );
    fs.chmodSync(scriptPath, 0o644);

    // If running as root, use su to drop privileges so the EACCES path is exercised.
    // Otherwise just run directly (the test will still work if the current user
    // doesn't own private.txt).
    const isRoot = process.getuid?.() === 0;
    const cmd = isRoot
      ? ["su", "-s", "/bin/bash", "nobody", "-c", `${bunExe()} ${scriptPath}`]
      : [bunExe(), scriptPath];

    await using proc = Bun.spawn({
      cmd,
      env: { ...bunEnv, TMPDIR: "/tmp" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The watcher should have received a change event for normal.txt
    expect(stdout).toContain("OK:");
    expect(exitCode).toBe(0);

    // Restore permissions for cleanup
    fs.chmodSync(privatePath, 0o644);
  });

  test.skipIf(isWindows)("fs.watch recursive should not error when directory contains unreadable files", async () => {
    using dir = tempDir("watch-eacces-recursive", {});
    const dirStr = String(dir);

    // Create a subdirectory with an unreadable file
    const subDir = path.join(dirStr, "sub");
    fs.mkdirSync(subDir);
    const privatePath = path.join(subDir, "private.txt");
    fs.writeFileSync(privatePath, "secret");
    fs.chmodSync(privatePath, 0o000);

    // Create a normal file we'll modify to trigger events
    const normalPath = path.join(subDir, "normal.txt");
    fs.writeFileSync(normalPath, "hello");
    fs.chmodSync(normalPath, 0o666);

    // Make directories world-accessible so subprocess can list them
    fs.chmodSync(subDir, 0o777);
    fs.chmodSync(dirStr, 0o777);

    const scriptPath = path.join(dirStr, "watch-script-recursive.js");
    fs.writeFileSync(
      scriptPath,
      `
      const fs = require("fs");
      const dir = ${JSON.stringify(dirStr)};
      const normalPath = ${JSON.stringify(normalPath)};

      try {
        const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
          if (filename && filename.includes("normal.txt")) {
            console.log("OK:" + eventType + ":" + filename);
            watcher.close();
            process.exit(0);
          }
        });
        watcher.on("error", (err) => {
          console.log("ERROR:" + err.code);
          watcher.close();
          process.exit(1);
        });
        // Subdirectory inotify watches are set up asynchronously by a
        // worker thread, so repeat the write until the event is caught.
        let counter = 0;
        const interval = setInterval(() => {
          fs.writeFileSync(normalPath, "world" + (counter++));
        }, 20);
        watcher.on("close", () => clearInterval(interval));
      } catch (e) {
        console.log("THROW:" + e.code);
        process.exit(1);
      }
    `,
    );
    fs.chmodSync(scriptPath, 0o644);

    const isRoot = process.getuid?.() === 0;
    const cmd = isRoot
      ? ["su", "-s", "/bin/bash", "nobody", "-c", `${bunExe()} ${scriptPath}`]
      : [bunExe(), scriptPath];

    await using proc = Bun.spawn({
      cmd,
      env: { ...bunEnv, TMPDIR: "/tmp" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("OK:");
    expect(exitCode).toBe(0);

    // Restore permissions for cleanup
    fs.chmodSync(privatePath, 0o644);
  });

  test.skipIf(isWindows)("fs.watch should emit events for dotfiles", async () => {
    using dir = tempDir("watch-dotfile", {});
    const dirStr = String(dir);
    const dotfile = path.join(dirStr, ".env");
    fs.writeFileSync(dotfile, "FOO=bar");

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const fs = require("fs");
        const watcher = fs.watch(${JSON.stringify(dirStr)}, (eventType, filename) => {
          if (filename === ".env") {
            console.log("OK:" + eventType + ":" + filename);
            watcher.close();
            process.exit(0);
          }
        });
        process.nextTick(() => {
          fs.writeFileSync(${JSON.stringify(dotfile)}, "FOO=baz");
        });
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("OK:");
    expect(exitCode).toBe(0);
  });
});
