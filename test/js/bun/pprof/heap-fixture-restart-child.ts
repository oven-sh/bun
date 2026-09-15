import { parentPort } from "node:worker_threads";

const kept: ArrayBuffer[] = [];
parentPort!.on("message", message => {
  if (message === "exit") process.exit(0);
  // 32 MiB
  for (let i = 0; i < 32; i++) kept.push(new ArrayBuffer(1024 * 1024));
  parentPort!.postMessage("allocated");
});
