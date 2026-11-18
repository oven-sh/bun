// Calls Bun.gunzipSync on a shared mapping of argv[2], a gzip file with a name in its header, while a worker rewrites
// the byte at argv[3], which ends the name. A call that finds the end of the name returns argv[4], and another throws.
import { isMainThread, parentPort, Worker } from "node:worker_threads";

const view = Bun.mmap(process.argv[2], { shared: true });
const nameEnd = Number(process.argv[3]);
// The worker writes until then.
const deadline = Date.now() + 30_000;

if (isMainThread) {
  const worker = new Worker(new URL(import.meta.url), { argv: process.argv.slice(2) });
  await new Promise(resolve => worker.on("message", resolve));
  worker.unref();

  let returned = 0;
  let threw = 0;
  // Until the writer has been seen to run, for as long as it writes.
  for (let i = 0; i < 20_000 || ((returned === 0 || threw === 0) && Date.now() < deadline); i++) {
    let output: Uint8Array;
    try {
      output = Bun.gunzipSync(view, { library: "libdeflate" });
    } catch (error) {
      if ((error as Error).message !== "libdeflate returned an error: bad data") throw error;
      threw++;
      continue;
    }
    if (Buffer.from(output).toString() !== process.argv[4]) {
      console.log(`gunzipSync returned other data on call ${i}`);
      process.exit(1);
    }
    returned++;
  }
  if (returned === 0 || threw === 0) {
    console.log(`the writer was not seen to run: ${returned} calls returned and ${threw} threw`);
    process.exit(1);
  }
  console.log("done");
  process.exit(0);
} else {
  parentPort!.postMessage("ready");

  while (Date.now() < deadline) {
    for (let i = 0; i < 4096; i++) {
      view[nameEnd] = 0x41;
      view[nameEnd] = 0;
    }
  }
}
