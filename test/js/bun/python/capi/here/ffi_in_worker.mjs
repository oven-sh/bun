// A Worker that runs no Python gets into C by bun:ffi. It is a thread without the GIL like any other. argv: the directory of the libraries, what it calls the API with.
import { dlopen } from "bun:ffi";
import { Worker, isMainThread, workerData } from "node:worker_threads";

const [libraries, what] = isMainThread ? process.argv.slice(2) : workerData;
if (isMainThread) {
  const { hold_a_list, is_held_until_given_back } = await import("./in_two.py");
  console.log("main:", String(hold_a_list(libraries)), String(is_held_until_given_back(libraries)));
  await new Promise(resolve =>
    new Worker(new URL(import.meta.url), { workerData: [libraries, what] }).once("exit", resolve),
  );
  console.log("main:", String(is_held_until_given_back(libraries)));
} else {
  const c = dlopen(`${libraries}/libeverything.so`, {
    call_everything_with: { args: ["int"], returns: "cstring" },
  }).symbols;
  console.log("worker:", String(c.call_everything_with(["an exception", "a type", "a list of main's"].indexOf(what))));
}
