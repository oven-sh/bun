// Creates and drops `count` wasm linear memories the way `mode` says, with a forced full GC after every
// batch, and reports how much committed memory the process kept per dropped memory.
import { memoryUsage } from "bun:jsc";

const [mode = "memory", countArg = "600"] = process.argv.slice(2);
const count = Number(countArg);
const batch = 100;

// (module (memory 1))
const moduleWithMemory = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 0, 1]));

async function create(n) {
  for (let i = 0; i < n; i++) {
    if (mode === "memory") new WebAssembly.Memory({ initial: 1, maximum: 4 });
    else if (mode === "instance") new WebAssembly.Instance(moduleWithMemory);
    else if (mode === "instantiate") await WebAssembly.instantiate(moduleWithMemory);
    else throw new Error("unknown mode " + mode);
  }
}

async function settle() {
  for (let i = 0; i < 2; i++) {
    await new Promise(resolve => setImmediate(resolve));
    Bun.gc(true);
  }
}

// Warm up first so that one-time reservations are not counted.
await create(batch);
await settle();
const before = memoryUsage().currentCommit;

for (let done = 0; done < count; done += batch) {
  await create(batch);
  await settle();
}
await settle();
const after = memoryUsage().currentCommit;

console.log(JSON.stringify({ mode, count, perMemoryKiB: (after - before) / 1024 / count }));
