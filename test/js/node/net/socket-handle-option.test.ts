import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { Socket } from "node:net";
import { join } from "node:path";

const UV_EOF = -4095;

// A handle with node's StreamBase read surface: readStart(), readStop() and the
// `onread(nread, buffer)` callback that net.Socket assigns. The native one is
// the Pipe of process.binding("pipe_wrap"). This one lets the test deliver the
// reads by hand.
function createHandle() {
  let changed = Promise.withResolvers<void>();
  const handle = {
    reading: false,
    onread: undefined as undefined | ((nread: number, buffer?: Buffer) => void),
    readStartCalls: 0,
    readStopCalls: 0,
    readStart() {
      handle.readStartCalls++;
      handle.notify();
      return 0;
    },
    readStop() {
      handle.readStopCalls++;
      handle.notify();
      return 0;
    },
    close(callback?: () => void) {
      callback?.();
    },
    notify() {
      changed.resolve();
      changed = Promise.withResolvers<void>();
    },
    // Resolves at the next readStart(), readStop() or notify().
    next: () => changed.promise,
  };
  return handle;
}

test("net.Socket({ handle, manualStart }) reads through readStart() and onread", async () => {
  const handle = createHandle();
  const socket = new Socket({ handle, manualStart: true, writable: false } as any) as any;
  expect(socket._handle).toBe(handle);
  expect(typeof handle.onread).toBe("function");
  expect(handle.readStartCalls).toBe(0);

  const chunks: Buffer[] = [];
  const started = handle.next();
  socket.on("data", (chunk: Buffer) => chunks.push(chunk));
  // The 'data' listener starts the flow: _read() calls readStart().
  await started;
  expect({ readStartCalls: handle.readStartCalls, reading: handle.reading }).toEqual({
    readStartCalls: 1,
    reading: true,
  });

  const ended = once(socket, "end");
  handle.onread!(5, Buffer.from("hello"));
  handle.onread!(UV_EOF);
  await ended;

  expect(Buffer.concat(chunks).toString()).toBe("hello");
  expect(socket.bytesRead).toBe(5);
  expect(socket.writable).toBe(false);
});

test("net.Socket({ handle }) starts the handle in the constructor unless manualStart or pauseOnCreate is set", () => {
  const auto = createHandle();
  new Socket({ handle: auto, writable: false } as any);
  expect({ readStartCalls: auto.readStartCalls, reading: auto.reading }).toEqual({ readStartCalls: 1, reading: true });

  const paused = createHandle();
  const socket = new Socket({ handle: paused, writable: false, pauseOnCreate: true } as any);
  expect({ readStartCalls: paused.readStartCalls, reading: paused.reading, flowing: socket.readableFlowing }).toEqual({
    readStartCalls: 0,
    reading: false,
    flowing: false,
  });
});

test("net.Socket({ handle }) stops the handle when the read buffer is full and starts it again when it drains", async () => {
  const handle = createHandle();
  const socket = new Socket({ handle, manualStart: true, writable: false, highWaterMark: 4 } as any) as any;
  socket.read(0);
  expect(handle.readStartCalls).toBe(1);

  // 8 bytes into a 4-byte high water mark: push() returns false.
  handle.onread!(8, Buffer.from("01234567"));
  expect({ readStopCalls: handle.readStopCalls, reading: handle.reading }).toEqual({
    readStopCalls: 1,
    reading: false,
  });

  // Consuming the buffer makes the stream ask for more: _read() calls readStart().
  expect(socket.read().toString()).toBe("01234567");
  expect({ readStartCalls: handle.readStartCalls, reading: handle.reading }).toEqual({
    readStartCalls: 2,
    reading: true,
  });
  socket.destroy();
});

