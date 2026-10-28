// Vectors of 128 bits, with constants.
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

const e = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer())), {}).exports as any;
const words = new Int32Array(e.memory.buffer, 0, 8);
for (let i = 0; i < 8; i++) words[i] = (i + 1) * 1000;
e.add(0, 16);
console.log(words.join());
console.log(e.last(0), e.last(16), outcomeOf(() => e.last(65521)));
