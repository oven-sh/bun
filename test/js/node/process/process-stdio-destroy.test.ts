import { spawn } from "bun";
import { exposedInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

// Node builds process.stdout and process.stderr as a net.Socket over a pipe, a TCP socket or a unix stream socket, and
// as a tty.WriteStream (a net.Socket too) over a terminal. Those emit 'close' on a tick of their own after destroy().
// Over a file Node builds a SyncWriteStream and over any other socket a plain Writable: there 'close' follows 'error'
// inside one tick, so a throw from the 'error' emit skips it. Both tables are the output of the fixture under Node
// v26.3.0.
const netSocket = {
  emitClose: false,
  "destroy()": ["close"],
  "destroy(err), 'error' listener": ["error boom", "close"],
  "destroy(err), no 'error' listener": ["uncaughtException boom", "close"],
  "destroy(err), 'error' listener throws": ["error boom", "uncaughtException thrown by the listener", "close"],
  "destroy(err, callback), no 'error' listener": ["callback boom", "uncaughtException boom", "close"],
  "destroy(err) twice, no 'error' listener": ["uncaughtException first", "close", "close"],
  "destroy(err) again from the 'close' listener": [
    "uncaughtException first",
    "close",
    "uncaughtException second",
    "close",
  ],
  "destroy(err) between two ticks, no 'error' listener": [
    "tick queued before destroy",
    "uncaughtException boom",
    "close",
    "tick queued after destroy",
  ],
};
const writable = {
  emitClose: true,
  "destroy()": ["close"],
  "destroy(err), 'error' listener": ["error boom", "close"],
  "destroy(err), no 'error' listener": ["uncaughtException boom"],
  "destroy(err), 'error' listener throws": ["error boom", "uncaughtException thrown by the listener"],
  "destroy(err, callback), no 'error' listener": ["callback boom", "uncaughtException boom"],
  "destroy(err) twice, no 'error' listener": ["uncaughtException first", "close"],
  "destroy(err) again from the 'close' listener": ["uncaughtException first"],
  "destroy(err) between two ticks, no 'error' listener": [
    "tick queued before destroy",
    "uncaughtException boom",
    "tick queued after destroy",
  ],
};

const fixture = path.join(import.meta.dir, "process-stdio-destroy-fixture.js");

// Runs the fixture with the given stdout and stderr. Returns its exit code and what it reported for each stream.
async function run(stdio: { stdout: "pipe" | number; stderr: "pipe" | number } | { terminal: Bun.TerminalOptions }) {
  using dir = tempDir("process-stdio-destroy", {});
  const reportPath = path.join(String(dir), "report.json");
  await using proc = spawn({ cmd: [bunExe(), fixture, reportPath], env: bunEnv, ...stdio });
  const drain = (stream: unknown) => (stream instanceof ReadableStream ? stream.text() : undefined);
  const [exitCode] = await Promise.all([proc.exited, drain(proc.stdout), drain(proc.stderr)]);
  proc.terminal?.close();
  const report = Bun.file(reportPath);
  return { exitCode, ...((await report.exists()) ? await report.json() : {}) };
}

// Not concurrent: a debug build needs about 2.5 s to load process.stdout in each child, and six children at once come
// close to the default timeout.
describe("process.stdout and process.stderr after destroy()", () => {
  // Bun.spawn's "pipe" is a unix socketpair on POSIX and a named pipe on Windows.
  test("socket: as Node's net.Socket", async () => {
    expect(await run({ stdout: "pipe", stderr: "pipe" })).toEqual({
      exitCode: 0,
      stdout: netSocket,
      stderr: netSocket,
    });
  });

  // Windows reports every socket as a pipe, which the row above covers.
  test.skipIf(isWindows)("TCP socket: as Node's net.Socket", async () => {
    const server = net.createServer().listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const client = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
      try {
        await once(client, "connect");
        const { fd } = (client as unknown as { _handle: { fd: number } })._handle;
        expect(await run({ stdout: fd, stderr: fd })).toEqual({ exitCode: 0, stdout: netSocket, stderr: netSocket });
      } finally {
        client.destroy();
      }
    } finally {
      server.close();
    }
  });

  test.skipIf(isWindows)("FIFO: as Node's net.Socket", async () => {
    using dir = tempDir("process-stdio-destroy-fifo", {});
    const fifo = path.join(String(dir), "fifo");
    mkfifo(fifo);
    // The read end comes first and does not block, so that the open for writing returns.
    const readEnd = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const writeEnd = fs.openSync(fifo, "w");
    try {
      expect(await run({ stdout: writeEnd, stderr: writeEnd })).toEqual({
        exitCode: 0,
        stdout: netSocket,
        stderr: netSocket,
      });
    } finally {
      fs.closeSync(writeEnd);
      fs.closeSync(readEnd);
    }
  });

  test("terminal: as Node's tty.WriteStream", async () => {
    expect(await run({ terminal: {} })).toEqual({ exitCode: 0, stdout: netSocket, stderr: netSocket });
  });

  test("file: as Node's SyncWriteStream", async () => {
    using dir = tempDir("process-stdio-destroy-file", {});
    const fd = fs.openSync(path.join(String(dir), "out.txt"), "w");
    try {
      expect(await run({ stdout: fd, stderr: fd })).toEqual({ exitCode: 0, stdout: writable, stderr: writable });
    } finally {
      fs.closeSync(fd);
    }
  });

  // Windows reports every socket as a pipe, so only POSIX tells a datagram socket apart.
  test.skipIf(isWindows)("datagram socket: as Node's plain Writable", async () => {
    const udp = exposedInternals["internal/dgram"]._createSocketHandle("127.0.0.1", 0, "udp4");
    try {
      expect(await run({ stdout: udp.fd, stderr: udp.fd })).toEqual({
        exitCode: 0,
        stdout: writable,
        stderr: writable,
      });
    } finally {
      udp.close();
    }
  });
});

// With no 'error' listener and no uncaughtException handler the error is fatal.
describe.concurrent("a fatal process.stdout.destroy(err)", () => {
  async function exitCodeOf(script: string) {
    await using proc = spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [exitCode] = await Promise.all([proc.exited, proc.stdout.text(), proc.stderr.text()]);
    return exitCode;
  }

  test("exits with code 1", async () => {
    expect(await exitCodeOf(`process.stdout.destroy(new Error("boom"));`)).toBe(1);
  });

  // Node exits at the error, so no 'close' listener runs. Bun reports the error and then runs the ticks that are
  // queued behind it, and 'close' is one of them: https://github.com/oven-sh/bun/pull/34661
  test.failing("runs no 'close' listener", async () => {
    const script = `process.stdout.on("close", () => process.exit(0)); process.stdout.destroy(new Error("boom"));`;
    expect(await exitCodeOf(script)).toBe(1);
  });
});
