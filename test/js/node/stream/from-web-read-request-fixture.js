// The order in which Readable.fromWeb() and Duplex.fromWeb() learn of the end and of an error of their web stream, one
// row per case. `expected` is the log of Node.js v26.12.1, and `node from-web-read-request-fixture.js` prints the rows
// whose log differs from it. A row with `bun` is a known difference: Bun prints that log, for the reason in `why`.
"use strict";
const { Duplex, Readable, Writable, finished, pipeline } = require("node:stream");

const turn = () => new Promise(resolve => setImmediate(resolve));
const chunk = byte => new Uint8Array([byte]);
const codeOf = error => (error ? error.code || error.message : "ok");
const closedStream = () => new ReadableStream({ start: controller => controller.close() });
// The test keeps the controller and closes or errors the stream from outside.
const openStream = x => new ReadableStream({ start: controller => void (x.controller = controller) });
const openByteStream = x =>
  new ReadableStream({ type: "bytes", start: controller => void (x.controller = controller) });
// Two chunks, and a node stream whose buffer holds one: after read(0) no read of the node stream waits in the web stream.
const twoChunks = x =>
  new ReadableStream({
    start(controller) {
      x.controller = controller;
      controller.enqueue(chunk(1));
      controller.enqueue(chunk(2));
    },
  });
const watch = (stream, log) => finished(stream, error => log.push(`finished: ${codeOf(error)}`));
const read = (stream, log, size) => log.push(`read: ${stream.read(size)}`);
const write = (stream, log, text) => stream.write(text, error => log.push(`write(${text}) cb: ${codeOf(error)}`));
const end = (stream, log) => stream.end(() => log.push("end() cb"));
// What comes ahead of a mark happened inside the call before the marks, or in a job of that kind that was queued
// ahead of it. "tick 2" tells a 'close' that waits for a promise job from one that waits for a tick.
const markOrder = log => {
  Promise.resolve().then(() => log.push("promise job"));
  process.nextTick(() => {
    log.push("tick");
    process.nextTick(() => log.push("tick 2"));
  });
};
const awaitLoop = (stream, log) =>
  (async () => {
    for await (const _ of stream);
  })().then(
    () => log.push("loop: resolves"),
    error => log.push(`loop: rejects ${codeOf(error)}`),
  );
const sink = () => new Writable({ write: (chunk, encoding, callback) => callback() });
// A Writable that takes one byte and holds every write until the test calls its callback.
const slowSink = (log, callbacks) =>
  new Writable({
    highWaterMark: 1,
    write(data, encoding, callback) {
      log.push(`write: ${data[0]}`);
      callbacks.push(callback);
    },
  }).on("finish", () => log.push("dest finish"));
const pair = (readable, log, x) => ({
  readable,
  writable: new WritableStream({
    start: controller => void (x.sinkController = controller),
    write: data => void log.push(`sink write: ${Buffer.from(data)}`),
    close: () => void log.push("sink close"),
    abort: () => void log.push("sink abort"),
  }),
});

const fromWeb = (web, options) => (x, log) => Readable.fromWeb(web(x, log), options);
const duplexFromWeb = (web, options) => (x, log) => Duplex.fromWeb(pair(web(x, log), log, x), options);

const writeHalf =
  "write() reaches the sink one promise job later than in Node.js: the write half of nodejs/node#65548 is not ported.";
const errorWaits =
  "The error of the readable side reaches the duplex one promise job later. In place it would abort a write of the same turn, which reaches the sink later than in Node.js (the write half of nodejs/node#65548 is not ported).";
const flowSync =
  "The Readable of Bun is that of Node.js v26.3.0. Since v26.11.0 flow() of Node.js has flowSync(), which does not end the stream in the read that returns the last chunk.";

