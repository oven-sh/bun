import { parentPort, Worker } from "node:worker_threads";

const child = new Worker(new URL("./fixture-execargv-preload-entry.mjs", import.meta.url));
child.once("message", message => {
  parentPort.postMessage({ child: message.preloads, parent: globalThis.execArgvPreloads ?? null });
});