test("net.Socket({ handle, onread }) gives the caller's buffer to the callback", async () => {
  const handle = createHandle();
  const userBuffer = Buffer.alloc(16);
  const calls: { nread: number; buffer: Buffer }[] = [];
  const socket = new Socket({
    handle,
    manualStart: true,
    writable: false,
    onread: {
      buffer: userBuffer,
      callback(nread: number, buffer: Buffer) {
        calls.push({ nread, buffer });
      },
    },
  } as any) as any;
  // read() starts the handle of an onread socket.
  socket.read(0);
  expect(handle.readStartCalls).toBe(1);

  const handleBuffer = Buffer.from("hello");
  const ended = once(socket, "end");
  handle.onread!(5, handleBuffer);
  handle.onread!(UV_EOF);
  await ended;

  expect(calls.length).toBe(1);
  expect(calls[0].nread).toBe(5);
  expect(calls[0].buffer).toBe(userBuffer);
  expect(userBuffer.subarray(0, 5).toString()).toBe("hello");
  expect(socket.bytesRead).toBe(5);
});

// The handle reads into its own buffer, so a chunk can be larger than the
// caller's onread buffer. Every byte is delivered, one buffer at a time.
test("net.Socket({ handle, onread }) slices a chunk that is larger than the caller's buffer", async () => {
  const handle = createHandle();
  const received: string[] = [];
  const socket = new Socket({
    handle,
    manualStart: true,
    writable: false,
    onread: {
      buffer: Buffer.alloc(4),
      callback(nread: number, buffer: Buffer) {
        received.push(buffer.toString("latin1", 0, nread));
      },
    },
  } as any) as any;
  socket.read(0);

  const ended = once(socket, "end");
  handle.onread!(10, Buffer.from("0123456789"));
  handle.onread!(UV_EOF);
  await ended;

  expect(received).toEqual(["0123", "4567", "89"]);
  expect(socket.bytesRead).toBe(10);
});

// As for a native socket: a callback that returns false stops the reads. The
// rest of the chunk waits for resume(), and the handle starts again after it.
test("net.Socket({ handle, onread }) holds the rest of a chunk after the callback returns false", async () => {
  const handle = createHandle();
  const received: string[] = [];
  const socket = new Socket({
    handle,
    manualStart: true,
    writable: false,
    onread: {
      buffer: Buffer.alloc(4),
      callback(nread: number, buffer: Buffer) {
        received.push(buffer.toString("latin1", 0, nread));
        return false;
      },
    },
  } as any) as any;
  socket.read(0);
  expect(handle.readStartCalls).toBe(1);

  handle.onread!(10, Buffer.from("0123456789"));
  expect({ received, readStopCalls: handle.readStopCalls, reading: handle.reading }).toEqual({
    received: ["0123"],
    readStopCalls: 1,
    reading: false,
  });

  // Each resume() delivers one more buffer: the callback stops the reads again.
  let stopped = handle.next();
  socket.resume();
  await stopped;
  expect({ received, readStopCalls: handle.readStopCalls }).toEqual({ received: ["0123", "4567"], readStopCalls: 2 });

  stopped = handle.next();
  socket.resume();
  await stopped;
  expect({ received, readStopCalls: handle.readStopCalls }).toEqual({
    received: ["0123", "4567", "89"],
    readStopCalls: 3,
  });

  // Nothing is left to deliver: this resume() starts the handle again.
  const started = handle.next();
  socket.resume();
  await started;
  expect({
    received,
    readStartCalls: handle.readStartCalls,
    reading: handle.reading,
    bytesRead: socket.bytesRead,
  }).toEqual({ received: ["0123", "4567", "89"], readStartCalls: 2, reading: true, bytesRead: 10 });
  socket.destroy();
});

test("net.Socket({ handle }) destroys the socket with the errno that onread reports", async () => {
  const handle = createHandle();
  const socket = new Socket({ handle, manualStart: true, writable: false } as any) as any;
  socket.read(0);

  const errored = once(socket, "error");
  // Not events.once(): it rejects when 'error' comes first.
  const closed = new Promise<unknown[]>(resolve => socket.on("close", (...args: unknown[]) => resolve(args)));
  handle.onread!(-104); // ECONNRESET on Linux. The name of the code depends on the platform.
  const [err] = await errored;
  expect({ errno: err.errno, syscall: err.syscall }).toEqual({ errno: -104, syscall: "read" });
  expect(await closed).toEqual([true]);
  expect(socket._handle).toBe(null);
});