// `act` runs two turns after fromWeb(), in a callback of the event loop, or in a job that this callback queues:
// `from: "promise job"`, `from: "tick"`. With `sameTurn` it runs in the turn of fromWeb(). With `flowing` the node
// stream flows. With `parked` it called read() one turn before. Either way a read request waits in the web stream.
const rows = [
  // One read() of a node stream over a web stream that is closed already.
  {
    name: "a stream closed in start(): one read() ends it",
    make: fromWeb(closedStream),
    act: (stream, log) => read(stream, log),
    expected: ["read: null", "end", "close"],
  },
  {
    name: "a stream closed in pull(): one read() ends it",
    make: fromWeb(() => new ReadableStream({ pull: controller => controller.close() })),
    act: (stream, log) => read(stream, log),
    expected: ["read: null", "end", "close"],
  },
  {
    name: "a pull() that closes inside the read (highWaterMark 0): one read() ends it",
    make: fromWeb(() => new ReadableStream({ pull: controller => controller.close() }, { highWaterMark: 0 })),
    act: (stream, log) => read(stream, log),
    expected: ["read: null", "end", "close"],
  },
  {
    name: "a byte stream closed in start(): one read() ends it",
    make: fromWeb(() => new ReadableStream({ type: "bytes", start: controller => controller.close() })),
    act: (stream, log) => read(stream, log),
    expected: ["read: null", "end", "close"],
  },
  {
    name: "the closed readable side of a TransformStream: one read() ends it",
    make: fromWeb(() => {
      const transform = new TransformStream();
      transform.writable.getWriter().close();
      return transform.readable;
    }),
    act: (stream, log) => read(stream, log),
    expected: ["read: null", "end", "close"],
  },
  {
    name: "a tee() branch of a closed stream: one read() ends it",
    make: fromWeb(() => closedStream().tee()[0]),
    act: (stream, log) => read(stream, log),
    expected: ["read: null", "end", "close"],
  },
  {
    name: "a closed stream: read(1) ends it",
    make: fromWeb(closedStream),
    act: (stream, log) => read(stream, log, 1),
    expected: ["read: null", "end", "close"],
  },
  {
    name: "a closed stream, objectMode: one read() ends it",
    make: fromWeb(closedStream, { objectMode: true }),
    act: (stream, log) => read(stream, log),
    expected: ["read: null", "end", "close"],
  },
  {
    name: "a closed stream, setEncoding(): one read() ends it",
    make: fromWeb(closedStream),
    act: (stream, log) => {
      stream.setEncoding("utf8");
      read(stream, log);
    },
    expected: ["read: null", "end", "close"],
  },
  {
    name: "a closed stream: a read() in the turn of fromWeb() ends it",
    sameTurn: true,
    make: fromWeb(closedStream),
    act: (stream, log) => read(stream, log),
    expected: ["read: null", "end", "close"],
  },
  {
    name: "a closed stream: two read() calls in one turn end it once",
    make: fromWeb(closedStream),
    act: (stream, log) => {
      read(stream, log);
      read(stream, log);
    },
    expected: ["read: null", "read: null", "end", "close"],
  },
  {
    name: "a closed stream: finished() calls back after one read()",
    make: fromWeb(closedStream),
    act: (stream, log) => {
      watch(stream, log);
      read(stream, log);
    },
    expected: ["read: null", "end", "close", "finished: ok"],
  },
  {
    name: "a closed stream: 'end' is one tick after the read(), 'close' one more",
    make: fromWeb(closedStream),
    act: (stream, log) => {
      stream.read();
      markOrder(log);
    },
    expected: ["end", "tick", "close", "tick 2", "promise job"],
  },
  {
    name: "a closed stream: a read() one turn later finds it ended",
    make: fromWeb(closedStream),
    act: async (stream, log) => {
      read(stream, log);
      await turn();
      read(stream, log);
    },
    expected: ["read: null", "end", "close", "read: null"],
  },
  {
    name: "a closed stream: a 'readable' listener added after the read() is called, then 'end'",
    make: fromWeb(closedStream),
    act: (stream, log) => {
      read(stream, log);
      stream.on("readable", () => log.push("readable"));
    },
    expected: ["read: null", "readable", "end", "close"],
  },

  // The web stream closes while a read of the node stream waits in it.
  {
    name: "a parked read: the node stream has ended when controller.close() returns",
    parked: true,
    make: fromWeb(openStream),
    act: (stream, log, x) => {
      x.controller.close();
      log.push(`ended inside close(): ${stream._readableState.ended}`);
    },
    expected: ["ended inside close(): true"],
  },
  {
    name: "a parked read: a 'readable' listener runs inside controller.close()",
    make: fromWeb(openStream),
    act: async (stream, log, x) => {
      stream.on("readable", () => log.push(`readable, ended: ${stream._readableState.ended}`));
      await turn();
      log.push("before close()");
      x.controller.close();
      log.push("after close()");
    },
    expected: ["before close()", "readable, ended: true", "after close()"],
  },
  {
    name: "a parked read: a 'readable' listener that reads inside controller.close() ends the stream",
    make: fromWeb(openStream),
    act: async (stream, log, x) => {
      stream.on("readable", () => log.push(`readable, read: ${stream.read()}`));
      await turn();
      log.push("before close()");
      x.controller.close();
      log.push("after close()");
    },
    expected: ["before close()", "readable, read: null", "after close()", "end", "close"],
  },
  {
    name: "a parked read, flowing: 'end' is one tick after controller.close()",
    make: fromWeb(openStream),
    act: async (stream, log, x) => {
      stream.resume();
      await turn();
      x.controller.close();
      markOrder(log);
    },
    expected: ["promise job", "end", "tick", "close", "tick 2"],
  },
  {
    name: "a parked read: one read() after controller.close() ends the stream",
    parked: true,
    make: fromWeb(openStream),
    act: async (stream, log, x) => {
      watch(stream, log);
      x.controller.close();
      await turn();
      read(stream, log);
    },
    expected: ["read: null", "end", "close", "finished: ok"],
  },
  {
    name: "no read parked (highWaterMark 0): the close is found by the next read()",
    make: fromWeb(
      x => new ReadableStream({ start: controller => void (x.controller = controller).enqueue(chunk(1)) }),
      {
        highWaterMark: 0,
      },
    ),
    act: async (stream, log, x) => {
      read(stream, log);
      await turn();
      await turn();
      log.push(`read: ${stream.read()?.length}`);
      await turn();
      x.controller.close();
      await turn();
      read(stream, log);
    },
    expected: ["read: null", "read: 1", "read: null", "end", "close"],
  },
  {
    name: "the stream closes while the buffer of the node stream is full: 'end' follows the last chunk",
    make: fromWeb(
      x =>
        new ReadableStream({
          start(controller) {
            x.controller = controller;
            controller.enqueue(chunk(1));
            controller.enqueue(chunk(2));
          },
        }),
      { highWaterMark: 1 },
    ),
    act: async (stream, log, x) => {
      stream.read(0);
      await turn();
      await turn();
      x.controller.close();
      await turn();
      for (let i = 0; i < 4; i++) {
        log.push(`read: ${stream.read()?.length ?? null}`);
        await turn();
      }
    },
    expected: ["read: 1", "read: 1", "end", "close", "read: null", "read: null"],
  },

  {
    name: "a byte stream, a parked read: the node stream has ended when controller.close() returns",
    parked: true,
    make: fromWeb(openByteStream),
    act: (stream, log, x) => {
      x.controller.close();
      log.push(`ended inside close(): ${stream._readableState.ended}`);
    },
    expected: ["ended inside close(): true"],
  },
  {
    name: "a byte stream, a parked read: a chunk and the close in one turn, the chunk arrives first",
    make: fromWeb(openByteStream),
    act: async (stream, log, x) => {
      stream.on("data", data => log.push(`data: ${data[0]}`));
      await turn();
      x.controller.enqueue(chunk(1));
      x.controller.close();
    },
    expected: ["data: 1", "end", "close"],
  },
  // Node.js raises the `closed` flag of the adapter one promise job after the stream closes. Until then the destroy
  // that follows 'end' goes through reader.cancel(), and 'close' waits one promise job for it.
  {
    name: "a parked read, flowing: controller.close() in a callback of the event loop, 'close' waits for cancel()",
    flowing: true,
    make: fromWeb(openStream),
    act: (stream, log, x) => {
      x.controller.close();
      markOrder(log);
    },
    expected: ["end", "tick", "tick 2", "promise job", "close"],
  },
  {
    name: "a parked read, flowing: controller.close() in a promise job, 'close' is one tick after 'end'",
    flowing: true,
    from: "promise job",
    make: fromWeb(openStream),
    act: (stream, log, x) => {
      x.controller.close();
      markOrder(log);
    },
    expected: ["promise job", "end", "tick", "close", "tick 2"],
  },
  {
    name: "a parked read, flowing: controller.close() in a tick, 'close' waits for cancel()",
    flowing: true,
    from: "tick",
    make: fromWeb(openStream),
    act: (stream, log, x) => {
      x.controller.close();
      markOrder(log);
    },
    expected: ["end", "tick", "tick 2", "promise job", "close"],
  },
  {
    name: "a tee() branch, a parked read: controller.close() of the source",
    parked: true,
    make: fromWeb(x => openStream(x).tee()[0]),
    act: (stream, log, x) => {
      x.controller.close();
      log.push(`ended inside close(): ${stream._readableState.ended}`);
    },
    expected: ["ended inside close(): false"],
    bun: ["ended inside close(): true"],
    why: "tee() of Node.js closes its branches in a process.nextTick() (nodejs/node#39758). The spec and Bun close them where the source closes.",
  },

  // The web stream errors.
  {
    name: "an errored stream: the node stream is destroyed when read() returns",
    sameTurn: true,
    make: fromWeb(() => new ReadableStream({ start: controller => controller.error(new Error("boom")) })),
    act: (stream, log) => {
      read(stream, log);
      log.push(`destroyed inside read(): ${stream.destroyed}`);
    },
    expected: ["read: null", "destroyed inside read(): true", "error: boom", "close"],
  },
  {
    name: "a parked read: the node stream is destroyed when controller.error() returns",
    parked: true,
    make: fromWeb(openStream),
    act: (stream, log, x) => {
      x.controller.error(new Error("boom"));
      log.push(`destroyed inside error(): ${stream.destroyed}`);
    },
    expected: ["destroyed inside error(): true", "error: boom", "close"],
  },
  {
    name: "a parked read: 'error' is one promise job and one tick after controller.error()",
    parked: true,
    make: fromWeb(openStream),
    act: (stream, log, x) => {
      x.controller.error(new Error("boom"));
      markOrder(log);
    },
    expected: ["tick", "tick 2", "promise job", "error: boom", "close"],
  },
  {
    name: "a parked read: the error of the stream is ahead of a destroy(error) that follows it",
    parked: true,
    make: fromWeb(openStream),
    act: (stream, log, x) => {
      watch(stream, log);
      x.controller.error(new Error("boom"));
      stream.destroy(new Error("second"));
    },
    expected: ["error: boom", "finished: boom", "close"],
  },
  {
    name: "a pull() that errors the stream and then destroys the node stream: the error of the stream is reported",
    make: fromWeb(
      x =>
        new ReadableStream(
          {
            pull(controller) {
              controller.error(new Error("boom"));
              x.stream.destroy(new Error("second"));
            },
          },
          { highWaterMark: 0 },
        ),
    ),
    act: (stream, log) => {
      watch(stream, log);
      read(stream, log);
    },
    expected: ["read: null", "error: boom", "finished: boom", "close"],
  },
  {
    name: "a parked read: a chunk and an error in one turn, the chunk arrives first",
    make: fromWeb(openStream),
    act: async (stream, log, x) => {
      stream.on("data", data => log.push(`data: ${data[0]}`));
      await turn();
      x.controller.enqueue(chunk(1));
      x.controller.error(new Error("boom"));
    },
    expected: ["data: 1", "error: boom", "close"],
  },

  {
    name: "a parked read: controller.error(undefined) destroys the node stream with an AbortError",
    parked: true,
    make: fromWeb(openStream),
    act: (stream, log, x) => {
      watch(stream, log);
      x.controller.error(undefined);
      log.push(`destroyed inside error(): ${stream.destroyed}`);
    },
    expected: ["destroyed inside error(): true", "error: ABORT_ERR", "finished: ABORT_ERR", "close"],
  },
  {
    name: "a stream errored with null: read() destroys the node stream with an AbortError",
    sameTurn: true,
    make: fromWeb(() => new ReadableStream({ start: controller => controller.error(null) })),
    act: (stream, log) => {
      watch(stream, log);
      read(stream, log);
    },
    expected: ["read: null", "error: ABORT_ERR", "finished: ABORT_ERR", "close"],
  },
  {
    name: "a byte stream, a parked read: the node stream is destroyed when controller.error() returns",
    parked: true,
    make: fromWeb(openByteStream),
    act: (stream, log, x) => {
      x.controller.error(new Error("boom"));
      log.push(`destroyed inside error(): ${stream.destroyed}`);
    },
    expected: ["destroyed inside error(): true", "error: boom", "close"],
  },
  {
    name: "a parked read: controller.error() in a promise job, 'error' waits for cancel()",
    parked: true,
    from: "promise job",
    make: fromWeb(openStream),
    act: (stream, log, x) => {
      x.controller.error(new Error("boom"));
      markOrder(log);
    },
    expected: ["promise job", "tick", "error: boom", "close", "tick 2"],
  },
  {
    name: "a parked read: controller.error() in a tick, 'error' waits for cancel()",
    parked: true,
    from: "tick",
    make: fromWeb(openStream),
    act: (stream, log, x) => {
      x.controller.error(new Error("boom"));
      markOrder(log);
    },
    expected: ["tick", "tick 2", "promise job", "error: boom", "close"],
  },
  {
    name: "no read parked: controller.error() while the buffer of the node stream is full",
    make: fromWeb(twoChunks, { highWaterMark: 1 }),
    act: async (stream, log, x) => {
      stream.read(0);
      await turn();
      await turn();
      x.controller.error(new Error("boom"));
      await turn();
      log.push(`destroyed one turn after error(): ${stream.destroyed}`);
      log.push(`read: ${stream.read()?.length ?? null}`);
    },
    expected: ["error: boom", "close", "destroyed one turn after error(): true", "read: 1"],
    bun: ["destroyed one turn after error(): false", "read: 1", "error: boom", "close"],
    why: "Readable.fromWeb() does not watch reader.closed for an error. With no read parked it learns of the error at its next read (#43748).",
  },

  // destroy() of the node stream.
  {
    name: "a closed stream: read() and destroy() in one turn, 'end' is ahead of 'close'",
    make: fromWeb(closedStream),
    act: (stream, log) => {
      read(stream, log);
      stream.destroy();
    },
    expected: ["read: null", "end", "close"],
  },
  {
    name: "a pull() that closes the stream and then destroys the node stream: finished() reports the end",
    make: fromWeb(
      x =>
        new ReadableStream(
          {
            pull(controller) {
              controller.close();
              x.stream.destroy();
            },
          },
          { highWaterMark: 0 },
        ),
    ),
    act: (stream, log) => {
      watch(stream, log);
      read(stream, log);
    },
    expected: ["read: null", "end", "finished: ok", "close"],
  },
  {
    name: "a pull() that closes the stream and then destroys the node stream: pipeline() calls back with no error",
    make: fromWeb(
      x =>
        new ReadableStream(
          {
            pull(controller) {
              controller.close();
              x.stream.destroy();
            },
          },
          { highWaterMark: 0 },
        ),
    ),
    act: (stream, log) => pipeline(stream, sink(), error => log.push(`pipeline: ${error ? error.code : "ok"}`)),
    expected: ["end", "pipeline: ok", "close"],
  },
  {
    name: "a parked read: destroy() ends the node stream before it returns, and cancels the source",
    parked: true,
    make: fromWeb(x => new ReadableStream({ cancel: () => void (x.cancelled = true) })),
    act: async (stream, log, x) => {
      watch(stream, log);
      stream.destroy();
      log.push(`ended inside destroy(): ${stream._readableState.ended}`);
      await turn();
      log.push(`cancel() of the source ran: ${x.cancelled === true}`);
    },
    expected: ["ended inside destroy(): true", "close", "finished: ok", "cancel() of the source ran: true"],
  },
  {
    name: "a for await loop that waits, then destroy() in the same turn: the loop ends",
    make: fromWeb(() => new ReadableStream({})),
    act: (stream, log) => {
      awaitLoop(stream, log);
      stream.destroy();
    },
    expected: ["end", "loop: resolves", "close"],
  },
  {
    name: "a parked read: an aborted signal ends the node stream inside abort()",
    parked: true,
    make: (x, log) =>
      Readable.fromWeb(new ReadableStream({ cancel: reason => void log.push(`cancel: ${reason.name}`) }), {
        signal: (x.abort = new AbortController()).signal,
      }),
    act: (stream, log, x) => {
      watch(stream, log);
      x.abort.abort();
      log.push(`ended inside abort(): ${stream._readableState.ended}`);
    },
    expected: ["cancel: AbortError", "ended inside abort(): true", "error: ABORT_ERR", "finished: ABORT_ERR", "close"],
  },
  {
    name: "a parked read: a 'readable' listener that destroys the node stream inside controller.close()",
    parked: true,
    make: fromWeb(openStream),
    act: (stream, log, x) => {
      stream.on("readable", () => {
        log.push("readable");
        stream.destroy();
      });
      x.controller.close();
      markOrder(log);
    },
    expected: ["readable", "tick", "tick 2", "promise job", "close"],
  },

  {
    name: "a parked read: controller.close() then destroy() in one turn, 'close' waits for cancel()",
    parked: true,
    make: fromWeb(openStream),
    act: (stream, log, x) => {
      x.controller.close();
      stream.destroy();
      markOrder(log);
    },
    expected: ["tick", "tick 2", "promise job", "close"],
  },
  {
    name: "a parked read: controller.close() in a promise job, destroy() in the next one, 'close' is one tick later",
    parked: true,
    make: fromWeb(openStream),
    act: (stream, log, x) =>
      Promise.resolve()
        .then(() => x.controller.close())
        .then(() => {
          stream.destroy();
          markOrder(log);
        }),
    expected: ["promise job", "close", "tick", "tick 2"],
  },

  // What does not end a node stream, and what a chunk does.
  {
    name: "a closed stream: read(0) does not end it",
    make: fromWeb(closedStream),
    act: (stream, log) => read(stream, log, 0),
    expected: ["read: null"],
  },
  {
    name: "a closed stream: a 'readable' listener that never reads does not end it",
    make: fromWeb(closedStream),
    act: (stream, log) => void stream.on("readable", () => log.push("readable")),
    expected: ["readable"],
  },
  {
    name: "a pull() that closes after an await: the read() that started it does not end the stream",
    make: fromWeb(
      () =>
        new ReadableStream(
          {
            async pull(controller) {
              await undefined;
              controller.close();
            },
          },
          { highWaterMark: 0 },
        ),
    ),
    act: (stream, log) => read(stream, log),
    expected: ["read: null"],
  },
  {
    name: "ReadableStream.from([]): the read() that starts the iteration does not end the stream",
    make: fromWeb(() => ReadableStream.from([])),
    act: (stream, log) => read(stream, log),
    expected: ["read: null"],
  },
  {
    name: "a chunk and the close in start(): the chunk, then 'end'",
    make: fromWeb(
      () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(chunk(7));
            controller.close();
          },
        }),
    ),
    act: (stream, log) => void stream.on("data", data => log.push(`data: ${data[0]}`)),
    expected: ["data: 7", "end", "close"],
  },
  {
    name: "a parked read: a chunk and the close in one turn, the chunk arrives first",
    make: fromWeb(openStream),
    act: async (stream, log, x) => {
      stream.on("data", data => log.push(`data: ${data[0]}`));
      await turn();
      x.controller.enqueue(chunk(1));
      x.controller.close();
    },
    expected: ["data: 1", "end", "close"],
  },
  {
    name: "a parked read: destroy() in the turn of a chunk is ahead of the chunk",
    make: fromWeb(openStream),
    act: async (stream, log, x) => {
      stream.on("data", data => log.push(`data: ${data[0]}`));
      await turn();
      x.controller.enqueue(chunk(1));
      stream.destroy();
    },
    expected: ["close"],
  },

  // A consumer that takes one chunk per turn, and chunks as large as the highWaterMark of the node stream.
  {
    name: "pipe() to a Writable that holds its writes: the stream closes with chunks queued",
    make: fromWeb(openStream, { highWaterMark: 1 }),
    act: async (stream, log, x) => {
      const callbacks = [];
      stream.pipe(slowSink(log, callbacks));
      await turn();
      await turn();
      for (const byte of [1, 2, 3]) x.controller.enqueue(chunk(byte));
      x.controller.close();
      for (let i = 0; i < 5; i++) {
        await turn();
        log.push("turn");
        callbacks.shift()?.();
      }
    },
    expected: [
      "write: 1",
      "turn",
      "write: 2",
      "turn",
      "write: 3",
      "turn",
      "end",
      "dest finish",
      "close",
      "turn",
      "turn",
    ],
    bun: ["write: 1", "turn", "write: 2", "turn", "write: 3", "end", "close", "turn", "dest finish", "turn", "turn"],
    why: flowSync,
  },
  {
    name: "pause() in the 'data' listener, resume() one turn later: the stream closes with chunks queued",
    make: fromWeb(openStream, { highWaterMark: 1 }),
    act: async (stream, log, x) => {
      stream.on("data", data => {
        log.push(`data: ${data[0]}`);
        stream.pause();
      });
      await turn();
      for (const byte of [1, 2, 3]) x.controller.enqueue(chunk(byte));
      x.controller.close();
      for (let i = 0; i < 5; i++) {
        await turn();
        log.push("turn");
        stream.resume();
      }
    },
    expected: ["data: 1", "turn", "data: 2", "turn", "data: 3", "turn", "end", "close", "turn", "turn"],
    bun: ["data: 1", "turn", "data: 2", "turn", "data: 3", "end", "close", "turn", "turn", "turn"],
    why: flowSync,
  },
  {
    name: "Duplex.fromWeb, pipe() to a Writable that holds its writes: the readable side closes with chunks queued",
    make: duplexFromWeb(openStream, { highWaterMark: 1 }),
    act: async (stream, log, x) => {
      const callbacks = [];
      stream.pipe(slowSink(log, callbacks));
      await turn();
      await turn();
      for (const byte of [1, 2, 3]) x.controller.enqueue(chunk(byte));
      x.controller.close();
      for (let i = 0; i < 5; i++) {
        await turn();
        log.push("turn");
        callbacks.shift()?.();
      }
    },
    expected: [
      "write: 1",
      "turn",
      "write: 2",
      "turn",
      "write: 3",
      "turn",
      "end",
      "dest finish",
      "sink close",
      "finish",
      "close",
      "turn",
      "turn",
    ],
    bun: [
      "write: 1",
      "turn",
      "write: 2",
      "turn",
      "write: 3",
      "end",
      "sink close",
      "finish",
      "close",
      "turn",
      "dest finish",
      "turn",
      "turn",
    ],
    why: flowSync,
  },

  // Duplex.fromWeb(): the end of its readable side also ends its writable side.
  {
    name: "Duplex.fromWeb, a closed readable side: one read() ends the duplex",
    make: duplexFromWeb(closedStream),
    act: (stream, log) => {
      watch(stream, log);
      read(stream, log);
    },
    expected: ["read: null", "end", "sink close", "finish", "close", "finished: ok"],
  },
  {
    name: "Duplex.fromWeb, a pull() that closes inside the read: one read() ends the duplex",
    make: duplexFromWeb(() => new ReadableStream({ pull: controller => controller.close() }, { highWaterMark: 0 })),
    act: (stream, log) => read(stream, log),
    expected: ["read: null", "end", "sink close", "finish", "close"],
  },
  {
    name: "Duplex.fromWeb, a closed readable side: 'end' is one tick after the read()",
    make: duplexFromWeb(closedStream),
    act: (stream, log) => {
      stream.read();
      markOrder(log);
    },
    expected: ["end", "tick", "sink close", "tick 2", "promise job", "finish", "close"],
  },
  {
    name: "Duplex.fromWeb, a parked read: the readable side has ended when controller.close() returns",
    parked: true,
    make: duplexFromWeb(openStream),
    act: (stream, log, x) => {
      x.controller.close();
      log.push(`ended inside close(): ${stream._readableState.ended}`);
    },
    expected: ["ended inside close(): true"],
  },
  {
    name: "Duplex.fromWeb, a pull() that errors inside the read: the duplex is destroyed when read() returns",
    make: duplexFromWeb(
      () => new ReadableStream({ pull: controller => controller.error(new Error("boom")) }, { highWaterMark: 0 }),
    ),
    act: (stream, log) => {
      read(stream, log);
      log.push(`destroyed inside read(): ${stream.destroyed}`);
    },
    expected: ["sink abort", "read: null", "destroyed inside read(): true", "error: boom", "close"],
    bun: ["read: null", "destroyed inside read(): false", "error: boom", "close"],
    why: errorWaits,
  },
  {
    name: "Duplex.fromWeb, a parked read: the duplex is destroyed when controller.error() returns",
    parked: true,
    make: duplexFromWeb(openStream),
    act: (stream, log, x) => {
      watch(stream, log);
      x.controller.error(new Error("boom"));
      log.push(`destroyed inside error(): ${stream.destroyed}`);
    },
    expected: ["sink abort", "destroyed inside error(): true", "error: boom", "finished: boom", "close"],
    bun: ["destroyed inside error(): false", "error: boom", "finished: boom", "close"],
    why: errorWaits,
  },
  {
    name: "Duplex.fromWeb, a parked read: destroy() ends the readable side before it returns",
    parked: true,
    make: duplexFromWeb(() => new ReadableStream({})),
    act: (stream, log) => {
      watch(stream, log);
      stream.destroy();
      log.push(`ended inside destroy(): ${stream._readableState.ended}`);
    },
    expected: ["sink abort", "ended inside destroy(): true", "close", "finished: ERR_STREAM_PREMATURE_CLOSE"],
  },
  {
    name: "Duplex.fromWeb, a pull() that closes the stream and then destroys the duplex",
    make: duplexFromWeb(
      x =>
        new ReadableStream(
          {
            pull(controller) {
              controller.close();
              x.stream.destroy();
            },
          },
          { highWaterMark: 0 },
        ),
    ),
    act: (stream, log) => {
      watch(stream, log);
      read(stream, log);
    },
    expected: ["sink abort", "read: null", "end", "close", "finished: ERR_STREAM_PREMATURE_CLOSE"],
  },
  {
    name: "Duplex.fromWeb, a closed readable side: read(0) does not end the duplex",
    make: duplexFromWeb(closedStream),
    act: (stream, log) => read(stream, log, 0),
    expected: ["read: null"],
  },
  {
    name: "Duplex.fromWeb over a byte stream, a parked read: the readable side has ended when controller.close() returns",
    parked: true,
    make: duplexFromWeb(openByteStream),
    act: (stream, log, x) => {
      x.controller.close();
      log.push(`ended inside close(): ${stream._readableState.ended}`);
    },
    expected: ["ended inside close(): true"],
  },
  {
    name: "Duplex.fromWeb, a parked read: controller.error(undefined) destroys the duplex with an AbortError",
    parked: true,
    make: duplexFromWeb(openStream),
    act: (stream, log, x) => {
      watch(stream, log);
      x.controller.error(undefined);
    },
    expected: ["sink abort", "error: ABORT_ERR", "finished: ABORT_ERR", "close"],
    bun: ["error: ABORT_ERR", "finished: ABORT_ERR", "close"],
    why: errorWaits,
  },

  // Duplex.fromWeb() with writes. The end of the readable side is the end of the duplex: allowHalfOpen is false.
  {
    name: "Duplex.fromWeb, flowing: controller.close(), then write() in a promise job: the write comes after the end",
    flowing: true,
    make: duplexFromWeb(openStream),
    act: (stream, log, x) => {
      x.controller.close();
      Promise.resolve().then(() => write(stream, log, "a"));
    },
    expected: [
      "end",
      "sink close",
      "write(a) cb: ERR_STREAM_WRITE_AFTER_END",
      "error: ERR_STREAM_WRITE_AFTER_END",
      "close",
    ],
  },
  {
    name: "Duplex.fromWeb, flowing: controller.close(), then write() in a tick: the write is ahead of 'end'",
    flowing: true,
    make: duplexFromWeb(openStream),
    act: (stream, log, x) => {
      x.controller.close();
      process.nextTick(() => write(stream, log, "a"));
    },
    expected: ["end", "sink write: a", "write(a) cb: ok", "sink close", "finish", "close"],
  },
  {
    name: "Duplex.fromWeb, flowing: controller.close(), then write() two ticks later: the write comes after the end",
    flowing: true,
    make: duplexFromWeb(openStream),
    act: (stream, log, x) => {
      x.controller.close();
      process.nextTick(() => process.nextTick(() => write(stream, log, "a")));
    },
    expected: [
      "end",
      "sink close",
      "write(a) cb: ERR_STREAM_WRITE_AFTER_END",
      "error: ERR_STREAM_WRITE_AFTER_END",
      "close",
    ],
  },
  {
    name: "Duplex.fromWeb, flowing, allowHalfOpen: controller.close(), write() in a promise job, end() one turn later",
    flowing: true,
    make: duplexFromWeb(openStream, { allowHalfOpen: true }),
    act: async (stream, log, x) => {
      x.controller.close();
      Promise.resolve().then(() => write(stream, log, "a"));
      await turn();
      end(stream, log);
    },
    expected: ["end", "sink write: a", "write(a) cb: ok", "sink close", "end() cb", "finish", "close"],
  },
  {
    name: "Duplex.fromWeb: a 'readable' listener that ends the duplex inside controller.close()",
    make: duplexFromWeb(openStream),
    act: async (stream, log, x) => {
      stream.on("readable", () => {
        read(stream, log);
        end(stream, log);
      });
      await turn();
      x.controller.close();
      log.push("close() returned");
      markOrder(log);
    },
    expected: [
      "read: null",
      "sink close",
      "close() returned",
      "promise job",
      "end",
      "tick",
      "end() cb",
      "finish",
      "tick 2",
      "close",
    ],
  },
  {
    name: "Duplex.fromWeb, a closed readable side: read(), then write() in a promise job: the write comes after the end",
    make: duplexFromWeb(closedStream),
    act: (stream, log) => {
      read(stream, log);
      Promise.resolve().then(() => write(stream, log, "a"));
    },
    expected: [
      "read: null",
      "end",
      "sink close",
      "write(a) cb: ERR_STREAM_WRITE_AFTER_END",
      "error: ERR_STREAM_WRITE_AFTER_END",
      "close",
    ],
  },
  {
    name: "Duplex.fromWeb, a closed readable side: write() and read() in the turn of fromWeb()",
    sameTurn: true,
    make: duplexFromWeb(closedStream),
    act: (stream, log) => {
      write(stream, log, "a");
      read(stream, log);
    },
    expected: ["read: null", "end", "sink write: a", "write(a) cb: ok", "sink close", "finish", "close"],
  },
  {
    name: "Duplex.fromWeb, flowing: the sink errors, then controller.close() in one turn",
    flowing: true,
    make: duplexFromWeb(openStream),
    act: (stream, log, x) => {
      watch(stream, log);
      x.sinkController.error(new Error("sink boom"));
      x.controller.close();
    },
    expected: ["end", "error: sink boom", "finished: sink boom", "close"],
  },
  {
    name: "Duplex.fromWeb, flowing: controller.close(), then the sink errors in one turn",
    flowing: true,
    make: duplexFromWeb(openStream),
    act: (stream, log, x) => {
      watch(stream, log);
      x.controller.close();
      x.sinkController.error(new Error("sink boom"));
    },
    expected: ["end", "error: sink boom", "finished: sink boom", "close"],
  },
  {
    name: "Duplex.fromWeb(new TransformStream()): end() with a 'readable' listener",
    make: () => Duplex.fromWeb(new TransformStream()),
    act: async (stream, log) => {
      stream.on("readable", () => read(stream, log));
      await turn();
      end(stream, log);
      markOrder(log);
    },
    expected: ["read: null", "promise job", "tick", "end", "end() cb", "finish", "tick 2", "close"],
  },
  {
    name: "Duplex.fromWeb, flowing: write() then controller.close() in one turn",
    flowing: true,
    make: duplexFromWeb(openStream),
    act: (stream, log, x) => {
      write(stream, log, "a");
      x.controller.close();
    },
    expected: ["sink write: a", "end", "write(a) cb: ok", "sink close", "finish", "close"],
    bun: ["end", "sink write: a", "write(a) cb: ok", "sink close", "finish", "close"],
    why: writeHalf,
  },
  {
    name: "Duplex.fromWeb, flowing: write(), end(), controller.close() in one turn",
    flowing: true,
    make: duplexFromWeb(openStream),
    act: (stream, log, x) => {
      write(stream, log, "a");
      end(stream, log);
      x.controller.close();
    },
    expected: ["sink write: a", "end", "write(a) cb: ok", "sink close", "end() cb", "finish", "close"],
    bun: ["end", "sink write: a", "write(a) cb: ok", "sink close", "end() cb", "finish", "close"],
    why: writeHalf,
  },
  {
    name: "Duplex.fromWeb, flowing, allowHalfOpen: the 'end' listener writes and ends",
    flowing: true,
    make: duplexFromWeb(openStream, { allowHalfOpen: true }),
    act: (stream, log, x) => {
      stream.on("end", () => {
        write(stream, log, "a");
        end(stream, log);
      });
      x.controller.close();
      markOrder(log);
    },
    expected: [
      "end",
      "sink write: a",
      "tick",
      "tick 2",
      "promise job",
      "write(a) cb: ok",
      "sink close",
      "end() cb",
      "finish",
      "close",
    ],
    bun: [
      "end",
      "tick",
      "tick 2",
      "promise job",
      "sink write: a",
      "write(a) cb: ok",
      "sink close",
      "end() cb",
      "finish",
      "close",
    ],
    why: writeHalf,
  },
  {
    name: "Duplex.fromWeb: a 'readable' listener that writes inside controller.close()",
    make: duplexFromWeb(openStream),
    act: async (stream, log, x) => {
      stream.on("readable", () => {
        read(stream, log);
        write(stream, log, "a");
      });
      await turn();
      x.controller.close();
      log.push("close() returned");
      markOrder(log);
    },
    expected: [
      "read: null",
      "sink write: a",
      "close() returned",
      "write(a) cb: ok",
      "promise job",
      "end",
      "tick",
      "sink close",
      "tick 2",
      "finish",
      "close",
    ],
    bun: [
      "read: null",
      "close() returned",
      "sink write: a",
      "promise job",
      "write(a) cb: ok",
      "end",
      "tick",
      "sink close",
      "tick 2",
      "finish",
      "close",
    ],
    why: writeHalf,
  },
  {
    name: "Duplex.fromWeb, a closed readable side: write() then read() in one turn",
    make: duplexFromWeb(closedStream),
    act: (stream, log) => {
      write(stream, log, "a");
      read(stream, log);
    },
    expected: ["sink write: a", "read: null", "end", "write(a) cb: ok", "sink close", "finish", "close"],
    bun: ["read: null", "end", "sink write: a", "write(a) cb: ok", "sink close", "finish", "close"],
    why: writeHalf,
  },
  {
    name: "Duplex.fromWeb, flowing: write() then destroy() in one turn",
    flowing: true,
    make: duplexFromWeb(openStream),
    act: (stream, log) => {
      write(stream, log, "a");
      stream.destroy();
    },
    expected: ["sink write: a", "end", "write(a) cb: ok", "sink abort", "close"],
    bun: ["sink abort", "end", "write(a) cb: ok", "close"],
    why: writeHalf,
  },
  {
    name: "Duplex.fromWeb(new TransformStream()), flowing: transform() terminates the stream",
    flowing: true,
    make: (x, log) =>
      Duplex.fromWeb(
        new TransformStream({
          transform(data, controller) {
            controller.terminate();
            log.push(`ended inside terminate(): ${x.stream._readableState.ended}`);
          },
        }),
      ),
    act: (stream, log) => {
      watch(stream, log);
      write(stream, log, "a");
      log.push("write() returned");
    },
    expected: [
      "ended inside terminate(): true",
      "write() returned",
      "end",
      "write(a) cb: ok",
      "error: ERR_INVALID_STATE",
      "finished: ERR_INVALID_STATE",
      "close",
    ],
    bun: [
      "write() returned",
      "ended inside terminate(): true",
      "write(a) cb: ok",
      "error: The TransformStream has been terminated",
      "finished: The TransformStream has been terminated",
      "close",
    ],
    why: writeHalf,
  },
  {
    name: "Duplex.fromWeb(new TransformStream()), flowing: write() then destroy() in one turn",
    flowing: true,
    make: () => Duplex.fromWeb(new TransformStream()),
    act: (stream, log) => {
      watch(stream, log);
      write(stream, log, "a");
      stream.destroy();
    },
    expected: ["write(a) cb: ok", "close", "finished: ERR_STREAM_PREMATURE_CLOSE"],
    bun: ["end", "write(a) cb: ok", "close", "finished: ERR_STREAM_PREMATURE_CLOSE"],
    why: writeHalf,
  },
  {
    name: "Duplex.fromWeb, flowing: write() then controller.error() in one turn",
    flowing: true,
    make: duplexFromWeb(openStream),
    act: (stream, log, x) => {
      write(stream, log, "a");
      x.controller.error(new Error("boom"));
    },
    expected: ["sink write: a", "write(a) cb: ok", "sink abort", "error: boom", "close"],
    bun: ["sink write: a", "write(a) cb: ok", "error: boom", "close"],
    why: errorWaits,
  },
  {
    name: "Duplex.fromWeb, flowing: controller.error() then write() in one turn",
    flowing: true,
    make: duplexFromWeb(openStream),
    act: (stream, log, x) => {
      x.controller.error(new Error("boom"));
      write(stream, log, "a");
    },
    expected: ["sink abort", "write(a) cb: ERR_STREAM_DESTROYED", "error: boom", "close"],
    bun: ["sink write: a", "write(a) cb: ok", "error: boom", "close"],
    why: errorWaits,
  },
];

