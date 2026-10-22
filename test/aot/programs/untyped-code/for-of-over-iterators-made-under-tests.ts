// `for (.. of x.values())`, `keys()` and `entries()` where nothing proves that `x` still has the methods of its class: the collections that do, next to the ones whose method is another function.
const lines: string[] = [];
const hidden = JSON.parse('{"yes":true,"no":false,"two":2,"pairs":[["a",1],["b",2],["c",3],["d",4]],"list":[10,20,30,40]}');

function mapValues(m: Map<string, number>): string { let t = ""; for (const v of m.values()) t += v + ","; return t; }
function mapKeys(m: Map<string, number>): string { let t = ""; for (const k of m.keys()) t += k + ","; return t; }
function mapEntries(m: Map<string, number>): string { let t = ""; for (const [k, v] of m.entries()) t += k + "=" + v + ","; return t; }
function setValues(s: Set<number>): string { let t = ""; for (const v of s.values()) t += v + ","; return t; }
function setKeys(s: Set<number>): string { let t = ""; for (const v of s.keys()) t += v + ","; return t; }
function setEntries(s: Set<number>): string { let t = ""; for (const [a, b] of s.entries()) t += a + "=" + b + ","; return t; }
function arrayValues(a: number[]): string { let t = ""; for (const v of a.values()) t += v + ","; return t; }
function arrayKeys(a: number[]): string { let t = ""; for (const i of a.keys()) t += i + ","; return t; }
function arrayEntries(a: number[]): string { let t = ""; for (const [i, v] of a.entries()) t += i + "=" + v + ","; return t; }
function bytesValues(a: Uint8Array): string { let t = ""; for (const v of a.values()) t += v + ","; return t; }
function bytesEntries(a: Uint8Array): string { let t = ""; for (const [i, v] of a.entries()) t += i + "=" + v + ","; return t; }
function anyValues(x: any): string { let t = ""; for (const v of x.values()) t += String(v) + ","; return t; }
function anyKeys(x: any): string { let t = ""; for (const v of x.keys()) t += String(v) + ","; return t; }
function anyEntries(x: any): string { let t = ""; for (const [k, v] of x.entries()) t += String(k) + "=" + String(v) + ","; return t; }

const newMap = () => new Map<string, number>(hidden.pairs);
const newSet = () => new Set<number>(hidden.list);
const newList = (): number[] => hidden.list.slice();
const newBytes = () => new Uint8Array(hidden.list);

function tell(name: string, run: () => string) {
  let outcome: string;
  try {
    outcome = run();
  } catch (error: any) {
    outcome = error.constructor.name;
  }
  lines.push(name + " " + outcome);
}

function tellAll(name: string, make: () => any, typed: ((x: any) => string)[]) {
  for (const f of [...typed, anyValues, anyKeys, anyEntries]) tell(name + " " + f.name, () => f(make()));
}

const ofMaps = [mapValues, mapKeys, mapEntries];
const ofSets = [setValues, setKeys, setEntries];
const ofArrays = [arrayValues, arrayKeys, arrayEntries];
const ofBytes = [bytesValues, bytesEntries];

tellAll("map", newMap, ofMaps);
tellAll("set", newSet, ofSets);
tellAll("array", newList, ofArrays);
tellAll("bytes", newBytes, ofBytes);
tellAll("empty map", () => new Map(), ofMaps);
tellAll("empty set", () => new Set(), ofSets);
tellAll("empty array", () => [], ofArrays);
tellAll("array with a hole", () => [1, , 3], ofArrays);

