// A Map or Set with string keys keeps keys and values as 32-bit references in a table of its own. Here the Map alone holds what is in it: typed objects, strings, arrays and functions that nothing else refers to. It is filled through every step of its growth, read, emptied in part, filled again, iterated while it grows and shrinks, cleared and copied, with a collection and new cells in the freed places between the steps. A key that is an object sends the Map to the engine's ordinary table: the same is asked of that. Every value says who it is.
// The functions are called through a table, so that nothing is inlined and no object is dissolved. The program asks for its collections itself.
interface Inner { n: number; label: string }
interface Outer { id: number; b: Inner }
const junk: unknown[] = [];
function inner(i: number): Inner { return { n: i, label: "l" + i } }
function outer(i: number): Outer { return { id: i, b: F.inner(i * 2) } }
function key(i: number): string { return "key" + i }
function collect(): void { const g: any = globalThis; if (g.Bun) g.Bun.gc(true); else g.gc() }
function churn(): void { junk.length = 0; for (let i = 1; i <= 5; i++) junk.push(F.outer(-i), F.key(-i), [F.inner(-i)], () => -i) }
function again(): void { F.collect(); F.churn() }

function fill(m: Map<string, Inner>, from: number, to: number, every: number): void { for (let i = from; i < to; i++) { m.set(F.key(i), F.outer(i).b); if (i % every === 0) F.again() } }
function sum(m: Map<string, Inner>, from: number, to: number): number { let s = 0; for (let i = from; i < to; i++) { const v = m.get(F.key(i)); if (v !== undefined) s += v.n + v.label.length } return s }
function walk(m: Map<string, Inner>): string { let s = 0, k = 0; for (const [name, v] of m) { s += v.n; k += name.length; if ((s & 127) === 0) F.again() } return s + "/" + k }
function drop(m: Map<string, Inner>, from: number, to: number, step: number): number { let n = 0; for (let i = from; i < to; i += step) if (m.delete(F.key(i))) n++; F.again(); return n }
function growWhileWalking(m: Map<string, Inner>, limit: number): string { let s = 0, seen = 0; for (const [name, v] of m) { seen++; s += v.n; if (m.size < limit) { m.set(name + "+", F.inner(v.n + 1)); if ((seen & 3) === 0) F.again() } } return seen + ":" + s }
function shrinkWhileWalking(m: Map<string, Inner>): string { let s = 0, seen = 0; for (const [name, v] of m) { seen++; s += v.n; m.delete(name); if ((seen & 3) === 0) F.again() } return seen + ":" + s + ":" + m.size }
function clearWhileWalking(m: Map<string, Inner>): string { let seen = 0; for (const [, v] of m) { seen += v.n; m.clear(); F.again(); m.set("after", F.inner(5)) ; if (seen > 100000) break } return seen + ":" + m.size }
function takeOut(m: Map<string, Inner>, i: number): number { const v = m.get(F.key(i)); m.delete(F.key(i)); F.again(); return v === undefined ? -1 : v.n + v.label.length }
function replace(m: Map<string, Inner>, i: number): number { const v = m.get(F.key(i)); m.set(F.key(i), F.inner(-7)); F.again(); return v === undefined ? -1 : v.n + v.label.length }
function keysOnly(s: Set<string>, from: number, to: number): void { for (let i = from; i < to; i++) { s.add(F.key(i)); if (i % 11 === 0) F.again() } }
function lengths(s: Set<string>): number { let n = 0; for (const k of s) { n += k.length; if ((n & 63) === 0) F.again() } return n }
function mixed(m: Map<string, unknown>, k: number): string { for (let i = 0; i < k; i++) { m.set(F.key(i), i % 4 === 0 ? F.inner(i) : i % 4 === 1 ? F.key(i * 3) : i % 4 === 2 ? [F.inner(i)] : i + 0.5); if (i % 6 === 0) F.again() } let out = ""; for (const [, v] of m) out += typeof v === "object" ? (Array.isArray(v) ? "a" + (v[0] as Inner).n : "o" + (v as Inner).n) : String(v); return out }
function byObject(m: Map<Inner, Outer>, held: Inner[], k: number): number { for (let i = 0; i < k; i++) { const o = F.outer(i); held.push(o.b); m.set(o.b, o); if (i % 5 === 0) F.again() } let s = 0; for (const b of held) s += m.get(b)!.id + b.n; return s }
function turned(m: Map<unknown, Inner>, k: number): number { for (let i = 0; i < k; i++) m.set(F.key(i), F.inner(i)); F.again(); const odd = F.inner(1000); m.set(odd, F.inner(2000)); F.again(); let s = m.get(odd)!.n; for (let i = 0; i < k; i++) s += m.get(F.key(i))!.n; return s }
function copied(m: Map<string, Inner>): number { const c = new Map(m); m.clear(); F.again(); let s = 0; for (const v of c.values()) s += v.n; return s }
function functions(m: Map<string, () => number>, k: number): number { for (let i = 0; i < k; i++) { m.set(F.key(i), () => i * 2); if (i % 7 === 0) F.again() } let s = 0; for (const f of m.values()) s += f(); return s }
const F = { inner, outer, key, collect, churn, again, fill, sum, walk, drop, growWhileWalking, shrinkWhileWalking, clearWhileWalking, takeOut, replace, keysOnly, lengths, mixed, byObject, turned, copied, functions };

const m = new Map<string, Inner>();
for (const size of [1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 31, 33, 64, 65, 129, 300]) { F.fill(m, m.size, size, 13); F.again(); console.log(size, m.size, F.sum(m, 0, size), F.walk(m)) }
console.log("deleted", F.drop(m, 0, 300, 3), m.size, F.sum(m, 0, 300), F.walk(m));
F.fill(m, 300, 420, 17); console.log("filled again", m.size, F.sum(m, 0, 420), F.walk(m));
console.log("taken out", F.takeOut(m, 1), F.takeOut(m, 400), F.takeOut(m, 3), "replaced", F.replace(m, 2), F.replace(m, 401), m.size, F.sum(m, 0, 420));
{ const w = new Map<string, Inner>(); F.fill(w, 0, 6, 2); console.log("grows while walked", F.growWhileWalking(w, 60), w.size, F.walk(w)) }
{ const w = new Map<string, Inner>(); F.fill(w, 0, 40, 7); console.log("shrinks while walked", F.shrinkWhileWalking(w)) }
{ const w = new Map<string, Inner>(); F.fill(w, 0, 20, 7); console.log("cleared while walked", F.clearWhileWalking(w)) }
{ const s = new Set<string>(); F.keysOnly(s, 0, 130); F.again(); console.log("a set", s.size, F.lengths(s), s.has(F.key(77)), s.has(F.key(130))) }
console.log("values of many kinds", F.mixed(new Map<string, unknown>(), 40));
console.log("objects as keys", F.byObject(new Map<Inner, Outer>(), [], 70));
console.log("a key that is no string arrives late", F.turned(new Map<unknown, Inner>(), 30));
console.log("copied, the first one cleared", F.copied(m), m.size);
console.log("functions", F.functions(new Map<string, () => number>(), 50));
