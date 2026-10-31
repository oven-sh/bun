import { expect, test } from "bun:test";
import { once } from "node:events";
import { createServer, Socket, type AddressInfo } from "node:net";
import { getSystemErrorMap } from "node:util";

// net.Socket over a handle with Node's LibuvStreamWrap surface: readStart() and
// readStop() answer a libuv errno, reads arrive through onread(nread, buffer),
// and writeBuffer(null, data) answers a number for a write that is complete.
// The native handle with this surface is tty_wrap.TTY. This handle is a mock,
// so these run on every platform.
const UV_EOF = -4095;
const uvErrno = (code: string) => [...getSystemErrorMap()].find(([, [name]]) => name === code)![0];

function mockHandle(overrides: Record<string, unknown> = {}) {
  const calls = { readStart: 0, readStop: 0, ref: 0, unref: 0, close: 0 };
  const written: [req: unknown, data: string][] = [];
  const handle = {
    calls,
    written,
    bytesRead: 0,
    bytesWritten: 0,
    onread: undefined as undefined | ((nread: number, buffer?: Buffer) => void),
    readStart() {
      calls.readStart++;
      return 0;
    },
    readStop() {
      calls.readStop++;
      return 0;
    },
    writeBuffer(req: unknown, data: Uint8Array) {
      written.push([req, Buffer.from(data).toString()]);
      handle.bytesWritten += data.length;
      return 0;
    },
    ref() {
      calls.ref++;
    },
    unref() {
      calls.unref++;
    },
    close() {
      calls.close++;
    },
    /** What the native handle does for a read of `text`. */
    deliver(text: string) {
      handle.bytesRead += text.length;
      handle.onread!(text.length, Buffer.from(text));
    },
    ...overrides,
  };
  return handle;
}

test("reads start with the first consumer and arrive through onread", async () => {
  const handle = mockHandle();
  const socket = new Socket({ handle, manualStart: true } as never);
  expect({ handle: socket._handle === (handle as never), onread: typeof handle.onread, ...handle.calls }).toEqual({
    handle: true,
    onread: "function",
    readStart: 0,
    readStop: 0,
    ref: 0,
    unref: 0,
    close: 0,
  });

  const chunks: string[] = [];
  socket.on("data", chunk => chunks.push(String(chunk)));
  const ended = once(socket, "end");
  await new Promise(resolve => process.nextTick(resolve));
  expect(handle.calls.readStart).toBe(1);

  handle.deliver("hello");
  handle.deliver(" world");
  handle.onread!(UV_EOF);
  await ended;
  expect({ chunks, bytesRead: socket.bytesRead, readStart: handle.calls.readStart }).toEqual({
    chunks: ["hello", " world"],
    bytesRead: 11,
    readStart: 1,
  });
  socket.destroy();
});

// https://github.com/nodejs/node/blob/v26.12.1/lib/net.js#L768-L772
test("pauseOnCreate stops the handle and starts the stream paused", async () => {
  const handle = mockHandle();
  const socket = new Socket({ handle, pauseOnCreate: true } as never);
  expect({
    flowing: socket.readableFlowing,
    reading: (handle as { reading?: boolean }).reading,
    ...handle.calls,
  }).toEqual({
    flowing: false,
    reading: false,
    readStart: 0,
    readStop: 1,
    ref: 0,
    unref: 0,
    close: 0,
  });
  // A consumer starts it, as after any pause().
  const started = Promise.withResolvers<void>();
  const readStart = handle.readStart;
  handle.readStart = () => {
    started.resolve();
    return readStart();
  };
  const data = once(socket, "data");
  socket.resume();
  await started.promise;
  handle.deliver("late");
  expect(String((await data)[0])).toBe("late");
  expect(handle.calls.readStart).toBe(1);
  socket.destroy();
});

// https://github.com/nodejs/node/blob/v26.12.1/lib/net.js#L773-L775
test("without manualStart the constructor starts the handle", () => {
  const handle = mockHandle();
  const socket = new Socket({ handle } as never);
  expect(handle.calls.readStart).toBe(1);
  socket.destroy();
});

