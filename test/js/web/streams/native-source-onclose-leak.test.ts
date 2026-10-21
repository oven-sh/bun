import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { once } from "node:events";
import { closeSync, constants, openSync, writeSync } from "node:fs";
import { connect, createServer, type AddressInfo, type Socket } from "node:net";
import { join } from "node:path";

// The JS onClose callback is installed on the native source wrapper when the
// lazy stream is first pulled. Storing it in a JSC::Strong rooted a cycle
// (source wrapper -> m_ctx NewSource -> Strong(onClose) -> bound fn ->
// NativeReadableStreamSource -> $stream -> source wrapper) that only broke
// when EOF ran the JS-side callClose or the cancel algorithm ran #cancel. A
// stream that is read partially and then dropped (releaseLock without cancel)
// never hits either path, so the source wrapper leaked forever. Storing
// onClose in the GC-traced onCloseCallback WriteBarrier slot (as onDrain
// already did) turns the cycle into an ordinary intra-heap cycle that
// mark-sweep collects.

test("native ReadableStream source is collectable after partial read + releaseLock", async () => {
  // Payload must exceed the native pull buffer (ByteBlobLoader caps
  // chunk_size at 2MB) so the first pull does not return *AndDone and
  // callClose is never queued.
  const payload = Buffer.alloc(8 * 1024 * 1024, "x");
  async function once() {
    const stream = new Blob([payload]).stream();
    const reader = stream.getReader();
    await reader.read();
    reader.releaseLock();
  }

  for (let i = 0; i < 5; i++) await once();
  Bun.gc(true);
  const before = heapStats().objectTypeCounts.BlobInternalReadableStreamSource ?? 0;

  for (let i = 0; i < 30; i++) await once();
  Bun.gc(true);
  await 1;
  Bun.gc(true);
  const after = heapStats().objectTypeCounts.BlobInternalReadableStreamSource ?? 0;

  // Pre-fix this grew by exactly 30 (one pinned wrapper per iteration).
  expect(after - before).toBeLessThan(8);
});

test("fetch body native source is collectable after partial read + releaseLock", async () => {
  const payload = Buffer.alloc(4 * 1024 * 1024, "x");
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(payload);
    },
  });
  const url = `http://127.0.0.1:${server.port}/`;

  async function once() {
    const res = await fetch(url);
    const reader = res.body!.getReader();
    await reader.read();
    reader.releaseLock();
  }

  for (let i = 0; i < 5; i++) await once();
  Bun.gc(true);
  const countSources = () => {
    const c = heapStats().objectTypeCounts;
    return (c.BlobInternalReadableStreamSource ?? 0) + (c.BytesInternalReadableStreamSource ?? 0);
  };
  const before = countSources();

  for (let i = 0; i < 30; i++) await once();
  Bun.gc(true);
  await 1;
  Bun.gc(true);
  const after = countSources();

  // Pre-fix this grew by ~30.
  expect(after - before).toBeLessThan(8);
});

// Regression guard: the cycle-breaking paths that already worked must keep
// working after switching storage.
test("native ReadableStream source is collectable after full consumption", async () => {
  const payload = Buffer.alloc(8 * 1024 * 1024, "x");
  async function once() {
    const stream = new Blob([payload]).stream();
    for await (const _ of stream) {
    }
  }

  for (let i = 0; i < 5; i++) await once();
  Bun.gc(true);
  const before = heapStats().objectTypeCounts.BlobInternalReadableStreamSource ?? 0;

  for (let i = 0; i < 30; i++) await once();
  Bun.gc(true);
  await 1;
  Bun.gc(true);
  const after = heapStats().objectTypeCounts.BlobInternalReadableStreamSource ?? 0;

  expect(after - before).toBeLessThan(8);
});

test("native source onClose callback still fires after switching to cached slot", async () => {
  // proc.stdout is a FileInternalReadableStreamSource; closing stdin makes
  // cat exit, which EOFs stdout. FileReader.on_reader_done -> parent.on_close
  // -> on_js_close must still find and invoke the JS onClose callback now
  // that it lives in a WriteBarrier slot rather than a Strong.
  await using proc = Bun.spawn({
    cmd: ["cat"],
    stdin: "pipe",
    stdout: "pipe",
    env: { PATH: process.env.PATH },
  });
  const reader = proc.stdout.getReader();
  const pending = reader.read();
  proc.stdin.end();
  const { done } = await pending;
  // If on_js_close did not fire, the pending pull promise would never resolve
  // with done:true and this test would hang.
  expect(done).toBe(true);
  reader.releaseLock();
  await proc.exited;
});

