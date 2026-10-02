import { work } from "./work.ts";
const url = new URL("./worker.ts", import.meta.url).href;
const run = (seed: number, rounds: number, gc: boolean) => new Promise<string[]>((resolve, reject) => { const w = new Worker(url); w.onmessage = e => { resolve(e.data); w.terminate(); }; w.onerror = e => reject(new Error("worker: " + (e as any).message)); w.postMessage({ seed, rounds, gc }); });
const print = (name: string, lines: string[]) => { for (const l of lines) console.log(name, l); };
const mode = process.argv[2] || "all";
print("main-before", await work(1));
if (mode !== "main") {
  print("one", await run(10, 2, false));
  const many = [run(20, 6, true), run(30, 6, false), run(40, 6, true), run(50, 6, false)];
  const mine: string[][] = []; for (let i = 0; i < 6; i++) { mine.push(await work(100 + i)); Bun.gc(true); }
  const results = await Promise.all(many); results.forEach((r, i) => print("many" + i, r)); print("main-during", mine[5]!);
  for (let i = 0; i < 12; i++) { const r = await run(60 + i, 1, i % 2 === 0); if (i === 11) print("serial", r); }
}
print("main-after", await work(2));
