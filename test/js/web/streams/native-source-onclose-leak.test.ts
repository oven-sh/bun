import { S3Client } from "bun";
import { byteStreamInternals } from "bun:internal-for-testing";
import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { once } from "node:events";
import { closeSync, constants, openSync, writeSync } from "node:fs";
import { connect, createServer, type AddressInfo, type Socket } from "node:net";
import { join } from "node:path";
import { Readable } from "node:stream";

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

// A read that waits on a native stream (a parked pull, or a whole-body read) is no GC root: a slot
// of the stream's source wrapper holds its promise, so the read lives for as long as the wrapper.
// The root, a protected promise for each read, kept a read that nothing could settle for the life
// of the process (test/js/workerd/html-rewriter-leak.test.ts). What keeps a read that will be
// settled is its producer, for as long as it can deliver: a fetch() or an S3 download roots the
// wrapper, a server roots the stream of the request, and the reader of a pipe roots the wrapper
// while it reads. A reader that nothing else holds still gets its bytes.
describe("a read that waits on a native stream", () => {
  const decoder = new TextDecoder();
  const turn = () => new Promise<void>(resolve => setImmediate(resolve));
  const collections = async () => {
    for (let i = 0; i < 3; i++) {
      await turn();
      Bun.gc(true);
    }
  };
  // A waiting read's own promise, which must not be a root, and what a producer roots for it.
  const rootTypes = [
    "Promise",
    "BytesInternalReadableStreamSource",
    "FileInternalReadableStreamSource",
    "ReadableStream",
  ] as const;
  type Roots = Partial<Record<(typeof rootTypes)[number], number>>;
  const roots = () => {
    const counts = heapStats().protectedObjectTypeCounts;
    return rootTypes.map(type => counts[type] ?? 0);
  };
  const addedSince = (before: number[]): Roots =>
    Object.fromEntries(roots().flatMap((count, i) => (count > before[i] ? [[rootTypes[i], count - before[i]]] : [])));

  // An HTTP origin that answers each request with "first,", and with "rest" once finish() is called.
  const origin = async () => {
    const sockets: Socket[] = [];
    const server = createServer(socket => {
      sockets.push(socket);
      socket.on("error", () => {});
      socket.once("data", () => socket.write("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n6\r\nfirst,\r\n"));
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    return {
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      send: (chunk: string) => sockets.forEach(socket => socket.write(`${chunk.length.toString(16)}\r\n${chunk}\r\n`)),
      finish: () => sockets.forEach(socket => socket.end("4\r\nrest\r\n0\r\n\r\n")),
      [Symbol.dispose]() {
        sockets.forEach(socket => socket.destroy());
        server.close();
      },
    };
  };
  const child = () =>
    Bun.spawn({
      cmd: [bunExe(), "-e", "process.stdin.pipe(process.stdout)"],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });

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

  describe.each(Object.keys(readers))("through %s", way => {
    // `start(i, read)` gives the i-th stream to `read`, and `finish()` lets the rest of every body go.
    // `kept` is what the producers root while the reads wait.
    const waits = async (
      count: number,
      kept: Roots,
      start: (i: number, read: Read) => Promise<string>,
      finish: () => unknown,
    ) => {
      // Also for bun:test, which roots the promise of this test at its first await.
      await collections();
      const before = roots();
      const waiting: Promise<void>[] = [];
      const results: Promise<string>[] = [];
      // Its own frame: once it returns, the promise of each consumer is all that script holds.
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
        whileWaiting: kept,
        received: results.map(() => "first,rest"),
        afterwards: {},
      });
    };

    test("on a fetch() body, which the fetch keeps", async () => {
      using from = await origin();
      await waits(
        4,
        { BytesInternalReadableStreamSource: 4 },
        async (_, read) => read((await fetch(from.url)).body!),
        from.finish,
      );
    });

    test("on an S3 download, which the download keeps", async () => {
      using from = await origin();
      const s3 = new S3Client({ accessKeyId: "id", secretAccessKey: "secret", endpoint: from.url, bucket: "bucket" });
      await waits(
        4,
        { BytesInternalReadableStreamSource: 4 },
        (i, read) => read(s3.file("key" + i).stream()),
        from.finish,
      );
    });

    test("on a Bun.serve() request body, which the server keeps", async () => {
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
          { ReadableStream: 4 },
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

    test("on the stdout of a child process, which the reader of the pipe keeps", async () => {
      const children: ReturnType<typeof child>[] = [];
      try {
        await waits(
          1,
          { FileInternalReadableStreamSource: 1 },
          async (_, read) => {
            const spawned = child();
            children.push(spawned);
            spawned.stdin.write("first,");
            spawned.stdin.flush();
            return read(spawned.stdout);
          },
          () => Promise.all(children.map(spawned => (spawned.stdin.write("rest"), spawned.stdin.end()))),
        );
      } finally {
        children.forEach(spawned => spawned.kill());
      }
    });

    test.skipIf(isWindows)("on a file that is a named pipe, which its reader keeps", async () => {
      using dir = tempDir("native-stream-waiting-read", {});
      const writers: number[] = [];
      try {
        await waits(
          4,
          { FileInternalReadableStreamSource: 4 },
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

  // No read waits here: the server's native sink waits for the fetch, which keeps the source for it.
  test("a fetch() body that a server pipes into its response arrives, with nothing else holding it", async () => {
    using from = await origin();
    using proxy = Bun.serve({ port: 0, fetch: async () => new Response((await fetch(from.url)).body) });
    await collections();
    const before = roots();
    const clients: Socket[] = [];
    const bodies: Promise<string>[] = [];
    const started: Promise<void>[] = [];
    try {
      for (let i = 0; i < 4; i++) {
        const client = connect(proxy.port, "127.0.0.1");
        client.on("error", () => {});
        clients.push(client);
        const body = Promise.withResolvers<string>();
        const first = Promise.withResolvers<void>();
        let response = "";
        client.on("data", data => {
          response += data;
          if (response.includes("first,")) first.resolve();
          if (response.endsWith("0\r\n\r\n")) body.resolve(response.slice(response.indexOf("\r\n\r\n") + 4));
        });
        bodies.push(body.promise);
        started.push(first.promise);
        await once(client, "connect");
        client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
      }
      await Promise.all(started);
      await turn();
      const whileWaiting = addedSince(before);
      await collections();
      from.finish();
      const received = await Promise.all(bodies);
      await collections();

      expect({ whileWaiting, received, afterwards: addedSince(before) }).toEqual({
        whileWaiting: { BytesInternalReadableStreamSource: 4, ReadableStream: 4 },
        received: bodies.map(() => "6\r\nfirst,\r\n4\r\nrest\r\n0\r\n\r\n"),
        afterwards: {},
      });
    } finally {
      clients.forEach(client => client.destroy());
    }
  });

  // The stream pulls ahead of its reader, and Readable.fromWeb() pulls the source itself. The
  // promise of the pull that it replaced had a root that nothing released.
  describe("a pull that another pull replaces leaves no root", () => {
    const replaced = async (streams: ReadableStream<Uint8Array>[], finish: () => unknown) => {
      await collections();
      const before = roots();
      const ended = await (async () => {
        const ends: Promise<unknown>[] = [];
        for (const stream of streams) {
          const reader = stream.getReader();
          await reader.read();
          reader.releaseLock();
          const readable = Readable.fromWeb(stream as any).resume();
          ends.push(once(readable, "end"));
        }
        await turn();
        await finish();
        return (await Promise.all(ends)).length;
      })();
      await collections();
      expect({ ended, afterwards: addedSince(before) }).toEqual({ ended: streams.length, afterwards: {} });
    };

    test("on a fetch() body", async () => {
      using from = await origin();
      const streams = await Promise.all(Array.from({ length: 4 }, async () => (await fetch(from.url)).body!));
      await replaced(streams, from.finish);
    });

    test("on the stdout of a child process", async () => {
      await using spawned = child();
      spawned.stdin.write("first,");
      spawned.stdin.flush();
      await replaced([spawned.stdout], () => (spawned.stdin.write("rest"), spawned.stdin.end()));
    });
  });

  // The producer that this test installs cancels the stream from inside its drain signal, which
  // ByteStream gives while it settles a parked pull. That pull already has its chunk.
  test("a chunk that settles a parked pull is delivered when the drain signal cancels the stream", async () => {
    using from = await origin();
    const body = (await fetch(from.url)).body!;
    const reader = body.getReader();
    expect(decoder.decode((await reader.read()).value)).toBe("first,");
    const read = reader.read();
    byteStreamInternals.cancelOnDrain(body);
    from.send("hello");
    const { done, value } = await read;
    expect(done ? "done" : "chunk:" + decoder.decode(value)).toBe("chunk:hello");
  });

  // The roots of a waiting read are in the heap of the worker that reads. Its teardown settles none of them.
  test("a worker that is terminated while its reads wait goes away", async () => {
    using from = await origin();
    const worker = `
      const body = (await fetch(${JSON.stringify(from.url)})).body;
      const reader = body.getReader();
      await reader.read();
      reader.read();
      new Response((await fetch(${JSON.stringify(from.url)})).body).text();
      // A rewrite whose handler never resumes roots the read of its output too.
      new HTMLRewriter().on("b", { element: () => new Promise(() => {}) }).transform(new Response("<b>x</b>")).body.getReader().read();
      postMessage("waiting");
    `;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          for (let round = 0; round < 2; round++) {
            const worker = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(worker)}])));
            await new Promise(resolve => worker.addEventListener("message", resolve, { once: true }));
            await worker.terminate();
            Bun.gc(true);
          }
          console.log("terminated");
          process.exit(0);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("terminated\n");
    expect(exitCode).toBe(0);
  }, 30_000);
});