test("a chunk that no consumer takes stops the handle, and the next read starts it again", async () => {
  const handle = mockHandle();
  const socket = new Socket({ handle, manualStart: true, readableHighWaterMark: 0 } as never);
  const readable = once(socket, "readable");
  // A 'readable' listener reads ahead of any read() call.
  await new Promise(resolve => process.nextTick(resolve));
  expect(handle.calls).toMatchObject({ readStart: 1, readStop: 0 });

  handle.deliver("one");
  // push() reported backpressure: the handle is stopped and no longer holds the loop.
  expect(handle.calls).toMatchObject({ readStart: 1, readStop: 1, unref: 1, ref: 0 });
  await readable;
  expect(String(socket.read())).toBe("one");
  expect(handle.calls).toMatchObject({ readStart: 1, readStop: 1 });
  // The read() that finds the buffer empty asks for more.
  expect(socket.read()).toBeNull();
  expect(handle.calls).toMatchObject({ readStart: 2, readStop: 1, unref: 1, ref: 1 });
  socket.destroy();
});

test("a stream that the program unref'd does not take the loop back when a read restarts its handle", async () => {
  const handle = mockHandle();
  const socket = new Socket({ handle, manualStart: true, readableHighWaterMark: 0 } as never);
  socket.unref();
  const unrefsByTheProgram = handle.calls.unref;
  const readable = once(socket, "readable");
  await new Promise(resolve => process.nextTick(resolve));
  handle.deliver("one");
  await readable;
  expect(String(socket.read())).toBe("one");
  expect(socket.read()).toBeNull();
  expect({ ...handle.calls, unref: handle.calls.unref - unrefsByTheProgram }).toMatchObject({
    readStart: 2,
    readStop: 1,
    ref: 0,
  });
  socket.destroy();
});

test("pause() does not stop a handle that never started", () => {
  const handle = mockHandle();
  const socket = new Socket({ handle, manualStart: true } as never);
  socket.pause();
  expect(handle.calls).toMatchObject({ readStart: 0, readStop: 0 });
  socket.destroy();
});

test("a negative nread destroys the socket with the libuv error", async () => {
  const handle = mockHandle();
  const socket = new Socket({ handle, manualStart: true } as never);
  socket.on("data", () => {});
  const failed = once(socket, "error");
  await new Promise(resolve => process.nextTick(resolve));
  handle.onread!(uvErrno("ECONNRESET"));
  const [err] = await failed;
  expect({ code: err.code, errno: err.errno, syscall: err.syscall, destroyed: socket.destroyed }).toEqual({
    code: "ECONNRESET",
    errno: uvErrno("ECONNRESET"),
    syscall: "read",
    destroyed: true,
  });
  await once(socket, "close");
  expect(handle.calls.close).toBe(1);
});

test("readStart() that fails destroys the socket", async () => {
  const handle = mockHandle({ readStart: () => uvErrno("ENOTSUP") });
  const socket = new Socket({ handle, manualStart: true } as never);
  const failed = once(socket, "error");
  socket.resume();
  const [err] = await failed;
  expect({ code: err.code, syscall: err.syscall }).toEqual({ code: "ENOTSUP", syscall: "read" });
});

// The chunk is the handle's own buffer. The callback gets the caller's.
test("the onread option gets every chunk in the caller's buffer", async () => {
  const handle = mockHandle();
  const buffer = Buffer.alloc(16);
  const calls: [nread: number, isCallersBuffer: boolean, text: string][] = [];
  const socket = new Socket({
    handle,
    manualStart: true,
    onread: {
      buffer,
      callback(nread: number, buf: Buffer) {
        calls.push([nread, buf === buffer, buf.toString("utf8", 0, nread)]);
      },
    },
  } as never);
  const ended = once(socket, "end");
  socket.read(0);
  handle.deliver("hello");
  handle.onread!(UV_EOF);
  await ended;
  expect(calls).toEqual([[5, true, "hello"]]);
  socket.destroy();
});

