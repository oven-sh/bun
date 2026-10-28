// A module that the program imports is compiled when the program is built: no function of it is interpreted.
/// <reference path="../wasm-files.d.ts" />
import path from "./module.wasm";

function outcomeOf(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    const kind = error instanceof WebAssembly.RuntimeError ? "WebAssembly.RuntimeError" : (error as Error).name;
    const message = (error as Error).message;
    const hint = message.indexOf(" (evaluating");
    return kind + ": " + (hint < 0 ? message : message.slice(0, hint));
  }
}

const instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer())), {});
const add = instance.exports.add as (a: number, b: number) => number;
console.log(add(2, 3), add(-1, 1), add(2147483647, 1), add(1.9, 2.9));
let sum = 0;
for (let i = 0; i < 100000; i++) sum = add(sum, i);
console.log(sum);
