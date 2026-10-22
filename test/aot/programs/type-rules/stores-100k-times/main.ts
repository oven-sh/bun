// Every kind of store of a value of another kind than the field holds runs 100,000 times and the results are counted. Each store from JavaScript, through `any` or by reflection succeeds; only an argument for a parameter with a written type throws. The result is the same whichever function the store is inlined into.
import { rows, setByKey, setSize } from "./sloppy.cjs";
class Box { #own = 0; label = "b"; size = 1; }
function count(f: (i: number) => unknown): string { const seen: Record<string, number> = {}; for (let i = 0; i < 100000; i++) { let said: string; try { said = String(f(i)); } catch (e) { said = (e as Error).name; } seen[said] = (seen[said] || 0) + 1; } return JSON.stringify(seen); }
function throughAny(o: Box, v: unknown): string { (o as any).size = v; return "stored"; }
function typedStore(o: Box, v: number): string { o.size = v; return "stored"; }
for (const line of rows({ throughAny, typedStore, box: () => new Box() })) console.log(line);
const typed: [string, (i: number) => unknown][] = [
  ["TypeScript calls a small function of JavaScript that stores", i => setSize(new Box(), i % 1000 === 999 ? "big" : i)],
  ["TypeScript calls a small function of JavaScript that stores by key", i => setByKey(new Box(), i & 1 ? "size" : "label", i & 1 ? "big" : 5)],
  ["TypeScript: Object.assign from any", i => { Object.assign(new Box(), (i % 1000 === 999 ? { size: "big" } : { size: i }) as any); return "stored"; }],
  ["TypeScript: Reflect.set", () => Reflect.set(new Box(), "size", "big")],
  ["TypeScript: through any", i => throughAny(new Box(), i % 1000 === 999 ? "big" : i)],
  ["TypeScript: through any by key", i => { (new Box() as any)[i & 1 ? "size" : "label"] = i & 1 ? "big" : 5; return "stored"; }],
  ["TypeScript: its own store", i => typedStore(new Box(), i)],
];
for (const [name, f] of typed) console.log(name + ": " + count(f));
