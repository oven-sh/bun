// Once `process.stdin` starts reading, Node/libuv put the stdin file
// descriptor into nonblocking mode (`uv_pipe_open` / `uv_tty_init` both call
// `uv__nonblock(fd, 1)`). Bun used to leave fd 0 untouched, so a direct
// `fs.readSync(0, buf)` afterwards would block on an empty pipe (or, on a raw
// TTY, return one keystroke at a time) instead of throwing `EAGAIN` like Node.
// https://github.com/oven-sh/bun/issues/5305
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isPosix, libcPathForDlopen, tempDir } from "harness";
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

test.skipIf(!isPosix)(
  "tty stdin: fd 0 becomes nonblocking and keeps its access mode",
  async () => {
    // Bun.spawn({ terminal }) hands the child a pty slave on fd 0/1/2.
    // After process.stdin starts, fd 0 should be swapped for a fresh
    // nonblocking file description with the original O_RDWR access mode, so
    // fs.writeSync(0, ...) still succeeds and fs.readSync(0, ...) sees EAGAIN.
    const script = `
      const fs = require("fs");
      process.stdin.resume();
      let write = "ok";
      try { fs.writeSync(0, "x"); } catch (e) { write = e.code; }
      // Drain anything the pty already buffered, then the next read must
      // throw EAGAIN because fd 0 is nonblocking.
      let read;
      for (;;) {
        try {
          if (fs.readSync(0, Buffer.alloc(256)) === 0) { read = "EOF"; break; }
        } catch (e) { read = e.code; break; }
      }
      process.stdout.write("RESULT " + JSON.stringify({ isTTY: process.stdin.isTTY, write, read }));
      process.exit(0);
    `;

    let output = "";
    const decoder = new TextDecoder();
    const done = Promise.withResolvers<void>();

    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      terminal: {
        cols: 200,
        rows: 24,
        data(_t, chunk: Uint8Array) {
          output += decoder.decode(chunk, { stream: true });
          if (output.includes("RESULT ") && output.includes("}")) done.resolve();
        },
        exit() {
          done.resolve();
        },
      },
    });

    await Promise.race([done.promise, Bun.sleep(30_000)]);
    proc.kill();
    await proc.exited;
    proc.terminal?.close();
    output += decoder.decode();

    const stripped = Bun.stripANSI(output).replace(/[\r\n]/g, "");
    const match = stripped.match(/RESULT (\{[^}]*\})/);
    if (!match) {
      throw new Error("child did not emit RESULT; terminal output was: " + JSON.stringify(output));
    }
    expect(JSON.parse(match[1])).toEqual({ isTTY: true, write: "ok", read: "EAGAIN" });
  },
  60_000,
);

// `libcPathForDlopen()` covers glibc/musl/darwin; FreeBSD is not mapped yet.
test.skipIf(!(isLinux || isMacOS))("O_NONBLOCK on pipe stdin is restored when bun exits", async () => {
  // `producer | { bun; sibling }` share one read-end file description. Node
  // restores its startup O_NONBLOCK bit on the way out (ResetStdio); Bun
  // should too so `sibling` does not inherit a nonblocking stdin.
  using dir = tempDir("stdin-nonblock-restore", {
    // fs.readSync(0) on a pipe whose write end is already closed returns 0
    // either way, so probe the O_NONBLOCK bit directly via fcntl(F_GETFL).
    "probe.js": `
      const { dlopen, FFIType } = require("bun:ffi");
      const { symbols: { fcntl } } = dlopen(process.env.LIBC, {
        fcntl: { args: [FFIType.int, FFIType.int, FFIType.int], returns: FFIType.int },
      });
      const { O_NONBLOCK } = require("node:fs").constants;
      console.log((fcntl(0, 3, 0) & O_NONBLOCK) ? "NONBLOCKING" : "BLOCKING");
    `,
    "middle.js": `process.stdin.resume(); process.exit(0);`,
  });

  await using proc = Bun.spawn({
    cmd: ["sh", "-c", `"$BUN" probe.js && "$BUN" middle.js && "$BUN" probe.js`],
    env: { ...bunEnv, BUN: bunExe(), LIBC: libcPathForDlopen() },
    cwd: String(dir),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim().split("\n")).toEqual(["BLOCKING", "BLOCKING"]);
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