function* countdown() { yield [3, "three"]; yield [2, "two"]; yield [1, "one"]; }
const shadowed = (x: any, method: any) => { x.values = method; x.keys = method; x.entries = method; return x; };
tellAll("map with own methods", () => shadowed(newMap(), countdown), ofMaps);
tellAll("set with own methods", () => shadowed(newSet(), countdown), ofSets);
tellAll("array with own methods", () => shadowed(newList(), countdown), ofArrays);
tellAll("bytes with own methods", () => shadowed(newBytes(), countdown), ofBytes);
tellAll("map whose methods answer an array", () => shadowed(newMap(), () => [["x", 7], ["y", 8]]), ofMaps);
tellAll("map whose methods answer another map's entries", () => shadowed(newMap(), () => new Map([["other", 9]]).entries()), ofMaps);
tellAll("map whose methods answer no iterable", () => shadowed(newMap(), () => 5), ofMaps);
tellAll("map whose methods are no functions", () => shadowed(newMap(), 5), ofMaps);
tellAll("map whose methods throw", () => shadowed(newMap(), () => { throw new RangeError("no"); }), ofMaps);
tellAll("map whose methods are the set's", () => { const m: any = newMap(); m.values = Set.prototype.values; m.keys = Set.prototype.keys; m.entries = Set.prototype.entries; return m; }, ofMaps);
tellAll("map whose values are its keys", () => { const m: any = newMap(); m.values = Map.prototype.keys; m.keys = Map.prototype.values; return m; }, ofMaps);
tellAll("map with its own methods again", () => { const m: any = newMap(); m.values = Map.prototype.values; m.keys = Map.prototype.keys; m.entries = Map.prototype.entries; return m; }, ofMaps);
tellAll("map with an accessor", () => Object.defineProperty(newMap(), "values", { get() { lines.push("  the accessor ran"); return Map.prototype.values; } }), ofMaps);

class Doubled extends Map<string, number> {
  *values(): any { for (const [, v] of this) yield v * hidden.two; }
}
class Reversed extends Array<number> {
  *entries(): any { for (let i = this.length - 1; i >= 0; i--) yield [i, this[i]]; }
}
class Quiet extends Set<number> {
  *[Symbol.iterator](): any { yield -1; }
}
class Plain extends Map<string, number> {}
tellAll("subclass with its own values", () => new Doubled(hidden.pairs), ofMaps);
tellAll("subclass with its own entries", () => Reversed.from(hidden.list), ofArrays);
tellAll("subclass with its own @@iterator", () => new Quiet(hidden.list), ofSets);
tellAll("subclass with nothing of its own", () => new Plain(hidden.pairs), ofMaps);
tellAll("map with another prototype", () => Object.setPrototypeOf(newMap(), { values: countdown, keys: countdown, entries: countdown }), ofMaps);
tellAll("map without a prototype", () => Object.setPrototypeOf(newMap(), null), ofMaps);
tellAll("array-like", () => ({ length: 2, 0: "p", 1: "q", values: Array.prototype.values, keys: Array.prototype.keys, entries: Array.prototype.entries }), []);
tellAll("nothing", () => undefined, ofMaps);
tellAll("null", () => null, ofSets);

function changedWhileWalked(m: Map<string, number>): string {
  let t = "";
  for (const [k, v] of m.entries()) {
    t += k + "=" + v + ",";
    if (k === "a") { m.delete("b"); m.set("e", 5); }
    if (k === "c" && v === 3) { m.delete("c"); m.set("c", 33); }
    if (k === "e" && m.size < 8) m.set("f", 6);
  }
  return t;
}
function clearedWhileWalked(s: Set<number>): string {
  let t = "";
  for (const v of s.values()) {
    t += v + ",";
    if (v === 20) { s.clear(); s.add(50); s.add(10); }
  }
  return t;
}
function grownWhileWalked(a: number[]): string {
  let t = "";
  for (const [i, v] of a.entries()) {
    t += i + "=" + v + ",";
    if (a.length < 7) a.push(v + 1);
    if (i === 5) a.length = 3;
  }
  return t;
}
function filledToManyEntries(m: Map<string, number>): string {
  let n = 0;
  for (const v of m.values()) {
    n += v;
    if (m.size < 300) m.set("k" + m.size, 1);
  }
  return n + " " + m.size;
}
tell("changed while walked", () => changedWhileWalked(newMap()));
tell("cleared while walked", () => clearedWhileWalked(newSet()));
tell("grown while walked", () => grownWhileWalked(newList()));
tell("filled while walked", () => filledToManyEntries(newMap()));

function changedBetweenCallAndLoop(m: Map<string, number>, change: (m: Map<string, number>) => void): string {
  let t = "";
  for (const v of (change(m), m.values())) t += v + ",";
  return t;
}
tell("changed in front of the call", () => changedBetweenCallAndLoop(newMap(), m => { m.delete("a"); m.set("z", 26); }));
tell("shadowed in front of the call", () => changedBetweenCallAndLoop(newMap(), m => { (m as any).values = countdown; }));

