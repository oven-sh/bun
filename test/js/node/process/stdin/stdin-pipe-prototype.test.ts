import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("pipe stdin does not leak per-read chunks", async () => {
  // onReadChunk hands each chunk to JS via createBuffer, which memcpy's into
  // a JS-owned Uint8Array. A previous revision dupe()'d the reader buffer
  // first and never freed it, leaking every byte read. Pump ~256MB through
  // and assert the child's RSS stays well under that.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        let warmed = false;
        let baseline = 0;
        let received = 0;
        process.stdin.on("data", d => {
          received += d.length;
          // First chunk: reader/poll/JS buffer machinery is live. Sample here
          // so we measure only per-read growth, not one-time setup.
          if (!warmed) {
            warmed = true;
            Bun.gc(true);
            baseline = process.memoryUsage.rss();
          }
        });
        process.stdin.on("end", () => {
          Bun.gc(true);
          const after = process.memoryUsage.rss();
          const deltaMB = Math.round((after - baseline) / 1024 / 1024);
          console.log(JSON.stringify({
            handle: process.stdin._handle?.constructor?.name,
            received,
            deltaMB,
          }));
        });
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const chunk = Buffer.alloc(256 * 1024, "a");
  const totalBytes = 256 * 1024 * 1024;
  for (let written = 0; written < totalBytes; written += chunk.length) {
    proc.stdin.write(chunk);
    await proc.stdin.flush();
  }
  await proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const result = JSON.parse(stdout.trim());
  expect(result.handle).toBe("Pipe");
  expect(result.received).toBe(totalBytes);
  // With the leak, delta grows ≈ totalBytes (256MB). Without it, growth is
  // bounded; 128MB sits well above the debug/ASAN allocator baseline (~70MB)
  // and well below the 256MB a full leak would show.
  expect(result.deltaMB).toBeLessThan(128);
  expect(exitCode).toBe(0);
});

test("pipe stdin is a net.Socket with a Pipe handle", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const net = require("net");
        const result = {
          isSocket: process.stdin instanceof net.Socket,
          handle: process.stdin._handle?.constructor?.name,
          writable: process.stdin.writable,
          writableEnded: process.stdin.writableEnded,
          endIsFunction: typeof process.stdin.end === "function",
          // readableHighWaterMark default differs by platform (64K posix,
          // 16K Windows), so only assert it is a positive number.
          hwmPositive: process.stdin.readableHighWaterMark > 0,
        };
        let buf = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", d => buf += d);
        process.stdin.on("end", () => {
          result.data = buf;
          result.gotEnd = true;
          console.log(JSON.stringify(result));
        });
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  proc.stdin.write("hello-pipe-stdin");
  await proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({
    isSocket: true,
    handle: "Pipe",
    writable: false,
    writableEnded: true,
    endIsFunction: true,
    hwmPositive: true,
    data: "hello-pipe-stdin",
    gotEnd: true,
  });
  expect(exitCode).toBe(0);
});

test("file stdin is an fs.ReadStream", async () => {
  using dir = tempDir("stdin-file", { "input.txt": "hello-file-stdin" });
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const fs = require("fs");
        const net = require("net");
        let buf = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", d => buf += d);
        process.stdin.on("end", () => {
          console.log(JSON.stringify({
            isReadStream: process.stdin instanceof fs.ReadStream,
            isSocket: process.stdin instanceof net.Socket,
            data: buf,
          }));
        });
      `,
    ],
    stdin: Bun.file(String(dir) + "/input.txt"),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({
    isReadStream: true,
    isSocket: false,
    data: "hello-file-stdin",
  });
  expect(exitCode).toBe(0);
});

// Node's HandleWrap.close(cb) fires the callback after the handle closes. The
// Pipe declares close with length 1 (close(cb)), so a direct
// process.binding("pipe_wrap") user passing a callback must see it invoked —
// not silently dropped.
test("pipe_wrap Pipe.close(cb) invokes the callback", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { Pipe, constants } = process.binding("pipe_wrap");
        const p = new Pipe(constants.SOCKET);
        // fd 0 is this child's stdin pipe (spawned with stdin: "pipe").
        p.open(0);
        let called = false;
        p.close(() => {
          called = true;
          console.log("closed-cb-fired");
        });
        // The callback is scheduled (microtask/next tick), not synchronous.
        if (called) throw new Error("close callback fired synchronously");
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("closed-cb-fired");
  expect(exitCode).toBe(0);
});

// The Pipe handle doesn't own the fd (open() clears CLOSE_HANDLE), so closing
// the reader must drop the poll + loop keepalive directly — reader.close() is a
// no-op on POSIX without an fd to close. destroy()ing a reading stdin while the
// writer holds the pipe open must still let the process exit; a regression here
// leaves the poll registered + ref'd and hangs forever.
test("process.stdin.destroy() while reading lets the process exit", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        // on("data") arms the reader (readStart -> poll registered + loop
        // keepalive). destroy() must tear it back down.
        process.stdin.on("data", () => {});
        process.stdin.resume();
        process.stdin.destroy();
      `,
    ],
    // Parent holds the write end open (never written/ended): the child must
    // exit on its own, proving the keepalive was released by destroy().
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// After EOF the reader is torn down (reader_terminated). Pushing EOF runs the
// readable machine, which can fire read(0) -> _read -> readStart again; without
// a DONE guard that re-arm registers a fresh poll on the drained fd that
// outlives the Pipe, so GC finalize frees the struct out from under the live
// poll -> heap-use-after-free (ASAN) / hang. This exercises that path: data
// then EOF on a stdin that was pause()/resume()'d.
test("process.stdin after pause/resume survives EOF without use-after-free", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        process.stdin.on("data", chunk => process.stdout.write(chunk));
        process.stdin.pause();
        process.stdin.resume();
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  proc.stdin.write("hello\n");
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // stderr must be empty — an ASAN UAF report would land here.
  expect(stderr).toBe("");
  expect(stdout).toBe("hello\n");
  expect(exitCode).toBe(0);
});
