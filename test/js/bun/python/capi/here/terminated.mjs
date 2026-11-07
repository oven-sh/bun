// A Worker has the API. It is terminated in the middle of a turn: the tp_dealloc of a parent has given back two instances, and that of the first calls code of Python's that does not end. No
// tp_dealloc begins while a termination is pending: the second is not destroyed. argv: the directory of the libraries.
import { dlopen } from "bun:ffi";

const [libraries] = process.argv.slice(2);
const { count_events } = dlopen(`${libraries}/liblifecycle.so`, { count_events: { returns: "int" } }).symbols;
const worker = new Worker(new URL("./terminated_worker.mjs", import.meta.url).href);
const closed = new Promise(resolve => worker.addEventListener("close", resolve));
worker.postMessage(libraries);
// The parent's, and the first's.
while (count_events() < 2) await new Promise(resolve => setImmediate(resolve));
console.log("begun when the worker is terminated:", count_events());
worker.terminate();
await closed;
console.log("begun in the end:", count_events());
