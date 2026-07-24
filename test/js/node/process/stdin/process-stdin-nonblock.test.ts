// Once `process.stdin` starts reading, Node/libuv put the stdin file
// descriptor into nonblocking mode (`uv_pipe_open` / `uv_tty_init` both call
// `uv__nonblock(fd, 1)`). Bun used to leave fd 0 untouched, so a direct
// `fs.readSync(0, buf)` afterwards would block on an empty pipe (or, on a raw
// TTY, return one keystroke at a time) instead of throwing `EAGAIN` like Node.
// https://github.com/oven-sh/bun/issues/5305
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import path from "node:path";

// O_NONBLOCK is a Unix fd flag; the Windows stdin path is libuv-backed and
// `fs.readSync` there never observes EAGAIN.
test.skipIf(!isPosix)(
  "fs.readSync(0) throws EAGAIN once process.stdin is reading (pipe)",
  async () => {
    const script = `
      const fs = require("fs");
      const readline = require("readline");
      readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        const n = fs.readSync(0, Buffer.alloc(64));
        console.log("RETURNED:" + n);
      } catch (e) {
        console.log("ERROR:" + e.code);
      }
      process.exit(0);
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Without the fix the child is parked in a blocking read() on fd 0, so the
    // only way to distinguish pass from fail is a deadline. Closing stdin would
    // unblock that read with a 0-byte result, which masks the bug; keeping the
    // write end open forces the blocking read to stay blocked.
    const exited = await Promise.race([proc.exited, Bun.sleep(30_000).then(() => "timeout" as const)]);
    if (exited === "timeout") {
      proc.kill(9);
      await proc.exited;
    }

    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);

    expect(stderr).toBe("");
    expect({ stdout: stdout.trim(), exited }).toEqual({ stdout: "ERROR:EAGAIN", exited: 0 });
  },
  60_000,
);

test.skipIf(!isPosix)("fd 0 is left alone when stdin is a regular file", async () => {
  // O_NONBLOCK is meaningless on a regular file; the reader should leave the
  // fd flags untouched so `fs.readSync(0, buf)` keeps returning data.
  using dir = tempDir("stdin-nonblock-file", {
    "in.txt": "regular file body\n",
  });

  const script = `
    const fs = require("fs");
    process.stdin.resume();
    const buf = Buffer.alloc(16);
    const n = fs.readSync(0, buf);
    console.log("READ:" + n + ":" + buf.toString("utf8", 0, n));
    process.exit(0);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdin: Bun.file(path.join(String(dir), "in.txt")),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("READ:16:regular file bod");
  expect(exitCode).toBe(0);
});

test.skipIf(!isPosix)("process.stdin still delivers data over a nonblocking pipe", async () => {
  const script = `
    let got = "";
    process.stdin.on("data", d => (got += d));
    process.stdin.on("end", () => console.log("GOT:" + got));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write("hello world");
  await proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("GOT:hello world");
  expect(exitCode).toBe(0);
});
