// One store site in evaluated text stores into an object many times: values that the field's slot takes, and values that it does not.
class Base { set watched(v: unknown) { log.push("setter " + String(v)); } get watched() { return "getter"; } }
class Item extends Base {
  whole: number = 1; fraction: number = 1.5; flag: boolean = true; text: string = "text"; literal: "a" | "b" = "a"; link: Item | null = null; maybe?: number; maybeText?: string; maybeFlag?: boolean;
  anything: unknown = 1; either: number | string = 1; nothing: undefined | number = undefined; list: number[] = [1]; call: () => number = () => 1; guessed = 1; guessedText = "guessed";
}
const log: string[] = [];
function hide(value: unknown): any { return value; }
const say = (v: unknown): string => v === undefined ? "undefined" : typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : typeof v === "function" ? "function" : typeof v === "object" && v !== null ? (Array.isArray(v) ? "array" : "object") : typeof v === "symbol" ? "symbol" : typeof v === "bigint" ? v + "n" : JSON.stringify(v);
const writers = new Map<string, (o: unknown, v: unknown) => void>();
function store(name: string, o: unknown, v: unknown, mode: "strict" | "sloppy" = "strict"): string {
  const key = mode + " " + name;
  let writer = writers.get(key);
  if (!writer) writers.set(key, writer = new Function("o", "v", `${mode === "strict" ? '"use strict";' : ""} for (let i = 0; i < 5; i++) o.${name} = v;`) as (o: unknown, v: unknown) => void);
  try { writer(o, v); return say(hide(o)[name]); } catch (e) { return "THROWN " + (e as Error).name + " " + say(hide(o)?.[name]); }
}
let line = 0;
function show(title: string, ...values: string[]) { console.log(String(++line).padStart(2, "0"), title + ":", values.join(" | ")); }
const keysOf = (o: object) => Object.keys(o).join();
const rope = (a: string, b: string) => a + b;
const values: unknown[] = [0, 1, -1, -0, 0.5, NaN, Infinity, 2147483647, 2147483648, -2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, 1e21, true, false, undefined, null, "", "a", "b", "other", rope("long text that is ", "a rope until it is read"), Symbol.iterator, 1n, {}, [], () => 2];
const fields = ["whole", "fraction", "flag", "text", "literal", "link", "maybe", "maybeText", "maybeFlag", "anything", "either", "nothing", "list", "call", "guessed", "guessedText"];

