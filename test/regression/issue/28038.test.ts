import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import fs from "node:fs";
import path from "path";

// https://github.com/oven-sh/bun/issues/28038
// fs.watch() on a directory must not fail when a file inside is unreadable.
// libuv's uv_fs_event_start calls inotify_add_watch(path) once and never
// opens individual files; Bun was iterating entries and open()ing each.
describe("issue #28038", () => {
  test.skipIf(isWindows)("fs.watch does not open individual files inside the watched directory", async () => {
    using dir = tempDir("watch-eacces", {});
    const dirStr = String(dir);

    const privatePath = path.join(dirStr, "private.txt");
    fs.writeFileSync(privatePath, "secret");
    fs.chmodSync(privatePath, 0o000);

    const normalPath = path.join(dirStr, "normal.txt");
    fs.writeFileSync(normalPath, "hello");
    fs.chmodSync(normalPath, 0o666);

    fs.chmodSync(dirStr, 0o777);

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
          process.exit(1);
        });
        process.nextTick(() => fs.writeFileSync(normalPath, "world"));
      } catch (e) {
        console.log("THROW:" + e.code);
        process.exit(1);
      }
    `,
    );
    fs.chmodSync(scriptPath, 0o644);

    // Running as root bypasses chmod; drop to nobody so EACCES is real.
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

    expect(stderr).toBe("");
    expect(stdout).toContain("OK:");
    expect(exitCode).toBe(0);

    fs.chmodSync(privatePath, 0o644);
  });

  test.skipIf(isWindows)("recursive fs.watch does not open individual files", async () => {
    using dir = tempDir("watch-eacces-recursive", {});
    const dirStr = String(dir);

    const subDir = path.join(dirStr, "sub");
    fs.mkdirSync(subDir);
    const privatePath = path.join(subDir, "private.txt");
    fs.writeFileSync(privatePath, "secret");
    fs.chmodSync(privatePath, 0o000);

    const normalPath = path.join(subDir, "normal.txt");
    fs.writeFileSync(normalPath, "hello");
    fs.chmodSync(normalPath, 0o666);

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
          process.exit(1);
        });
        // Subdirectory inotify watches are set up asynchronously by a
        // worker thread, so retry the write until the event is caught.
        let i = 0;
        const interval = setInterval(() => fs.writeFileSync(normalPath, "world" + i++), 20);
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

    expect(stderr).toBe("");
    expect(stdout).toContain("OK:");
    expect(exitCode).toBe(0);

    fs.chmodSync(privatePath, 0o644);
  });

  test.skipIf(isWindows)("fs.watch emits events for dotfiles", async () => {
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
        process.nextTick(() => fs.writeFileSync(${JSON.stringify(dotfile)}, "FOO=baz"));
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toContain("OK:");
    expect(exitCode).toBe(0);
  });

  test.skipIf(!isLinux)("fs.watch emits change on chmod (IN_ATTRIB)", async () => {
    using dir = tempDir("watch-attrib", {});
    const dirStr = String(dir);
    const file = path.join(dirStr, "file.txt");
    fs.writeFileSync(file, "hello");

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const fs = require("fs");
        const watcher = fs.watch(${JSON.stringify(dirStr)}, (eventType, filename) => {
          if (filename === "file.txt" && eventType === "change") {
            console.log("OK:change:file.txt");
            watcher.close();
            process.exit(0);
          }
        });
        process.nextTick(() => fs.chmodSync(${JSON.stringify(file)}, 0o755));
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toContain("OK:change:file.txt");
    expect(exitCode).toBe(0);
  });

  test.skipIf(!isLinux)("recursive fs.watch auto-registers newly created subdirectories", async () => {
    using dir = tempDir("watch-new-subdir", {});
    const dirStr = String(dir);

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const fs = require("fs");
        const path = require("path");
        const dir = ${JSON.stringify(dirStr)};
        const subDir = path.join(dir, "new-subdir");
        const child = path.join(subDir, "child.txt");

        const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
          if (filename && filename.includes("child.txt")) {
            console.log("OK:" + eventType + ":" + filename);
            watcher.close();
            process.exit(0);
          }
        });

        // Create subdir then repeatedly write to the child file until the
        // inotify watch on the new subdir is registered and catches the write.
        process.nextTick(() => {
          fs.mkdirSync(subDir);
          let i = 0;
          const interval = setInterval(() => fs.writeFileSync(child, "x" + i++), 20);
          watcher.on("close", () => clearInterval(interval));
        });
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toContain("OK:");
    expect(stdout).toContain("child.txt");
    expect(exitCode).toBe(0);
  });
});
