// Each case reads a native stream through a node:stream Readable and prints one line when the stream ends:
// [name of the case, what it saw]. A stream that stops prints nothing, and the process ends without the line.
// The arguments are the groups of cases to run. `node` runs the groups "fetch" and "listeners" too, and prints the
// same lines.
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { Duplex, Readable } from "node:stream";

const lettersOf = chunk => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.length).toString("latin1");
// "aaaaaaaa 0/8": the bytes of a chunk, its offset in its ArrayBuffer, and the length of that ArrayBuffer.
const shapesOf = chunks =>
  chunks.map(chunk => lettersOf(chunk) + " " + chunk.byteOffset + "/" + chunk.buffer.byteLength);
// "16384@0/16384": the same for chunks too long to print.
const sizesOf = chunks => chunks.map(chunk => chunk.length + "@" + chunk.byteOffset + "/" + chunk.buffer.byteLength);
// "a1024 b1024 ...": each run of one letter and its length.
const runsOf = chunks =>
  chunks
    .map(lettersOf)
    .join("")
    .replace(/(.)\1*/g, run => run[0] + run.length + " ")
    .trim();
// For chunks whose sizes the platform decides: the bytes, and whether each chunk is the whole of an ArrayBuffer of
// its own.
const bytesOf = chunks => ({
  runs: runsOf(chunks),
  own:
    chunks.every(chunk => chunk.byteOffset === 0 && chunk.buffer.byteLength === chunk.length) &&
    new Set(chunks.map(chunk => chunk.buffer)).size === chunks.length,
});

// Block i is `size` times the letter a + i.
const blocksOf = (count, size) => Array.from({ length: count }, (_, i) => Buffer.alloc(size, 97 + i));
const BLOCKS = blocksOf(4, 8);

// One server for every case. It does not keep the process alive, so a stream that stops lets the process end.
const responses = new Map();
const server = createServer((req, res) => responses.get(req.url)(res));
server.unref();
const listening = once(server.listen(0, "127.0.0.1"), "listening");
let requests = 0;

// `read` gets the body of a fetch(), next() and fail(). The server sends the first block at once, and each block after
// it when next() is called, so every block is a read of its own. fail() breaks the connection.
async function fetched(read, blocks = BLOCKS) {
  await listening;
  const path = "/" + requests++;
  let next = () => {};
  let fail = () => {};
  responses.set(path, res => {
    let sent = 0;
    next = () => {
      if (sent === blocks.length) return;
      const block = blocks[sent++];
      if (sent === blocks.length) res.end(block);
      else res.write(block);
    };
    fail = () => res.destroy();
    next();
  });
  try {
    const { body } = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    return await read(
      body,
      () => next(),
      () => fail(),
    );
  } finally {
    responses.delete(path);
  }
}

// Every chunk of `readable`. Each chunk asks for the next block, or with `blocks` the chunk that ends a block does.
function chunksOf(readable, next = () => {}, blocks) {
  const kept = [];
  let read = 0;
  let block = 0;
  readable.on("data", chunk => {
    kept.push(chunk);
    if (blocks === undefined) return next();
    read += chunk.length;
    if (read < blocks[block].length) return;
    read = 0;
    block++;
    next();
  });
  return once(readable, "end").then(() => kept);
}

// No read() in it: every block stays in the buffer of `readable`, and asks for the next one when it lands there.
function whenEveryBlockWaits(readable, next) {
  const { promise, resolve } = Promise.withResolvers();
  let waiting = 0;
  readable.on("readable", function onReadable() {
    for (const landed = readable.readableLength / 8; waiting < landed; waiting++) next();
    if (waiting < BLOCKS.length) return;
    readable.removeListener("readable", onReadable);
    resolve();
  });
  return promise;
}

