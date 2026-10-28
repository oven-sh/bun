// Each of forty live instances has its own memory, more than plain Bun's limit on fast memories: compiled code runs with every one.
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

const module = new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()));
const memories: WebAssembly.Memory[] = [];
const instances: WebAssembly.Instance[] = [];
for (let i = 0; i < 40; i++) {
  memories.push(new WebAssembly.Memory({ initial: 1, maximum: 2 }));
  instances.push(new WebAssembly.Instance(module, { env: { memory: memories[i] } }));
}
let sum = 0;
for (let i = 0; i < instances.length; i++) sum += (instances[i].exports.poke as (at: number, value: number) => number)(i * 4, i * 10);
console.log(sum);
console.log(memories.map((memory, i) => new Int32Array(memory.buffer)[i]).join());
console.log(outcomeOf(() => (instances[39].exports.poke as (at: number, value: number) => number)(65536, 1)));
