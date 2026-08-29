// Runnable ESM corpus for bundler_bytecode_portable.test.ts (`bun build --compile --format=esm --bytecode`): a module
// program code block with top-level await, live bindings imported from a second module, import.meta, and a Worker whose
// entry point is a third embedded module decoded from the same bytecode on another thread.
import Dep, { count, tally } from "./dep.js";
export const fromMain = await Promise.resolve("main");
tally(3);
const worker = new Worker("./worker");
const fromWorker = await new Promise((resolve, reject) => {
  worker.onmessage = event => resolve(event.data);
  worker.onerror = event => reject(event);
});
worker.terminate();
console.log(JSON.stringify([fromMain, count, Dep.make(), fromWorker, import.meta.main, typeof import.meta.url]));
