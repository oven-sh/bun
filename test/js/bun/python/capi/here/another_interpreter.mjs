// C that runs for an interpreter which the API does not serve is refused, and that costs the interpreter which it serves nothing. argv: the directory of the libraries.
import { Worker, isMainThread, workerData } from "node:worker_threads";
import { all_but_a_call, count_and_ask_by_cdll, is_held_until_given_back } from "./in_two.py";

if (isMainThread) {
  const libraries = process.argv[2];
  console.log("main:", String(is_held_until_given_back(libraries)));
  const worker = new Worker(new URL(import.meta.url), { workerData: libraries });
  await new Promise(resolve => worker.once("exit", resolve));
  console.log("main:", String(is_held_until_given_back(libraries)));
} else {
  all_but_a_call(workerData);
  console.log("worker:", String(count_and_ask_by_cdll(workerData)));
}
