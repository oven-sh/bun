// C that runs for an interpreter which the API does not serve is refused, and the interpreter which it serves goes on letting go of what C gives back. argv: the directory of the libraries.
import { Worker, isMainThread, workerData } from "node:worker_threads";
import {
  all_but_a_call,
  call_something_else,
  count_and_ask_by_cdll,
  is_held_until_given_back,
  load_and_let_go,
  load_something_else,
  made_by_cdll,
  raise_by_cdll,
} from "./in_two.py";

if (isMainThread) {
  const libraries = process.argv[2];
  console.log("main:", String(is_held_until_given_back(libraries)));
  const worker = new Worker(new URL(import.meta.url), { workerData: libraries });
  await new Promise(resolve => worker.once("exit", resolve));
  console.log("main:", String(is_held_until_given_back(libraries)));
} else {
  all_but_a_call(workerData);
  console.log("worker:", String(count_and_ask_by_cdll(workerData)));
  console.log("worker, what C makes:", String(made_by_cdll(workerData)));
  console.log("worker, what C raises:", String(raise_by_cdll(workerData)));
  console.log("worker, the next call:", String(call_something_else()));
  console.log("worker, what C raises:", String(raise_by_cdll(workerData)));
  console.log("worker, the next library:", String(load_something_else()));
  console.log("worker, a library that raises as it goes:", String(load_and_let_go(workerData)));
  console.log("worker, the next call:", String(call_something_else()));
}
