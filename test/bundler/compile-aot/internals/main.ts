import { use } from "./use.ts";
const url = new URL("./worker.ts", import.meta.url).href;
const run = (seed: number) => new Promise<string[]>((resolve, reject) => { const w = new Worker(url); w.onmessage = e => { resolve(e.data); w.terminate(); }; w.onerror = e => reject(new Error("worker: " + (e as any).message)); w.postMessage(seed); });
const print = (name: string, lines: string[]) => { for (const l of lines) console.log(name, l); };
print("main", await use(1));
if (process.argv[2] !== "main") {
  print("one", await run(2));
  const many = await Promise.all([run(3), run(4), run(5), use(6)]); many.forEach((r, i) => print("many" + i, r));
  for (let i = 0; i < 4; i++) { const r = await run(10 + i); if (i === 3) print("serial", r); }
}
print("again", await use(7));
