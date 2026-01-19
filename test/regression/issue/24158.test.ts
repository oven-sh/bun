import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isMacOS } from "harness";

// https://github.com/oven-sh/bun/issues/24158
// tty.WriteStream fails with EINVAL: invalid argument, kqueue on macOS
// when opening /dev/tty because kqueue cannot monitor /dev/tty on macOS.
describe.if(isMacOS)("issue #24158", () => {
  it("tty.WriteStream should work with /dev/tty", async () => {
    // We can't test /dev/tty directly in unit tests as it requires an actual terminal.
    // Instead, spawn a subprocess that attempts to create the WriteStream.
    // If the bug is present, it will throw EINVAL from kqueue.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const tty = require('node:tty');
        const fs = require('node:fs');

        try {
          // Only run this test if /dev/tty exists and is accessible
          const fd = fs.openSync("/dev/tty", "w");
          const stream = new tty.WriteStream(fd);
          stream.write("test");
          stream.end();
          fs.closeSync(fd);
          console.log("success");
        } catch (e) {
          // If /dev/tty is not available (e.g., in CI without a TTY),
          // that's expected - we're testing that it doesn't fail with EINVAL from kqueue
          if (e.code === 'ENXIO' || e.code === 'ENOENT' || e.code === 'ENOTTY' || e.message.includes('not a tty')) {
            console.log("no-tty");
          } else {
            console.error("error:", e.code || e.message);
            process.exit(1);
          }
        }
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The key assertion: if the bug is present, we'd see "error: EINVAL" or the process would crash
    // with "EINVAL: invalid argument, kqueue"
    if (stdout.trim() === "success" || stdout.trim() === "no-tty") {
      expect(exitCode).toBe(0);
    } else {
      // If there's an error, it should not be EINVAL from kqueue
      expect(stderr).not.toContain("kqueue");
      expect(stderr).not.toContain("EINVAL");
      expect(stdout).not.toContain("error: EINVAL");
    }
  });

  it("Bun.file(fd).writer() should work with TTY fds", async () => {
    // Test the direct code path that was causing the issue:
    // Bun.file(fd).writer() -> FileSink.setup() -> writer.start()
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const fs = require('node:fs');

        try {
          const fd = fs.openSync("/dev/tty", "w");
          const writer = Bun.file(fd).writer();
          writer.write("test");
          writer.end();
          console.log("success");
        } catch (e) {
          if (e.code === 'ENXIO' || e.code === 'ENOENT' || e.code === 'ENOTTY' || e.message?.includes('not a tty')) {
            console.log("no-tty");
          } else {
            console.error("error:", e.code || e.message);
            process.exit(1);
          }
        }
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (stdout.trim() === "success" || stdout.trim() === "no-tty") {
      expect(exitCode).toBe(0);
    } else {
      expect(stderr).not.toContain("kqueue");
      expect(stderr).not.toContain("EINVAL");
      expect(stdout).not.toContain("error: EINVAL");
    }
  });
});