function mapChangedBehindCall(m: Map<string, number>, given: any, change: (m: Map<string, number>) => void): string {
  let t = "";
  const values = given === undefined ? m.values() : given;
  change(m);
  for (const v of values) t += String(v) + ",";
  return t;
}
function setChangedBehindCall(s: Set<number>, change: (s: Set<number>) => void): string {
  let t = "";
  const entries = s.entries();
  change(s);
  for (const [a, b] of entries) t += a + "=" + b + ",";
  return t;
}
function listChangedBehindCall(a: number[], change: (a: number[]) => void): string {
  let t = "";
  const entries = a.entries();
  change(a);
  for (const [i, v] of entries) t += i + "=" + v + ",";
  return t;
}
function bytesDetachedBehindCall(a: Uint8Array): string {
  let t = "";
  const values = a.values();
  structuredClone(a.buffer, { transfer: [a.buffer] });
  for (const v of values) t += v + ",";
  return t;
}
tell("cleared behind the call", () => mapChangedBehindCall(newMap(), undefined, m => { m.clear(); m.set("z", 26); }));
tell("first entry deleted behind the call", () => mapChangedBehindCall(newMap(), undefined, m => { m.delete("a"); m.set("a", 27); }));
tell("filled behind the call", () => mapChangedBehindCall(newMap(), undefined, m => { for (let i = 0; i < 40; i++) m.set("k" + i, i); for (let i = 0; i < 36; i++) m.delete("k" + i); }));
tell("shadowed behind the call", () => mapChangedBehindCall(newMap(), undefined, m => { (m as any).values = countdown; }));
tell("changed behind the call, given", () => mapChangedBehindCall(newMap(), [5, 6], m => { m.clear(); }));
tell("set cleared behind the call", () => setChangedBehindCall(newSet(), s => { s.clear(); s.add(7); }));
tell("list shortened behind the call", () => listChangedBehindCall(newList(), a => { a.length = 1; a.push(8); }));
tell("list with an accessor behind the call", () => listChangedBehindCall(newList(), a => { Object.defineProperty(a, 1, { get() { lines.push("  the element's accessor ran"); return -1; } }); }));
tell("detached behind the call", () => bytesDetachedBehindCall(newBytes()));

function leftEarly(m: Map<string, number>, last: string): string {
  let t = "";
  for (const k of m.keys()) {
    if (k === last) break;
    t += k + ",";
  }
  return t;
}
function returnedFrom(s: Set<number>, wanted: any): number {
  let i = 0;
  for (const v of s.values()) {
    if (v === wanted) return i;
    i++;
  }
  return -1;
}
function thrownFrom(a: number[]): string {
  let t = "";
  try {
    for (const v of a.values()) {
      if (v === 30) throw new Error("at " + v);
      t += v + ",";
    }
  } catch (error: any) {
    t += error.message;
  }
  return t;
}
const closing = (log: string[]) => ({
  i: 0,
  [Symbol.iterator]() { return this; },
  next() { return { done: this.i >= 3, value: "abc"[this.i++] }; },
  return() { log.push("closed"); return {}; },
});
tell("left early", () => leftEarly(newMap(), "c") + " " + leftEarly(newMap(), "none"));
tell("left early, own method", () => { const log: string[] = []; return leftEarly(shadowed(newMap(), () => closing(log)), "b") + " " + log.join(); });
tell("returned from", () => returnedFrom(newSet(), 30) + " " + returnedFrom(newSet(), 31));
tell("returned from, own method", () => { const log: string[] = []; return returnedFrom(shadowed(newSet(), () => closing(log)), "b") + " " + log.join(); });
tell("thrown from", () => thrownFrom(newList()));

