// id() of a built-in type that C names by a symbol is the address of the symbol in every interpreter, with the API or without. argv: the directory of the libraries.
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { has_the_api, identities, identities_agree, is_written_as_none } from "./in_two.py";

if (isMainThread) {
  const libraries = process.argv[2];
  const first = String(identities());
  const worker = new Worker(new URL(import.meta.url), { workerData: libraries });
  const [inWorker] = await Promise.all([
    new Promise(resolve => worker.once("message", resolve)),
    new Promise(resolve => worker.once("exit", resolve)),
  ]);
  console.log("main:", String(identities_agree()), String(has_the_api(libraries)), String(identities_agree()));
  console.log("the same in both:", inWorker === first, "and later:", String(identities()) === first);
  console.log("main: null and undefined:", String(is_written_as_none(null)), String(is_written_as_none(undefined)));
} else {
  console.log("worker:", String(identities_agree()), String(has_the_api(workerData)), String(identities_agree()));
  console.log("worker: null and undefined:", String(is_written_as_none(null)), String(is_written_as_none(undefined)));
  parentPort.postMessage(String(identities()));
}
