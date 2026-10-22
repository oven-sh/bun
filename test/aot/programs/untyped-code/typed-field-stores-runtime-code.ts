// Code made at run time stores to a declared field of a typed object, many times at one place, so that what the interpreter remembers of the field is used: what the field's type takes and what it does not.
import type { int32 } from "bun";
declare const gc: undefined | (() => void);
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
interface Kinds {
  whole: number;
  fraction: number;
  small: int32;
  flag: boolean;
  text: string;
  anything: unknown;
  maybe?: number;
  textOrNull: string | null;
}
class Point {
  constructor(
    public x: number,
    public y: number,
    public label: string,
  ) {}
  sum(): number {
    return this.x + this.y;
  }
}
const make = (): Kinds => ({ whole: 1, fraction: 1.5, small: 2, flag: true, text: "t", anything: 1, textOrNull: null });
const say = (v: unknown): unknown => (v === undefined ? "undefined" : typeof v === "number" ? (v !== v ? "NaN" : Object.is(v, -0) ? "-0" : !isFinite(v) ? String(v) : v) : typeof v === "symbol" ? "symbol" : typeof v === "bigint" ? v + "n" : typeof v === "function" ? "function" : v);
const show = (v: unknown) => JSON.stringify(v, (_k, x) => say(x));
const typedRead = (k: Kinds): unknown[] => [k.whole, k.fraction, k.small, k.flag, k.text, k.anything, k.maybe, k.textOrNull];
const writers: Record<string, (o: unknown, v: unknown) => unknown> = {};
for (const name of ["whole", "fraction", "small", "flag", "text", "anything", "maybe", "textOrNull", "x", "y", "label"]) writers[name] = new Function("o", "v", "o." + name + " = v; return o." + name + ";") as (o: unknown, v: unknown) => unknown;
const loops: Record<string, (o: unknown, values: unknown[], turns: number) => void> = {};
for (const name of ["whole", "fraction", "small", "flag", "text", "anything", "x", "label"]) loops[name] = new Function("o", "values", "turns", "for (let i = 0; i < turns; i++) o." + name + " = values[i & 3];") as (o: unknown, values: unknown[], turns: number) => void;

function measure(label: string, run: () => unknown) {
  const result = run();
  console.log(label + ":", show(result));
}
const one = make();
measure("whole numbers", () => (loops.whole(one, [1, 2, 3, 4], 500), one.whole));
measure("fractions and whole numbers in a field that began with a fraction", () => (loops.fraction(one, [0.5, 2, -3.25, 4], 500), one.fraction));
measure("32-bit integers", () => (loops.small(one, [1, -2, 2147483647, -2147483648], 500), one.small));
measure("booleans", () => (loops.flag(one, [true, false, false, true], 500), one.flag));
measure("strings", () => (loops.text(one, ["a", "bb", "", "dddd"], 500), one.text));
measure("whatever comes, in a field of type unknown", () => (loops.anything(one, [1, "two", null, { three: 3 }], 500), one.anything));
const point = new Point(1, 2, "p");
measure("fields of an instance of a class", () => (loops.x(point, [5, 6, 7, 8], 500), loops.label(point, ["a", "b", "c", "d"], 500), [point.sum(), point.label]));

const numbers = [0, -0, 1, -1, 0.5, NaN, Infinity, -Infinity, 1073741823, 1073741824, -1073741824, -1073741825, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 9007199254740991, 1e300, 5e-324];
for (const name of ["whole", "fraction", "anything"]) {
  const k = make();
  console.log("numbers at the edges, " + name + ":", show(numbers.map(n => [writers[name](k, n), (k as unknown as Record<string, unknown>)[name]])));
  console.log("  and back to a small one:", show([writers[name](k, 7), typedRead(k)]));
}
{
  const k = make();
  console.log("32-bit integers at the edges:", show([0, -1, 2147483647, -2147483648, 1073741824, -1073741825].map(n => [writers.small(k, n), k.small])));
  console.log("every field in turn, twelve times:", show(Array.from({ length: 12 }, (_, i) => (writers.whole(k, i), writers.fraction(k, i / 2), writers.small(k, 0 - i), writers.flag(k, !(i & 1)), writers.text(k, "t" + i), writers.anything(k, i & 1 ? "s" + i : i), typedRead(k)))[11]));
  console.log("an optional field comes, changes and goes:", show([typedRead(k)[6], writers.maybe(k, 1), writers.maybe(k, 2.5), k.maybe, delete k.maybe, k.maybe, writers.maybe(k, 3), k.maybe]));
  console.log("a string or null:", show(["a", null, "b", null, "c"].map(v => [writers.textOrNull(k, v), k.textOrNull])));
  console.log("the keys stay in their order:", Object.keys(k).join());
}
{
  const several: unknown[] = [make(), new Point(1, 2, "p"), JSON.parse('{"x":1,"whole":1}'), make(), { whole: "text", x: null }];
  console.log("objects of several kinds at one place:", show([0, 1, 2, 3, 4, 0, 1, 2, 3, 4].map(i => [writers.whole(several[i], i), writers.x(several[i], -i)])), show(several));
}
{
  const k = make();
  for (let i = 0; i < 20; i++) writers.whole(k, i), writers.text(k, "t" + i), writers.flag(k, false), writers.anything(k, i);
  Object.freeze(k);
  console.log("a frozen object takes nothing:", show([writers.whole(k, 99), writers.text(k, "no"), writers.flag(k, true), writers.anything(k, "no"), typedRead(k)]));
  const strict = new Function("o", "v", "'use strict'; o.whole = v;");
  const other = make();
  for (let i = 0; i < 20; i++) strict(other, i);
  let thrown = "nothing";
  try {
    strict(k, 1);
  } catch (e) {
    thrown = (e as Error).name;
  }
  console.log("and strict code is told:", thrown, other.whole);
  const sealed = Object.seal(make());
  console.log("a sealed one takes what it has fields for:", show([writers.whole(sealed, 5), writers.text(sealed, "s"), typedRead(sealed)]));
}
{
  const old = Array.from({ length: 50 }, make);
  const points = Array.from({ length: 50 }, (_, i) => new Point(i, i, "p"));
  collect();
  collect();
  for (let turn = 0; turn < 6; turn++) {
    for (let i = 0; i < 50; i++) {
      writers.text(old[i], "young " + turn + " " + i);
      writers.anything(old[i], { turn, i, list: [turn, i] });
      writers.label(points[i], "label " + turn + " " + i);
    }
    for (let i = 0; i < 2000; i++) [i, "garbage " + i];
    collect();
  }
  console.log("old objects keep young values:", old.every((k, i) => k.text === "young 5 " + i && show(k.anything) === show({ turn: 5, i, list: [5, i] })), points.every((p, i) => p.label === "label 5 " + i));
}