// The native handle: process.binding("pipe_wrap").Pipe, which `new net.Socket({ fd })`
// makes for a pipe fd as node's createHandle() does. It has the read side only.
describe.skipIf(isWindows)("Pipe handle", () => {
  // FIFOs with both ends open in this process. The non-blocking read end is
  // opened first so that opening the write end does not block.
  function openFifos(dir: string, count: number) {
    const paths = Array.from({ length: count }, (_, i) => join(dir, `fifo-${i}`));
    execFileSync("mkfifo", paths);
    return paths.map(path => ({
      rfd: fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK),
      wfd: fs.openSync(path, "w"),
    }));
  }
  function isOpen(fd: number) {
    try {
      fs.fstatSync(fd);
      return true;
    } catch {
      return false;
    }
  }

  test("net.Socket({ fd }) reads a pipe fd through it", async () => {
    using dir = tempDir("pipe-handle-read", {});
    const [{ rfd, wfd }] = openFifos(String(dir), 1);
    let wfdOpen = true;
    try {
      const socket = new Socket({ fd: rfd, writable: false }) as any;
      const handle = socket._handle;
      const chunks: Buffer[] = [];
      socket.on("data", (chunk: Buffer) => chunks.push(chunk));
      const ended = once(socket, "end");
      const closed = once(socket, "close");
      fs.writeSync(wfd, "hello ");
      fs.writeSync(wfd, "pipe");
      fs.closeSync(wfd);
      wfdOpen = false;
      await ended;
      expect(await closed).toEqual([false]);
      expect({
        handle: handle?.constructor?.name,
        data: Buffer.concat(chunks).toString(),
        bytesRead: socket.bytesRead,
        detached: socket._handle,
      }).toEqual({ handle: "Pipe", data: "hello pipe", bytesRead: 10, detached: null });
    } finally {
      if (wfdOpen) fs.closeSync(wfd);
      // The handle leaves the caller's fd open.
      if (isOpen(rfd)) fs.closeSync(rfd);
    }
  });

  // The handle makes its fd non-blocking, and a synchronous write(2) to a full
  // non-blocking pipe fails with EAGAIN.
  test("a socket that writes synchronously to its fd gets no handle", () => {
    using dir = tempDir("pipe-handle-write-only", {});
    const [{ rfd, wfd }] = openFifos(String(dir), 1);
    try {
      const writeOnly = new Socket({ fd: wfd, readable: false, writable: true }) as any;
      expect(writeOnly._handle).toBe(null);
      // Closes wfd: the socket adopted it.
      writeOnly.destroy();
    } finally {
      fs.closeSync(rfd);
    }
  });

  // The lifetime cases of the handle itself. In a subprocess: a sanitizer
  // abort is then an exit code, not the end of this runner.
  test("survives close() inside onread, collection, and readStart() after EOF", async () => {
    using dir = tempDir("pipe-handle-lifecycle", {});
    execFileSync(
      "mkfifo",
      [0, 1, 2, 3, 4, 5].map(i => join(String(dir), `fifo-${i}`)),
    );
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "pipe-handle-lifecycle-fixture.js"), String(dir)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      // One read, then the close callback. Nothing after close().
      closeInsideOnread: [5, "closed"],
      // No callback on a handle that was collected while stopped.
      collectedWhileStopped: 0,
      // Data, then UV_EOF, on a handle that only its own read keeps alive.
      aliveWhileReading: [4, -4095],
      // readStart() after EOF and after close() returns 0 and reads nothing.
      readStartAfterEof: [1, -4095, "inside=0", "after=0", "closed=0"],
      // "three" arrives only after the handle starts again.
      stopAndStart: ["one", "two", "stopped", "three"],
    });
    // The fixture leaves an unref()ed handle reading on an open FIFO.
    expect(exitCode).toBe(0);
  });
});