// A read that waits on a native stream (a parked pull, or a whole-body read) is held by the slots
// of the stream's source wrapper: neither its promise nor the buffer of the pull is a GC root,
// which is what kept a read that nothing could settle for the life of the process. While work that
// the collector does not own (a socket, a pipe) settles the read, the wrapper is the root, so a
// reader that nothing else holds still gets its bytes.
describe("a read that waits on a native stream is held by the stream's source", () => {
  const decoder = new TextDecoder();
  const turn = () => new Promise<void>(resolve => setImmediate(resolve));
  // What a waiting read must not be: a root on its own promise, or on the buffer of its pull.
  const readRoots = () => {
    const counts = heapStats().protectedObjectTypeCounts;
    return { Promise: counts.Promise ?? 0, Uint8Array: counts.Uint8Array ?? 0 };
  };
  // Only what was added: a collection in between can take the roots of an earlier test away.
  const addedSince = (before: ReturnType<typeof readRoots>) => {
    const now = readRoots();
    return {
      Promise: Math.max(0, now.Promise - before.Promise),
      Uint8Array: Math.max(0, now.Uint8Array - before.Uint8Array),
    };
  };
  const collections = async () => {
    for (let i = 0; i < 5; i++) {
      await turn();
      Bun.gc(true);
    }
  };
  type Read = (stream: ReadableStream<Uint8Array>) => Promise<string>;
  // Each takes "first," and then waits for "rest". `waiting()` says that it does.
  const readers: Record<string, (waiting: () => void) => Read> = {
    "a reader": waiting => async stream => {
      let text = "";
      const reader = stream.getReader();
      for (;;) {
        const read = reader.read();
        if (text) waiting();
        const { done, value } = await read;
        if (done) return text;
        text += decoder.decode(value, { stream: true });
      }
    },
    "text()": waiting => stream => (waiting(), stream.text()),
  };

  describe.each(Object.keys(readers))("%s", way => {
    // `start(i, read)` gives the i-th stream to `read`, and `finish()` lets the rest of every body go.
    const waits = async (
      count: number,
      start: (i: number, read: Read) => Promise<string>,
      finish: () => unknown,
    ) => {
      // bun:test roots the promise of this test at its first await.
      await turn();
      const before = readRoots();
      const waiting: Promise<void>[] = [];
      const results: Promise<string>[] = [];
      // Its own frame: once it returns, the promise of each consumer is all that is held.
      (() => {
        for (let i = 0; i < count; i++) {
          const { promise, resolve } = Promise.withResolvers<void>();
          waiting.push(promise);
          results.push(start(i, readers[way](resolve)));
        }
      })();
      await Promise.all(waiting);
      await turn();
      const whileWaiting = addedSince(before);
      await collections();
      await finish();
      const received = await Promise.all(results);
      await collections();

      expect({ whileWaiting, received, afterwards: addedSince(before) }).toEqual({
        whileWaiting: { Promise: 0, Uint8Array: 0 },
        received: results.map(() => "first,rest"),
        afterwards: { Promise: 0, Uint8Array: 0 },
      });
    };

    test("on a fetch() body", async () => {
      const sockets: Socket[] = [];
      const origin = createServer(socket => {
        sockets.push(socket);
        socket.on("error", () => {});
        socket.once("data", () =>
          socket.write("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n6\r\nfirst,\r\n"),
        );
      }).listen(0, "127.0.0.1");
      await once(origin, "listening");
      try {
        const url = `http://127.0.0.1:${(origin.address() as AddressInfo).port}/`;
        await waits(
          4,
          async (_, read) => read((await fetch(url)).body!),
          () => sockets.forEach(socket => socket.end("4\r\nrest\r\n0\r\n\r\n")),
        );
      } finally {
        sockets.forEach(socket => socket.destroy());
        origin.close();
      }
    });

    test("on a Bun.serve() request body", async () => {
      const handlers: ((request: Request) => Promise<string>)[] = [];
      const received: PromiseWithResolvers<string>[] = [];
      using server = Bun.serve({
        port: 0,
        async fetch(request) {
          const i = Number(new URL(request.url).searchParams.get("i"));
          received[i].resolve(await handlers[i](request));
          return new Response("ok");
        },
      });
      const sockets: Socket[] = [];
      try {
        await waits(
          4,
          async (i, read) => {
            received[i] = Promise.withResolvers<string>();
            handlers[i] = request => read(request.body!);
            const socket = connect(server.port, "127.0.0.1");
            socket.on("error", () => {});
            sockets.push(socket);
            await once(socket, "connect");
            socket.write(`POST /?i=${i} HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n6\r\nfirst,\r\n`);
            return received[i].promise;
          },
          () => sockets.forEach(socket => socket.write("4\r\nrest\r\n0\r\n\r\n")),
        );
      } finally {
        sockets.forEach(socket => socket.destroy());
      }
    });

    test("on the stdout of a child process", async () => {
      const children: Bun.Subprocess<"pipe", "pipe", "inherit">[] = [];
      try {
        await waits(
          1,
          async (_, read) => {
            const child = Bun.spawn({
              cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
              env: bunEnv,
              stdin: "pipe",
              stdout: "pipe",
              stderr: "inherit",
            });
            children.push(child);
            child.stdin.write("first,");
            child.stdin.flush();
            return read(child.stdout);
          },
          () => Promise.all(children.map(child => (child.stdin.write("rest"), child.stdin.end()))),
        );
      } finally {
        children.forEach(child => child.kill());
      }
    });

    test.skipIf(isWindows)("on a file that is a named pipe", async () => {
      using dir = tempDir("native-stream-waiting-read", {});
      const writers: number[] = [];
      try {
        await waits(
          4,
          (i, read) => {
            const fifo = join(String(dir), "fifo" + i);
            expect(Bun.spawnSync({ cmd: ["mkfifo", fifo] }).exitCode).toBe(0);
            // The stream opens the pipe at its first pull, and that lets this end open.
            const received = read(Bun.file(fifo).stream());
            const writer = openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
            writers.push(writer);
            writeSync(writer, "first,");
            return received;
          },
          () => writers.splice(0).forEach(writer => (writeSync(writer, "rest"), closeSync(writer))),
        );
      } finally {
        writers.forEach(writer => closeSync(writer));
      }
    });
  });
});