for (const field of fields) {
  const item = new Item();
  show("into " + field, ...values.map(v => store(field, item, v)));
  show("keys afterwards", keysOf(item));
}
for (const field of fields) {
  // A value of the field's own type again after one of another type.
  const item = new Item(), first = hide(item)[field];
  show("back to the type of " + field, store(field, item, Symbol.iterator), store(field, item, first), store(field, item, first === undefined ? 3 : first));
}
{
  const item = new Item();
  store("whole", item, 5); store("fraction", item, 2.25); store("flag", item, false); store("text", item, "stored"); store("link", item, item); store("maybe", item, 7); store("either", item, "s"); store("nothing", item, 1);
  // Compiled code reads what the text stored.
  show("read by compiled code", String(item.whole + 1), String(item.fraction * 2), String(!item.flag), item.text.toUpperCase(), String(item.link === item), String((item.maybe ?? 0) + 1), String(item.either), String(item.nothing));
  show("keys", keysOf(item), JSON.stringify(item, (k, v) => k === "link" ? undefined : typeof v === "function" ? "function" : v));
}
{
  const item = new Item();
  show("absent fields are created in the order of the stores", store("maybeFlag", item, true), store("maybe", item, 1), store("maybeText", item, "t"), keysOf(item));
  delete item.maybe; delete hide(item).whole;
  show("deleted and created again", store("whole", item, 2), store("maybe", item, 2), keysOf(item));
  show("names that are no fields", store("extra", item, 1), store("extra", item, "two"), store("other", item, null), keysOf(item));
}
for (const mode of ["strict", "sloppy"] as const) {
  const frozen = Object.freeze(new Item()), sealed = Object.seal(new Item()), closed = Object.preventExtensions(new Item());
  show(mode + ": frozen", store("whole", frozen, 2, mode), store("maybe", frozen, 2, mode), store("extra", frozen, 2, mode), store("anything", frozen, {}, mode));
  show(mode + ": sealed", store("whole", sealed, 2, mode), store("maybe", sealed, 2, mode), store("extra", sealed, 2, mode), store("whole", sealed, "other type", mode));
  show(mode + ": not extensible", store("whole", closed, 2, mode), store("maybe", closed, 2, mode), store("extra", closed, 2, mode));
  const fixed = new Item();
  Object.defineProperty(fixed, "whole", { value: 1, writable: false, configurable: true, enumerable: true });
  Object.defineProperty(fixed, "text", { get() { return "only a getter"; }, configurable: true });
  show(mode + ": read-only and getter-only", store("whole", fixed, 2, mode), store("text", fixed, "x", mode));
  show(mode + ": no object", store("whole", 1, 2, mode), store("whole", "s", 2, mode), store("whole", undefined, 2, mode), store("whole", null, 2, mode));
}
{
  const item = new Item();
  show("a store site freezes midway", store("whole", item, 3), (Object.freeze(item), store("whole", item, 4)), store("whole", new Item(), 5));
}
{
  const item = new Item();
  show("a setter above", store("watched", item, 1), log.splice(0).join());
  hide(Item.prototype).maybe = "above";
  show("a value above an absent field", store("maybe", item, 2), String(Object.hasOwn(item, "maybe")));
  delete hide(Item.prototype).maybe;
  const second = new Item();
  Object.defineProperty(Item.prototype, "maybe", { set(v) { log.push("maybe setter " + v); }, get() { return "maybe getter"; }, configurable: true });
  show("a setter above an absent field", store("maybe", second, 3), String(Object.hasOwn(second, "maybe")), log.splice(0).join(), store("maybe", item, 4), String(log.length));
  delete hide(Item.prototype).maybe;
  Object.defineProperty(Item.prototype, "maybeText", { value: "read-only above", writable: false, configurable: true });
  show("a read-only value above an absent field", store("maybeText", second, "x"), store("maybeText", second, "x", "sloppy"), String(Object.hasOwn(second, "maybeText")));
  delete hide(Item.prototype).maybeText;
  show("nothing above again", store("maybe", second, 5), store("maybeText", second, "y"), keysOf(second));
}
{
  const item = new Item();
  Object.setPrototypeOf(item, new Proxy({}, { set(_t, key, v) { log.push("trap " + String(key) + " " + v); return true; } }));
  show("a proxy above", store("whole", item, 6), store("maybe", item, 6), store("extra", item, 6), log.splice(0).length + " traps");
}
{
  const shapes: unknown[] = [new Item(), { whole: 0 }, JSON.parse('{"whole":0}'), Object.create(new Item()), Object.freeze(new Item()), new Item()];
  const out: string[] = [];
  for (let round = 0; round < 3; round++) for (const shape of shapes) out.push(store("whole", shape, round, "sloppy"));
  show("many receivers at one site", ...out);
}
{
  // Old objects get young values, and a collection follows.
  const old: Item[] = []; for (let i = 0; i < 200; i++) old.push(new Item());
  Bun.gc(true);
  let total = 0;
  for (let round = 0; round < 20; round++) {
    for (let i = 0; i < old.length; i++) { store("link", old[i], new Item()); store("anything", old[i], { round, i }); store("text", old[i], "t" + round + i); store("list", old[i], [round, i]); }
    Bun.gc(round % 4 === 0);
    for (let i = 0; i < old.length; i++) total += old[i]!.link!.whole + hide(old[i]!.anything).i + old[i]!.text.length + old[i]!.list[1]!;
  }
  show("young values in old objects", String(total));
}
{
  const keyedStore = new Function("o", "key", "v", `"use strict"; for (let i = 0; i < 5; i++) o[key] = v;`) as (o: unknown, key: unknown, v: unknown) => void;
  const item = new Item(), sym = Symbol("s");
  for (const [key, v] of [["whole", 8], ["whole", "text"], ["maybe", 8], ["extra", 8], [sym, 8], [3, 8], ["4", 8], ["te" + "xt".slice(0), "keyed"]] as [PropertyKey, unknown][]) keyedStore(item, key, v);
  show("by a key", say(hide(item).whole), say(item.maybe), say(hide(item).extra), say(hide(item)[sym]), say(hide(item)[3]), say(hide(item)[4]), item.text, keysOf(item));
}
