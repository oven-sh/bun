// A closed read of `size` asks a stub of its own first: a Map or a Set that finds the built-in's getter, because it is as its class made it or its structure is kept, is answered out of its table.
// Each case has receivers that are no such table, or takes the getter away in another way.
import { buildBothWays } from "./build-both-ways";

buildBothWays("compile/aot/the size of a Map or a Set read closed", {
  "tables as made, tables of classes below, and what is no table": {
    alone: true,
    files: {
      "main.ts": `class Tracked extends Map<unknown, unknown> { tag = 1; }
class Bag extends Set<unknown> { tag = 2; }
const madeEmpty = [new Map(), new Set(), new Tracked(), new Bag()] as const; madeEmpty[0].set(1, 1); madeEmpty[1].add(1); madeEmpty[1].add(2); madeEmpty[2].set(1, 1); madeEmpty[3].add(1);
const things: any[] = [...madeEmpty, new Map(), new Set(), new Map([[1, 2]]), new Set([1, 2, 3]), new Tracked([[1, 1], [2, 2]]), new Bag([5]), { size: "own" }, [1, 2], "text", 7, new WeakMap(), new WeakSet(), Object.create(null), () => 1, Symbol.iterator, true];
function sizeOf(thing: any) { return thing.size; }
let out = "";
for (let turn = 0; turn < 400; turn++) for (const thing of things) { const size = sizeOf(thing); if (turn === 0 || turn === 399) out += String(size) + " "; }
console.log(out);
`,
    },
    prints:
      "1 2 1 1 0 0 1 3 2 1 own undefined undefined undefined undefined undefined undefined undefined undefined undefined 1 2 1 1 0 0 1 3 2 1 own undefined undefined undefined undefined undefined undefined undefined undefined undefined \n",
  },
  "the name is laid on the prototype of the class below, and taken off again": {
    alone: true,
    files: {
      "main.ts": `class Tracked extends Set<unknown> { tag = 1; }
const all = [new Tracked([1, 2]), new Tracked([3])];
function sum() { let total = 0; for (const one of all) total += (one as any).size; return total; }
let out = "";
function phase() { let total = 0; for (let turn = 0; turn < 300; turn++) total += sum(); out += total + " "; }
phase();
Object.defineProperty(Tracked.prototype, "size", { configurable: true, get() { return 100; } }); phase();
delete (Tracked.prototype as any).size; phase();
Object.defineProperty(Tracked.prototype, "size", { configurable: true, writable: true, value: 7 }); phase();
delete (Tracked.prototype as any).size; phase();
console.log(out);
`,
    },
    prints: "900 60000 900 4200 900 \n",
  },
  "the chain is relinked": {
    alone: true,
    files: {
      "main.ts": `class Tracked extends Map<unknown, unknown> { tag = 1; }
const one = new Tracked([[1, 1]]); const other = new Map([[1, 1], [2, 2]]);
function read(thing: any) { return thing.size; }
let out = "";
function phase() { let a: any = 0, b: any = 0; for (let turn = 0; turn < 300; turn++) { a = read(one); b = read(other); } out += a + "," + b + " "; }
phase();
const between = Object.create(Map.prototype, { size: { configurable: true, get() { return "between"; } } });
Object.setPrototypeOf(Tracked.prototype, between); phase();
Object.setPrototypeOf(Tracked.prototype, Map.prototype); phase();
Object.setPrototypeOf(one, { size: "elsewhere" }); Object.setPrototypeOf(other, null); phase();
Object.setPrototypeOf(one, Tracked.prototype); Object.setPrototypeOf(other, Map.prototype); phase();
console.log(out);
`,
    },
    prints: "1,2 between,2 1,2 elsewhere,undefined 1,2 \n",
  },
  "an own property hides the getter": {
    alone: true,
    files: {
      "main.ts": `class Tracked extends Map<number, number> { tag = 1; }
class Bag extends Set<number> { tag = 2; }
const map: any = new Map(); const below: any = new Tracked(); const set: any = new Set(); const bag: any = new Bag();
const things: any[] = [map, below, set, bag, { size: 1 }, "x"];
function read(thing: any) { return thing.size; }
let last: any;
function sweep() { for (let turn = 0; turn < 300; turn++) for (const thing of things) last = read(thing); return read(map) + "," + read(below) + "," + read(set) + "," + read(bag); }
console.log(sweep());
Object.defineProperty(map, "size", { value: "own", configurable: true }); Object.defineProperty(below, "size", { get() { return "getter"; }, configurable: true });
Object.defineProperty(set, "size", { get() { return "getter"; }, configurable: true }); Object.defineProperty(bag, "size", { value: "own", configurable: true });
console.log(sweep());
delete map.size; delete below.size; delete set.size; delete bag.size;
console.log(sweep());
`,
    },
    prints: "0,0,0,0\nown,getter,getter,own\n0,0,0,0\n",
  },
});