const groups = {
  fetch: {
    "fetch body": () => fetched(async (body, next) => shapesOf(await chunksOf(Readable.fromWeb(body), next))),
    "fetch body, objectMode": () =>
      fetched(async (body, next) => shapesOf(await chunksOf(Readable.fromWeb(body, { objectMode: true }), next))),
    "Duplex.from(fetch body)": () => fetched(async (body, next) => shapesOf(await chunksOf(Duplex.from(body), next))),
    // Longer than the typed arrays that JavaScriptCore keeps in the heap of its cells (1000 bytes).
    "fetch body, blocks of 3000 bytes": () => {
      const blocks = blocksOf(4, 3000);
      return fetched(async (body, next) => bytesOf(await chunksOf(Readable.fromWeb(body), next, blocks)), blocks);
    },
    // A block fills the buffer of 4096 bytes, and the read after it gets the rest at once: 2000 bytes, then 500.
    "fetch body, blocks longer than the buffer": () => {
      const blocks = [8, 6096, 4596].map((size, i) => Buffer.alloc(size, 97 + i));
      return fetched(
        async (body, next) => bytesOf(await chunksOf(Readable.fromWeb(body, { highWaterMark: 4096 }), next, blocks)),
        blocks,
      );
    },
    "fetch body, highWaterMark 0": () => {
      const blocks = blocksOf(3, 600);
      return fetched(
        async (body, next) => bytesOf(await chunksOf(Readable.fromWeb(body, { highWaterMark: 0 }), next, blocks)),
        blocks,
      );
    },
    "fetch body, objectMode, blocks of 1000 bytes": () => {
      const blocks = blocksOf(3, 1000);
      return fetched(
        async (body, next) => bytesOf(await chunksOf(Readable.fromWeb(body, { objectMode: true }), next, blocks)),
        blocks,
      );
    },
    // "a€b": the first block ends inside the three bytes of the euro sign.
    "setEncoding('utf8')": () =>
      fetched(
        (body, next) => chunksOf(Readable.fromWeb(body).setEncoding("utf8"), next),
        [Buffer.from([0x61, 0xe2]), Buffer.from([0x82, 0xac, 0x62])],
      ),
  },

  listeners: {
    "a listener moves its chunk out while others wait": () =>
      fetched(async (body, next) => {
        const readable = Readable.fromWeb(body);
        await whenEveryBlockWaits(readable, next);
        const told = [];
        readable.on("data", chunk => {
          told.push(chunk.toString());
          // As postMessage(chunk, [chunk.buffer]) moves it.
          if (chunk.length > 0) structuredClone(chunk, { transfer: [chunk.buffer] });
        });
        readable.on("end", () => told.push("end"));
        await once(readable, "close");
        return [...told, "close"].join(" ");
      }),
    // enqueue() on a byte stream transfers the ArrayBuffer of the chunk. No transfer list is written here.
    "a byte stream enqueues the chunks": () =>
      fetched(async (body, next) => {
        const readable = Readable.fromWeb(body);
        await whenEveryBlockWaits(readable, next);
        const bytes = new ReadableStream({
          type: "bytes",
          start(controller) {
            readable.on("data", chunk => controller.enqueue(chunk));
            readable.on("end", () => controller.close());
          },
        });
        const got = [];
        for await (const chunk of bytes) got.push(lettersOf(chunk));
        return [...got, "closed"].join(" ");
      }),
    // The body ends with the block that follows the last move, so a stream that stops there leaves nothing open.
    "a listener moves its chunk out while the next read waits": () =>
      fetched(
        async (body, next) => {
          const readable = Readable.fromWeb(body);
          const told = [];
          readable.on("data", chunk => {
            told.push(chunk.toString());
            // After the ticks in which the stream asks its source for the next chunk.
            setImmediate(() => {
              structuredClone(chunk, { transfer: [chunk.buffer] });
              next();
            });
          });
          await once(readable, "end");
          return [...told, "end"].join(" ");
        },
        BLOCKS.slice(0, 3),
      ),
    "a listener keeps the chunks and reads again": () =>
      fetched(async (body, next) => {
        const readable = Readable.fromWeb(body);
        const kept = [];
        readable.on("data", chunk => {
          kept.push(chunk);
          next();
          // The next read starts before this listener returns.
          readable.read(0);
        });
        await once(readable, "end");
        return kept.join(" ");
      }),
    // The source fails while a read waits. Node.js emits 'error' from a tick, so a listener that throws there is an
    // uncaught exception, not the rejection of a promise that nobody holds.
    "an 'error' listener throws": () =>
      fetched(async (body, next, fail) => {
        const readable = Readable.fromWeb(body, { autoDestroy: false });
        const thrown = new Error("thrown by the listener");
        const { promise, resolve } = Promise.withResolvers();
        const onUncaught = error => settle("uncaughtException", error);
        const onRejection = error => settle("unhandledRejection", error);
        function settle(kind, error) {
          process.off("uncaughtException", onUncaught);
          process.off("unhandledRejection", onRejection);
          resolve(error === thrown ? kind : `${kind}: ${error}`);
        }
        process.on("uncaughtException", onUncaught);
        process.on("unhandledRejection", onRejection);
        readable.on("error", () => {
          throw thrown;
        });
        readable.on("data", () => fail());
        return promise;
      }),
    // A block is 4 runs of 1024 bytes and the stream reads into a buffer of 1024, so a read that waits gets it
    // filled whole.
    "a listener keeps a chunk that fills the buffer and reads again": () => {
      const RUN = 1024;
      const blocks = [0, 4, 8].map(first =>
        Buffer.concat([0, 1, 2, 3].map(run => Buffer.alloc(RUN, 97 + first + run))),
      );
      return fetched(async (body, next) => {
        const readable = Readable.fromWeb(body, { highWaterMark: RUN });
        const kept = [];
        let bytes = 0;
        readable.on("data", chunk => {
          kept.push(chunk);
          if ((bytes += chunk.length) % (4 * RUN) === 0) next();
          readable.read(0);
        });
        await once(readable, "end");
        return runsOf(kept);
      }, blocks);
    },
  },

  // The sources that only Bun has. FIXTURE_DIR is a directory to write a file into.
  bun: {
    async "Bun.serve request body"() {
      let resume = () => {};
      // Enqueues the next block when resume() is called.
      const body = new ReadableStream({
        async pull(controller) {
          for (let i = 0; i < BLOCKS.length; i++) {
            controller.enqueue(BLOCKS[i]);
            if (i < BLOCKS.length - 1) await new Promise(resolve => (resume = resolve));
          }
          controller.close();
        },
      });
      const { promise, resolve } = Promise.withResolvers();
      using server = Bun.serve({
        port: 0,
        async fetch(req) {
          resolve(await chunksOf(Readable.fromWeb(req.body), () => resume()));
          return new Response();
        },
      });
      server.unref();
      await fetch(server.url, { method: "POST", body, duplex: "half" });
      return shapesOf(await promise);
    },
    // The first 16384 bytes are a chunk of the source. Then two reads fill the buffer of the stream, and the last
    // one does not.
    async Blob() {
      const blob = new Blob(
        [
          [16384, "a"],
          [65536, "b"],
          [65536, "c"],
          [1000, "d"],
        ].map(([size, fill]) => Buffer.alloc(size, fill)),
      );
      const kept = await chunksOf(Readable.fromWeb(blob.stream(), { highWaterMark: 64 * 1024 }));
      return { runs: runsOf(kept), chunks: sizesOf(kept) };
    },
    // The stream reads into a buffer of 512 bytes when its highWaterMark is less.
    async "Blob, highWaterMark 0"() {
      const blob = new Blob([Buffer.alloc(16384, "a"), Buffer.alloc(1000, "b")]);
      const kept = await chunksOf(Readable.fromWeb(blob.stream(), { highWaterMark: 0 }));
      return { runs: runsOf(kept), chunks: sizesOf(kept) };
    },
    // The last read of a file does not fill the buffer of the stream.
    async "Bun.file"() {
      const path = join(process.env.FIXTURE_DIR, "file.bin");
      writeFileSync(path, Buffer.concat([Buffer.alloc(65536, "a"), Buffer.alloc(34464, "b")]));
      return bytesOf(await chunksOf(Readable.fromWeb(Bun.file(path).stream(), { highWaterMark: 64 * 1024 })));
    },
    async "Bun.file, highWaterMark 0"() {
      const path = join(process.env.FIXTURE_DIR, "short.bin");
      writeFileSync(path, Buffer.concat([Buffer.alloc(1500, "a"), Buffer.alloc(1500, "b")]));
      return bytesOf(await chunksOf(Readable.fromWeb(Bun.file(path).stream(), { highWaterMark: 0 })));
    },
  },

  kept: {
    // A stream that the program keeps after it is over holds no buffer. Every buffer counts as a Uint8Array.
    async "streams that are kept"() {
      // Node.js does not have it.
      const { heapStats } = await import("bun:jsc");
      const COUNT = 8;
      const buffers = () => {
        Bun.gc(true);
        return heapStats().objectTypeCounts.Uint8Array ?? 0;
      };
      // What happens at the second chunk, for COUNT streams each. The stream has read into its buffer then, and asks
      // for the third block.
      const ways = {
        "it ends": (readable, next) => next(),
        "a 'data' listener destroys it": readable => readable.destroy(),
        "it is destroyed while its read waits": readable => setImmediate(() => readable.destroy()),
        "its source fails": (readable, next, fail) => fail(),
      };
      const kept = [];
      const before = buffers();
      for (const over of Object.values(ways)) {
        await Promise.all(
          Array.from({ length: COUNT }, () =>
            fetched(
              async (body, next, fail) => {
                const readable = Readable.fromWeb(body);
                kept.push(readable);
                let chunks = 0;
                readable.on("data", () => (++chunks === 1 ? next() : over(readable, next, fail)));
                // once() rejects for the 'error' of the source that fails.
                readable.on("error", () => {});
                await new Promise(resolve => readable.on("close", resolve));
                // The listeners hold the response of the server.
                readable.removeAllListeners();
              },
              blocksOf(3, 8),
            ),
          ),
        );
      }
      // The end of a request reaches the source of its body from another thread: look again for two seconds.
      const deadline = performance.now() + 2000;
      let left = buffers() - before;
      while (left >= COUNT / 2 && performance.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 10));
        left = buffers() - before;
      }
      return left < COUNT / 2 ? "no buffers" : `${left} buffers for ${kept.length} streams`;
    },
  },
};

for (const group of process.argv.slice(2)) {
  for (const [name, run] of Object.entries(groups[group])) {
    run().then(seen => console.log(JSON.stringify([name, seen])));
  }
}
