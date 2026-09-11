// Bun.deflateSync and Bun.gzipSync over an input a worker rewrites during the
// call.
//
// libdeflate reads the input twice: it costs the deflate block from the first
// pass, compares that cost against the output buffer once, then emits the
// block in a second pass with no further bounds check. Bun sizes the output
// with libdeflate_deflate_compress_bound, so the cost always fits for an input
// that holds still. An input another thread rewrites between the two passes
// can outgrow that bound, and the emit pass then writes past the buffer.
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

const SIZE = 4096;
// Unpatched, a sanitizer build aborts well inside this many calls.
const CALLS = Number(process.env.CALLS || 200);
const FLIP_BUDGET_MS = 30_000;

if (isMainThread) {
  const shared = new SharedArrayBuffer(SIZE);
  const worker = new Worker(new URL(import.meta.url), { workerData: shared });
  await new Promise(resolve => worker.on("message", resolve));
  worker.unref();

  const view = new Uint8Array(shared);

  for (let i = 0; i < CALLS; i++) {
    for (const compress of [Bun.deflateSync, Bun.gzipSync]) {
      try {
        compress(view, { library: "libdeflate" });
      } catch (error) {
        // A racing input may outgrow the bound. That call is refused, which is fine. A crash is not.
        if (!/insufficient space/.test((error as Error).message)) throw error;
      }
    }
  }
  console.log("done");
  process.exit(0);
} else {
  const view = new Uint8Array(workerData as SharedArrayBuffer);

  // xorshift32, so both patterns are the same on every run. `cheap` holds
  // bytes 0x00 to 0x7f plus 16 single occurrences of the bytes `costly` is
  // made of. Those 16 get the longest codewords in the code built from
  // `cheap`, so re-emitting `costly` through that code needs about twice the
  // space the cost pass reserved.
  let state = 88172645;
  const next = () => ((state ^= state << 13), (state ^= state >>> 17), (state ^= state << 5), state >>> 0);
  const cheap = new Uint8Array(view.length);
  const costly = new Uint8Array(view.length);
  for (let i = 0; i < view.length; i++) {
    cheap[i] = next() & 0x7f;
    costly[i] = 0xf0 + (next() & 0x0f);
  }
  for (let i = 0; i < 16; i++) cheap[next() % view.length] = 0xf0 + i;

  parentPort!.postMessage("ready");

  const deadline = Date.now() + FLIP_BUDGET_MS;
  while (Date.now() < deadline) {
    view.set(cheap);
    for (let i = next() % 50000; i > 0; i--);
    view.set(costly);
    for (let i = next() % 5000; i > 0; i--);
  }
}