// Node's onStreamRead() restarts the idle timer for every chunk.
test("a chunk restarts the idle timer", async () => {
  const handle = mockHandle();
  const socket = new Socket({ handle, manualStart: true } as never) as Socket & { _unrefTimer(): void };
  let restarts = 0;
  const unrefTimer = socket._unrefTimer;
  socket._unrefTimer = function () {
    restarts++;
    return unrefTimer.call(this);
  };
  socket.on("data", () => {});
  await new Promise(resolve => process.nextTick(resolve));
  const before = restarts;
  handle.deliver("hello");
  expect(restarts - before).toBe(1);
  socket.destroy();
});

// https://github.com/nodejs/node/blob/v26.12.1/lib/internal/stream_base_commons.js#L93-L143
test("a write goes to writeBuffer(null, data), and the number that it answers completes it", async () => {
  const handle = mockHandle();
  const socket = new Socket({ handle, manualStart: true } as never);
  const results: (Error | null | undefined)[] = [];
  socket.write("one", err => results.push(err));
  socket.write(Buffer.from("two"), err => results.push(err));
  socket.write("dHJl", "base64", err => results.push(err));
  await new Promise<void>(resolve => socket.write("", () => resolve()));
  expect({ written: handle.written, results, bytesWritten: socket.bytesWritten }).toEqual({
    written: [
      [null, "one"],
      [null, "two"],
      [null, "tre"],
      [null, ""],
    ],
    results: [null, null, null],
    bytesWritten: 9,
  });

  handle.writeBuffer = () => uvErrno("EPIPE");
  const failed = once(socket, "error");
  socket.write("lost");
  const [err] = await failed;
  expect({ code: err.code, errno: err.errno, syscall: err.syscall }).toEqual({
    code: "EPIPE",
    errno: uvErrno("EPIPE"),
    syscall: "write",
  });
});

// Node hands a corked batch to the handle in one writev() call. Here it is one writeBuffer() call.
test("a corked batch is one write, and every callback of it runs", async () => {
  const handle = mockHandle();
  const socket = new Socket({ handle, manualStart: true } as never);
  const results: (Error | null | undefined)[] = [];
  socket.cork();
  socket.write("one", err => results.push(err));
  socket.write(Buffer.from("two"), err => results.push(err));
  socket.write("dHJl", "base64", err => results.push(err));
  expect(handle.written).toEqual([]);
  socket.uncork();
  await new Promise<void>(resolve => socket.write("", () => resolve()));
  expect({ written: handle.written, results, bytesWritten: socket.bytesWritten }).toEqual({
    written: [
      [null, "onetwotre"],
      [null, ""],
    ],
    results: [null, null, null],
    bytesWritten: 9,
  });
  socket.destroy();
});

test("readStop() that fails destroys the socket", async () => {
  const handle = mockHandle({ readStop: () => uvErrno("EBADF") });
  const socket = new Socket({ handle, manualStart: true, readableHighWaterMark: 0 } as never);
  socket.on("readable", () => {});
  const failed = once(socket, "error");
  await new Promise(resolve => process.nextTick(resolve));
  // No read() takes the chunk: push() reports backpressure, and that stops the handle.
  handle.deliver("one");
  const [err] = await failed;
  expect({ code: err.code, syscall: err.syscall, destroyed: socket.destroyed }).toEqual({
    code: "EBADF",
    syscall: "read",
    destroyed: true,
  });
});

test.each([
  [false, ["end", "finish", "close"]],
  [true, ["end", "late write", "finish", "close"]],
])("the end of input with allowHalfOpen %p", async (allowHalfOpen, expected) => {
  const handle = mockHandle();
  const socket = new Socket({ handle, manualStart: true, allowHalfOpen } as never);
  const events: string[] = [];
  for (const name of ["end", "finish", "close"]) socket.on(name, () => events.push(name));
  socket.on("data", () => {});
  const closed = once(socket, "close");
  await new Promise(resolve => process.nextTick(resolve));
  handle.onread!(UV_EOF);
  if (allowHalfOpen) {
    await once(socket, "end");
    // The other half is still open: a write reaches the handle.
    await new Promise<void>(resolve => socket.write("late", () => resolve()));
    events.push("late write");
    socket.end();
  }
  await closed;
  expect({ events, written: handle.written, close: handle.calls.close, handle: socket._handle }).toEqual({
    events: expected,
    written: allowHalfOpen ? [[null, "late"]] : [],
    close: 1,
    handle: null,
  });
});

