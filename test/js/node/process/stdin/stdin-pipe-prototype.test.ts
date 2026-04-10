import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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
          hwm: process.stdin.readableHighWaterMark,
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
    hwm: 65536,
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
