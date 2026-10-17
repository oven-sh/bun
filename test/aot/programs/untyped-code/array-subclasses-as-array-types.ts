// A subclass of Array, or an array with another prototype, that overrides nothing works at type `T[]` as in plain Bun: every method and what it returns.
declare const console: { log(...values: unknown[]): void };
const out: string[] = [];
const hide = (v: unknown): any => v;
const show = (v: unknown): string => Array.isArray(v) ? (v as object).constructor.name + "[" + v.length + "]" + v.map(x => String(x)).join() : typeof v === "object" && v !== null && typeof hide(v).next === "function" ? "iterator " + [...hide(v)].join(";") : String(v);
const f = (x: string): boolean => x === "b";
const calls: [string, (xs: string[]) => unknown][] = [
    ["push", xs => xs.push("z")], ["pop", xs => xs.pop()], ["shift", xs => xs.shift()], ["unshift", xs => xs.unshift("z")],
    ["slice", xs => xs.slice(1)], ["splice", xs => xs.splice(0, 1)], ["concat", xs => xs.concat(["z"])], ["join", xs => xs.join("-")],
    ["indexOf", xs => xs.indexOf("b")], ["lastIndexOf", xs => xs.lastIndexOf("b")], ["includes", xs => xs.includes("b")],
    ["sort", xs => xs.sort()], ["reverse", xs => xs.reverse()], ["fill", xs => xs.fill("z")], ["at", xs => xs.at(0)],
    ["flat", xs => xs.flat()], ["flatMap", xs => xs.flatMap(x => [x])], ["map", xs => xs.map(x => x + "!")], ["filter", xs => xs.filter(f)],
    ["forEach", xs => { let s = ""; xs.forEach(x => { s += x; }); return s; }], ["some", xs => xs.some(f)], ["every", xs => xs.every(f)],
    ["find", xs => xs.find(f)], ["findIndex", xs => xs.findIndex(f)], ["findLast", xs => xs.findLast(f)], ["findLastIndex", xs => xs.findLastIndex(f)],
    ["reduce", xs => xs.reduce((a, x) => a + x, "")], ["reduceRight", xs => xs.reduceRight((a, x) => a + x, "")],
    ["keys", xs => xs.keys()], ["values", xs => xs.values()], ["entries", xs => xs.entries()], ["toString", xs => xs.toString()],
    ["copyWithin", xs => xs.copyWithin(0, 1)], ["toSorted", xs => xs.toSorted()], ["toReversed", xs => xs.toReversed()], ["toSpliced", xs => xs.toSpliced(0, 1)], ["with", xs => xs.with(0, "z")],
];
class Stack extends Array<string> { top(): string | undefined { return this[this.length - 1]; } }
class Result extends Array<string> { count = 0; static get [Symbol.species](): ArrayConstructor { return Array; } }
class ZeroArray extends Array<number> { constructor(size: number) { super(size); this.fill(0); } }
class Items extends Array<string> { add(x: string): void { this.push(x); } remove(i: number): void { this.splice(i, 1); } clear(): void { while (this.length) this.pop(); } }
const makers: [string, () => string[]][] = [
    ["plain", () => ["a", "b", "c"]],
    ["heir", () => hide(Stack.of("a", "b", "c"))],
    ["species", () => { const r = new Result(); r.push("a", "b", "c"); return hide(r); }],
    ["other prototype", () => hide(Object.setPrototypeOf(["a", "b", "c"], Object.create(Array.prototype)))],
    ["own property", () => hide(Object.assign(["a", "b", "c"], { extra: 1 }))],
    ["frozen", () => hide(Object.freeze(["a", "b", "c"]))],
];
for (const [name, call] of calls) out.push(name + ": " + makers.map(([how, make]) => { const xs = make(); let r: string; try { r = show(call(xs)); } catch (e) { r = (e as Error).name; } return how + " " + r + " -> " + show(xs); }).join(" | "));
{ const z = new ZeroArray(3); const items = new Items(); items.add("a"); items.add("b"); items.remove(0); const held = show(items); items.clear(); out.push("as the packages do: " + show(z) + " " + held + " " + show(items) + " " + new Stack("a", "b").top()); }
console.log(out.join("\n"));
