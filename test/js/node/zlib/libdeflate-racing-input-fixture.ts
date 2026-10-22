// Calls Bun.deflateSync and Bun.gzipSync on a shared mapping of argv[2] while a worker rewrites it.
// libdeflate sizes a block in one pass over the input and emits it in a second pass.
import { isMainThread, parentPort, Worker } from "node:worker_threads";

const view = Bun.mmap(process.argv[2], { shared: true });

if (isMainThread) {
  const worker = new Worker(new URL(import.meta.url), { argv: [process.argv[2]] });
  await new Promise(resolve => worker.on("message", resolve));
  worker.unref();

  for (let i = 0; i < 200; i++) {
    for (const compress of [Bun.deflateSync, Bun.gzipSync]) {
      let output: Uint8Array;
      try {
        output = compress(view, { library: "libdeflate" });
      } catch (error) {
        if (!/insufficient space/.test((error as Error).message)) throw error;
        continue;
      }
      if (output.length === 0) {
        console.log(`${compress.name} returned an empty result on call ${i}`);
        process.exit(1);
      }
    }
  }
  console.log("done");
  process.exit(0);
} else {
  // `costly`'s bytes are rare in `cheap`, so a Huffman table built from `cheap` gives them the longest codes.
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

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    view.set(cheap);
    for (let i = next() % 50000; i > 0; i--);
    view.set(costly);
    for (let i = next() % 5000; i > 0; i--);
  }
}
