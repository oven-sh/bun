// Every function of the API, called by C that JS has loaded (bun:ffi), with what the library read as it was loaded: before there is any Python, before the API is set up,
// while it is there, and when its interpreter has ended. argv: the directory of the libraries, who loads the library first.
import { dlopen } from "bun:ffi";
import { Worker, isMainThread, workerData } from "node:worker_threads";

const [libraries, order] = isMainThread ? process.argv.slice(2) : workerData;
const path = `${libraries}/libeverything.so`;
const load = () =>
  dlopen(path, {
    kept_is_null: { returns: "int" },
    call_everything_with: { args: ["int"], returns: "cstring" },
  }).symbols;
const inWorker = () =>
  new Promise(resolve =>
    new Worker(new URL(import.meta.url), { workerData: [libraries, order] }).once("exit", resolve),
  );
const say = (when, c) => {
  console.log(`${when}: what was kept is NULL: ${c.kept_is_null()}`);
  console.log(" with the exception:", String(c.call_everything_with(0)));
  console.log(" with the type:     ", String(c.call_everything_with(1)));
};
// With the API.
async function raise() {
  const { raise_what_was_kept } = await import("./in_two.py");
  return String(raise_what_was_kept(libraries));
}

if (!isMainThread) {
  const { hold_a_list, load_by_cdll } = await import("./in_two.py");
  console.log(
    "worker:",
    String(order === "a worker has the API and ends" ? hold_a_list(libraries) : load_by_cdll(libraries)),
  );
} else if (order === "JS loads it before there is any Python") {
  const c = load();
  say("before Python begins", c);
  await import("python:gc");
  say("when it has begun", c);
  console.log("main:", await raise());
  say("with the API", c);
} else if (order === "a worker loads it before main has a use for the API") {
  await import("python:gc");
  await inWorker();
  console.log("main:", await raise());
} else {
  await inWorker();
  const c = load();
  say("when the interpreter has ended", c);
  console.log(" with the list:     ", String(c.call_everything_with(2)));
}
