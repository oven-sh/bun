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