const starters = {
  "promise job": act => void Promise.resolve().then(act),
  "tick": act => process.nextTick(act),
};

// `act` always starts in a callback of the event loop, so that ticks and promise jobs come in one order wherever
// logOf() is called from.
async function logOf(row) {
  const x = {};
  const log = [];
  let stream;
  const make = () => {
    stream = x.stream = row.make(x, log);
    for (const event of ["end", "finish", "close"]) stream.on(event, () => log.push(event));
    stream.on("error", error => log.push(`error: ${codeOf(error)}`));
  };
  if (!row.sameTurn) {
    make();
    await turn();
    await turn();
    if (row.flowing) {
      stream.resume();
      await turn();
    }
    if (row.parked) {
      stream.read();
      await turn();
    }
  }
  await new Promise((resolve, reject) => {
    const act = () => {
      try {
        if (row.sameTurn) make();
        Promise.resolve(row.act(stream, log, x)).then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    };
    setImmediate(row.from ? () => starters[row.from](act) : act);
  });
  for (let i = 0; i < 6; i++) await turn();
  return log;
}

// The log that this runtime prints for the row.
const logFor = row => (process.versions.bun && row.bun) || row.expected;

module.exports = { rows, logOf, logFor };

if (require.main === module) {
  (async () => {
    let different = 0;
    for (const row of rows) {
      const log = await logOf(row);
      if (JSON.stringify(log) === JSON.stringify(logFor(row))) continue;
      different++;
      console.log(`${row.name}\n  expected: ${JSON.stringify(logFor(row))}\n  log:      ${JSON.stringify(log)}`);
    }
    console.log(`${rows.length - different} of ${rows.length} rows have the expected log`);
    process.exitCode = different ? 1 : 0;
  })();
}
