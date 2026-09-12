// A Bun.serve WebSocket sends the same bytes with permessage-deflate on while
// a worker rewrites them. MODE picks the memory another thread can write:
// "sab" a SharedArrayBuffer view, "mmap" a MAP_SHARED Bun.mmap region over FILE.
//
// uWS hands the payload straight to libdeflate_deflate_compress, which reads
// the input twice: the first pass costs the deflate block against the space
// left in the 4 KiB uWS::DeflationStream::reset_buffer, and the second pass
// emits the block with no further bounds check. The worker flips the bytes
// between a pattern that costs little and a pattern whose symbols are rare in
// the other pattern's Huffman code. A flip between the two passes makes the
// emitted block longer than the cost, which writes past that buffer.
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

const SIZE = 4000;
// Unpatched, a sanitizer build aborts within the first 30 sends.
const SENDS = 500;
// The main thread ends the process as soon as the sends finish. This bound
// only stops the worker spinning forever if it ever outlives its parent.
const FLIP_BUDGET_MS = 30_000;

/** xorshift32, so both patterns are the same on every run. */
function patterns(length: number) {
  let state = 88172645;
  const next = () => ((state ^= state << 13), (state ^= state >>> 17), (state ^= state << 5), state >>> 0);

  // `cheap` holds bytes 0x00 to 0x7f, plus 16 single occurrences of the bytes
  // `costly` is made of. Those 16 get the longest codewords in the code built
  // from `cheap`, so re-emitting `length` `costly` bytes through that code
  // needs about twice the space the cost pass reserved.
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
