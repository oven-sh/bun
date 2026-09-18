import { parentPort } from "node:worker_threads";

const kept: ArrayBuffer[] = [];
parentPort!.on("message", message => {
  if (message === "exit") process.exit(0);
  // 16 MiB
  for (let i = 0; i < 256; i++) {
    kept.push(new ArrayBuffer(64 * 1024));
    if (kept.length > 128) kept.length = 0;
  }
  parentPort!.postMessage("allocated");
});