// The callback's buffer is smaller than a native read, so what is left of a chunk waits for resume().
// A handle can complete a read after readStop(): that chunk and the end of input wait behind it.
test("the end of input waits for what a paused onread callback has not taken", async () => {
  const handle = mockHandle();
  const events: string[] = [];
  const socket = new Socket({
    handle,
    manualStart: true,
    onread: {
      buffer: Buffer.alloc(2),
      callback(nread: number, buf: Buffer) {
        events.push("data:" + buf.toString("utf8", 0, nread));
        return events.length !== 1;
      },
    },
  } as never);
  // A listener, not a promise: it records 'end' where the event is emitted.
  socket.on("end", () => events.push("end"));
  const ended = once(socket, "end");
  socket.read(0);
  handle.deliver("abcd");
  expect({ events: [...events], readStop: handle.calls.readStop }).toEqual({ events: ["data:ab"], readStop: 1 });
  handle.deliver("ef");
  handle.onread!(UV_EOF);
  expect(events).toEqual(["data:ab"]);
  events.push("resume");
  socket.resume();
  await ended;
  expect(events).toEqual(["data:ab", "resume", "data:cd", "data:ef", "end"]);
  socket.destroy();
});

// The socket has no write path of its own for the handle, so after connect() it writes to its peer.
test("after destroy(), connect() on the same socket writes through the handle that it makes", async () => {
  const handle = mockHandle();
  const socket = new Socket({ handle, manualStart: true } as never);
  await new Promise<void>(resolve => socket.write("to the handle", () => resolve()));
  socket.destroy();
  await once(socket, "close");

  const server = createServer(peer => void peer.pipe(peer)).listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    socket.connect((server.address() as AddressInfo).port, "127.0.0.1");
    await once(socket, "connect");
    socket.write("to the peer");
    const [echo] = await once(socket, "data");
    expect({ echo: String(echo), written: handle.written, close: handle.calls.close }).toEqual({
      echo: "to the peer",
      written: [[null, "to the handle"]],
      close: 1,
    });
  } finally {
    socket.destroy();
    server.close();
  }
});

// Node's Socket has one _write() for every handle, on the prototype. A subclass can put its own in front.
test("a write reaches the handle through Socket.prototype._write", async () => {
  const handle = mockHandle();
  const socket = new Socket({ handle, manualStart: true } as never);
  expect([Object.hasOwn(socket, "_write"), Object.hasOwn(socket, "_writev")]).toEqual([false, false]);
  socket.destroy();

  const seen: string[] = [];
  class Tap extends Socket {
    _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (err?: Error | null) => void) {
      seen.push(String(chunk));
      return Socket.prototype._write.call(this, chunk, encoding, callback);
    }
  }
  const other = mockHandle();
  const tap = new Tap({ handle: other, manualStart: true } as never);
  await new Promise<void>(resolve => tap.write("through the subclass", () => resolve()));
  expect({ seen, written: other.written }).toEqual({
    seen: ["through the subclass"],
    written: [[null, "through the subclass"]],
  });
  tap.destroy();
});

test("destroy() closes the handle once and lets go of it", async () => {
  const handle = mockHandle();
  const socket = new Socket({ handle, manualStart: true } as never);
  socket.on("data", () => {});
  await new Promise(resolve => process.nextTick(resolve));
  socket.destroy();
  // Inside destroy(), as uv_close() in Node: a terminal is put back by the time it returns.
  expect(handle.calls.close).toBe(1);
  socket.destroy();
  await once(socket, "close");
  expect({ close: handle.calls.close, handle: socket._handle }).toEqual({ close: 1, handle: null });
  // A read that the handle completes late finds no socket.
  expect(() => handle.deliver("late")).not.toThrow();
});
