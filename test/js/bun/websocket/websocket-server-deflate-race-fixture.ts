// A Bun.serve WebSocket with permessage-deflate sends the same buffer over and
// over while a worker thread overwrites it. MODE picks the kind of shared
// memory: "sab" is a SharedArrayBuffer view, "mmap" is a MAP_SHARED Bun.mmap of
// FILE.
//
// A two-pass compressor sizes a block in the first pass and emits it in the
// second. If the input changes in between, it can write past the end of its
// output buffer. The worker flips the buffer between a pattern that compresses
// well and one whose bytes are rare in the first pattern's Huffman code.
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

const SIZE = 4000;
// With a compressor that overruns, a sanitizer build aborts within the first 30 sends.
const SENDS = 500;
// The main thread exits the process as soon as the sends finish. This deadline
// only keeps the worker from spinning forever if it outlives its parent.
const FLIP_BUDGET_MS = 30_000;

/** Uses xorshift32 so both patterns are identical on every run. */
function patterns(length: number) {
  let state = 88172645;
  const next = () => ((state ^= state << 13), (state ^= state >>> 17), (state ^= state << 5), state >>> 0);

  // `cheap` is bytes 0x00 to 0x7f, plus one of each of the 16 byte values
  // `costly` uses. Those 16 get the longest codewords in `cheap`'s Huffman
  // code, so emitting `length` bytes of `costly` with that code needs about
  // twice the space the sizing pass reserved.
  const cheap = new Uint8Array(length);
  const costly = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    cheap[i] = next() & 0x7f;
    costly[i] = 0xf0 + (next() & 0x0f);
  }
  for (let i = 0; i < 16; i++) cheap[next() % length] = 0xf0 + i;
  return { cheap, costly, next };
}

if (isMainThread) {
  const mode = process.env.MODE === "mmap" ? "mmap" : "sab";
  let view: Uint8Array;
  let handle: SharedArrayBuffer | string;
  if (mode === "mmap") {
    handle = process.env.FILE!;
    view = Bun.mmap(handle, { shared: true });
  } else {
    const shared = new SharedArrayBuffer(SIZE);
    handle = shared;
    view = new Uint8Array(shared);
  }

  const worker = new Worker(new URL(import.meta.url), { workerData: { mode, handle } });
  await new Promise(resolve => worker.on("message", resolve));
  worker.unref();

  const sent = Promise.withResolvers<void>();
  const server = Bun.serve({
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response("expected an upgrade", { status: 400 });
    },
    websocket: {
      perMessageDeflate: true,
      open(ws) {
        for (let i = 0; i < SENDS; i++) ws.send(view, true);
        sent.resolve();
      },
      message() {},
    },
  });

  const client = new WebSocket(`ws://localhost:${server.port}/`);
  client.onmessage = () => {};
  await sent.promise;
  console.log("done");
  process.exit(0);
} else {
  const { mode, handle } = workerData as { mode: string; handle: SharedArrayBuffer | string };
  const view: Uint8Array =
    mode === "mmap" ? Bun.mmap(handle as string, { shared: true }) : new Uint8Array(handle as SharedArrayBuffer);
  const { cheap, costly, next } = patterns(view.length);

  parentPort!.postMessage("ready");

  const deadline = Date.now() + FLIP_BUDGET_MS;
  while (Date.now() < deadline) {
    view.set(cheap);
    for (let i = next() % 50000; i > 0; i--);
    view.set(costly);
    for (let i = next() % 5000; i > 0; i--);
  }
}
