// Reads, stores and `in` by computed keys and by names on objects of many short-lived shapes, with collections of the young in between: what the engine remembers about a shape or a key that has died is never taken for a new one.
const shell = globalThis as any;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());
type Bag = Record<string, unknown>;
function shape(seed: number, width: number): Bag {
  const o: Bag = {};
  for (let i = 0; i < width; i++) o["p" + ((seed + i) % 23) + "_" + (seed % 5)] = seed + i;
  return o;
}
function readAll(o: Bag, keys: string[]): number {
  let t = 0;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number") t += v;
    if (k in o) t += 1;
    if (Object.hasOwn(o, k)) t += 2;
  }
  return t;
}
const symbols = [Symbol("a"), Symbol("b"), Symbol("c")];
class Base {
  get viaGetter(): number {
    return 5;
  }
  inherited = 3;
}
const longLived: Bag[] = [];
for (let i = 0; i < 40; i++) longLived.push(shape(i, 1 + (i % 9)));
let total = 0;
const lines: string[] = [];
for (let round = 0; round < 30; round++) {
  const keys: string[] = [];
  for (let i = 0; i < 23; i++) keys.push("p" + i + "_" + (round % 5));
  for (let i = 0; i < 300; i++) {
    const o = shape(round * 31 + i, 1 + (i % 12));
    total += readAll(o, keys);
    o["extra" + (i % 7)] = i;
    (o as Record<symbol, unknown>)[symbols[i % 3]] = i;
    total += (o as Record<symbol, number>)[symbols[i % 3]];
    const b = new Base() as unknown as Bag;
    b["own" + (i % 4)] = i;
    total += (b["viaGetter"] as number) + (b["inherited"] as number) + ("missing" + (i % 3) in b ? 100 : 0);
    if (i % 50 === 0) delete o[keys[i % keys.length]];
  }
  for (const o of longLived) total += readAll(o, keys);
  collect(round % 9 === 8);
  for (const o of longLived) total += readAll(o, keys);
  if (round % 3 === 0) collect(false);
  lines.push(round + " " + total);
}
console.log(lines.join("\n"));
