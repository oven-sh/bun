import { argv, execArgv } from "node:process";
import { parentPort, workerData } from "node:worker_threads";

parentPort.postMessage({
  argv: argv.slice(2),
  execArgv,
  preloads: globalThis.execArgvPreloads ?? null,
  workerData,
});
