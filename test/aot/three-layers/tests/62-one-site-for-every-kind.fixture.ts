// One place for each operation, in the test file, in the files between and in a package, and objects of every kind and of every program come to it, often enough that its caches
// answer: fields that the layout has and the object not yet, classes over classes of other programs, accessors, objects that take no more. First come values that are no objects,
// then values of every kind, fitting the field or not. Each kind prints a digest of all that was seen. What one program remembers about an object of another must not be read in its own
// numbers: with one such hole open this ends in a fault, wherever the places are.
import { expect, test } from "bun:test";
import * as pkg from "one-site";
// The same places, in the program of the test file.
const get = (o: any, k: any) => o[k];
const set = (o: any, k: any, v: any) => { o[k] = v; return o; };
const del = (o: any, k: any) => delete o[k];
const has = (o: any, k: any) => k in o;
const own = (o: any, k: any) => Object.prototype.hasOwnProperty.call(o, k);
const define = (o: any, k: any, v: any) => Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true });
const keys = (o: any) => Object.keys(o).join(",");
const forIn = (o: any) => { let s = ""; for (const k in o) s += k + ";"; return s; };
const assign = (o: any, s: any) => Object.assign(o, s);
const spread = (o: any) => ({ ...o });
const rest = (o: any) => { const { a, ...others } = o; return others; };
const call = (o: any, k: any, ...args: any[]) => o[k](...args);
const bump = (o: any, k: any) => { o[k]++; return o[k]; };
const add = (o: any, k: any, v: any) => { o[k] += v; return o[k]; };
const orSet = (o: any, k: any, v: any) => (o[k] ??= v);
const named = (o: any) => [o.a, o.b, o.name, o.level, o.extra, o.missing];
const setNamed = (o: any, v: any) => { o.a = v; o.extra = v; o.name = "n" + v; return o; };
import * as between from "../src/places";
const here = { get, set, del, has, own, define, keys, forIn, assign, spread, rest, call, bump, add, orSet, named, setNamed };
type Places = typeof here;
import { Derived, Plain, srcMakers } from "../src/kinds";
class Mine extends Derived { mine = "m"; extra?: number; describe() { return "m:" + super.describe(); } }
class Alone { a = 9; b?: string; name = "alone"; level?: number; }
class OnPackage extends pkg.Base { a = 4; name?: string; }
function minePartly(i: number) {
  const o: { a: number; b?: string; name?: string; level?: number; extra?: unknown } = { a: i };
  if (i < 0) { o.extra = 1; o.b = "x"; o.level = 1; o.name = "n"; }
  return o;
}
const myMakers: ((i: number) => any)[] = [
  i => minePartly(i),
  i => ({ a: i, b: "t" + i }),
  i => ({ a: i, name: "test", level: i }),
  i => new Mine(),
  i => new Alone(),
  i => new OnPackage(),
  i => new Plain(),
  i => pkg.theirLiteral(i),
  i => ({ a: i, extra: { deep: i } }),
];
const say = (f: () => unknown) => { try { const v = f(); return typeof v === "function" ? "a function" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v); } catch (e) { return "throws " + (e as Error).constructor.name; } };
function digest(text: string, h: number) { for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0; return h; }
const names = ["a", "b", "name", "level", "extra", "list", "inner", "own", "mine", "base", "tag", "twice", "added", "k1", "0", "describe"];
for (const [where, ops] of [["here", here], ["between", between as Places], ["in a package", pkg as unknown as Places]] as const) test("one place " + where + " for objects of every program", () => {
  const rounds = 100;
  const makers = [...srcMakers, ...myMakers];
  const lines: string[] = [];
  for (let m = 0; m < makers.length; m++) {
    let h = 7;
    for (let i = 0; i < rounds; i++) {
      const o = makers[m](i);
      const k = names[i % names.length], k2 = names[(i * 5 + 3) % names.length];
      // What is no object first, for whoever remembers that; then values of every kind, fitting the field or not.
      const values: unknown[] = i < 40 ? [null, i, "s" + i, undefined, true, i + 0.5] : [{ x: i }, { y: i }, null, [i], i, "s", { x: i, y: 1 }, undefined, makers[(m + 3) % makers.length](i), 1.5, () => i];
      const v = values[(i * 3 + m) % values.length], v2 = values[(i + 1) % values.length];
      const seen = [
        say(() => ops.get(o, k)), say(() => ops.has(o, k)), say(() => ops.own(o, k2)), say(() => ops.named(o)),
        say(() => ops.set(o, k, v)), say(() => ops.keys(o)), say(() => ops.orSet(o, k2, v2)), say(() => ops.forIn(o)),
        say(() => ops.del(o, k2)), say(() => ops.keys(o)), say(() => ops.set(o, k2, v)), say(() => ops.bump(o, "a")),
        say(() => ops.add(o, "level", 2)), say(() => ops.define(o, k, v2)), say(() => ops.setNamed(o, v)), say(() => ops.spread(o)),
        say(() => ops.rest(o)), say(() => ops.assign(o, makers[(m + i) % makers.length](i))), say(() => ops.call(o, "describe")), say(() => ops.keys(o)),
        say(() => ops.assign({}, o)), say(() => ops.get(o, "twice")), say(() => ops.set(o, "twice", 8)), say(() => JSON.stringify(o)),
      ];
      const fresh = makers[m](i);
      for (const name of ["inner", "level", "b", "name", "extra", "list"]) seen.push(say(() => ops.set(fresh, name, values[(i + name.length) % values.length])));
      seen.push(say(() => JSON.stringify(fresh)), say(() => ops.keys(fresh)));
      h = digest(seen.join("|"), h);
      if (i % 71 === 70) Bun.gc(true);
    }
    lines.push("RESULT|62|kind " + m + ", the places " + where + "|" + h + "|-");
  }
  console.log(lines.join("\n"));
  expect(lines.length).toBe(makers.length);
}, 60_000);