function oneOfTwo(m: Map<string, number>, wantsKeys: boolean): string {
  let t = "";
  for (const x of wantsKeys ? m.keys() : m.values()) t += x + ",";
  return t;
}
function madeOrGiven(m: Map<string, number>, given: any): string {
  let t = "";
  for (const x of given === undefined ? m.values() : given) t += String(x) + ",";
  return t;
}
function ofEither(m: Map<string, number>, s: Set<number>, first: boolean): string {
  let t = "";
  for (const x of first ? m.values() : s.values()) t += x + ",";
  return t;
}
tell("one of two", () => oneOfTwo(newMap(), hidden.yes) + " " + oneOfTwo(newMap(), hidden.no));
tell("made or given", () => madeOrGiven(newMap(), undefined) + " " + madeOrGiven(newMap(), "xy") + " " + madeOrGiven(newMap(), [7]) + " " + madeOrGiven(newMap(), countdown()) + " " + madeOrGiven(newMap(), newSet().values()));
tell("of either", () => ofEither(newMap(), newSet(), hidden.yes) + " " + ofEither(newMap(), newSet(), hidden.no));

function walkedTwice(m: Map<string, number>): string {
  const values = m.values();
  let t = "";
  for (const v of values) { t += v + ","; if (v === 2) break; }
  for (const v of values) t += v + ";";
  return t;
}
function walkedInLoop(m: Map<string, number>): string {
  const values = m.values();
  let t = "";
  for (let round = 0; round < 3; round++) {
    for (const v of values) { t += round + ":" + v + ","; break; }
  }
  return t;
}
function madeInLoop(m: Map<string, number>): string {
  let t = "";
  for (let round = 0; round < 3; round++) {
    for (const v of m.values()) { t += round + ":" + v + ","; if (v > round) break; }
  }
  return t;
}
function nested(m: Map<string, number>): number {
  let n = 0;
  for (const a of m.values()) for (const b of m.values()) for (const k of m.keys()) n += a * b + k.length;
  return n;
}
function steppedByHand(m: Map<string, number>): string {
  const values = m.values();
  const first = values.next().value;
  let t = "first " + first + ": ";
  for (const v of values) t += v + ",";
  return t;
}
tell("walked twice", () => walkedTwice(newMap()));
tell("walked in a loop", () => walkedInLoop(newMap()));
tell("made in a loop", () => madeInLoop(newMap()));
tell("nested", () => String(nested(newMap())));
tell("stepped by hand", () => steppedByHand(newMap()));

function pattern(m: Map<string, number>): string { const [a, b, ...rest] = m.values(); return a + " " + b + " " + rest.join(); }
function shortPattern(s: Set<number>): string { const [a, , c] = s.values(); return a + " " + c; }
function longPattern(a: number[]): string { const [[, p], [, q], , , missing] = a.entries() as any; return p + " " + q + " " + missing; }
function spread(m: Map<string, number>): string { return [...m.keys(), "|", ...m.values()].join(); }
function spreadIntoCall(s: Set<number>): number { return Math.max(...s.values()); }
tell("pattern", () => pattern(newMap()) + " / " + pattern(shadowed(newMap(), () => "wxyz")));
tell("short pattern", () => shortPattern(newSet()) + " / " + shortPattern(shadowed(newSet(), () => "wxyz")));
tell("long pattern", () => longPattern(newList()));
tell("spread", () => spread(newMap()) + " / " + spread(shadowed(newMap(), () => "wx")));
tell("spread into a call", () => spreadIntoCall(newSet()) + " / " + spreadIntoCall(shadowed(newSet(), () => [1, 99])));

function detachedInFront(a: Uint8Array): string { let t = ""; structuredClone(a.buffer, { transfer: [a.buffer] }); for (const v of a.values()) t += v + ","; return t; }
function detachedWhileWalked(a: Uint8Array): string {
  let t = "";
  for (const v of a.values()) { t += v + ","; if (v === 20) structuredClone(a.buffer, { transfer: [a.buffer] }); }
  return t;
}
tell("detached in front of the call", () => detachedInFront(newBytes()));
tell("detached while walked", () => detachedWhileWalked(newBytes()));

{
  let total = 0;
  const maps = [newMap(), shadowed(newMap(), () => [100]), new Doubled(hidden.pairs), newMap()];
  for (let round = 0; round < 4000; round++) for (const v of maps[round & 3].values()) total += v as number;
  lines.push("many rounds " + total);
}

console.log(lines.join("\n"));
