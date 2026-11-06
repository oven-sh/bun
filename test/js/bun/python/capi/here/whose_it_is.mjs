// The C API serves the first Python interpreter of the process, whatever the others do, and nobody after it. argv: the directory of the libraries, who is first.
// Python begins in a thread when the first module of it is imported there, so nothing of it is imported at the top.
import { dlopen } from "bun:ffi";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const [libraries, order] = isMainThread ? process.argv.slice(2) : workerData;
const python = () => import("./in_two.py");
const message = from => new Promise(resolve => from.once("message", resolve));
const start = () => new Worker(new URL(import.meta.url), { workerData: [libraries, order] });
const end = worker => new Promise(resolve => worker.once("exit", resolve));

if (!isMainThread) {
  const { has_the_api, all_but_a_call } = await python();
  if (order === "main first") console.log("worker:", String(all_but_a_call(libraries)));
  if (order === "a worker first") {
    parentPort.postMessage("Python runs here");
    await message(parentPort);
  }
  console.log("worker has the API:", String(has_the_api(libraries)));
} else if (order === "main first") {
  const { has_the_api } = await python();
  await end(start());
  console.log("main has the API:", String(has_the_api(libraries)));
} else if (order === "main first, which has no use for it yet") {
  // Asked by C that JS has loaded: nothing of Python's has a part in that.
  const { is_initialized } = dlopen(`${libraries}/libwithout_gil.so`, { is_initialized: { returns: "int" } }).symbols;
  console.log("before Python begins:", is_initialized());
  await import("python:gc");
  console.log("when it has begun:", is_initialized());
  await end(start());
  console.log("main has the API:", String((await python()).has_the_api(libraries)));
} else if (order === "a worker first") {
  const worker = start();
  await message(worker);
  const { has_the_api, all_but_a_call } = await python();
  console.log("main:", String(all_but_a_call(libraries)));
  console.log("main has the API:", String(has_the_api(libraries)));
  worker.postMessage("go on");
  await end(worker);
} else {
  await end(start());
  const { has_the_api } = await python();
  console.log("main has the API:", String(has_the_api(libraries)));
  await end(start());
}
