// A Map or Set made from a literal of constants lies in the read-only image until the first write moves its table to the heap; a table that has grown old is given young keys and values, is replaced by a young, larger one, and is still walked by an old iterator. What such a table alone holds must outlive full and young collections: across the move, also under a loop that began on the table in the image; in old entries; in new entries; behind the iterator.
// The functions are called through a table, so that nothing is inlined and no object is dissolved. The program asks for its collections itself and fills the freed cells anew.
interface Inner { n: number; label: string }
const TEXTS = new Map<string, string>([["one", "uno"], ["two", "dos"], ["three", "tres"], ["four", "cuatro"], ["five", "cinco"]]);
const MIXED = new Map<string, unknown>([["a", 1], ["b", "two"], ["c", true], ["d", null]]);
const NAMES = new Set<string>(["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota"]);
const shell: any = globalThis;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());
const junk: unknown[] = [];
function inner(i: number): Inner { return { n: i, label: "l" + i } }
function key(i: number): string { return "key" + i }
function text(i: number): string { return ["t", i].join("") }
function churn(): void { junk.length = 0; for (let i = 1; i <= 5; i++) junk.push(F.inner(-i), F.key(-i), F.text(-i)) }
function again(): void { collect(true); F.churn() }
function young(): void { collect(false); F.churn() }
function list(m: Map<string, unknown>): string { let out = ""; for (const [k, v] of m) out += k + "=" + (typeof v === "object" && v !== null ? (v as Inner).n + (v as Inner).label : String(v)) + " "; return out }
function firstWrite(m: Map<string, string>): string { m.set(F.key(1), F.text(1)); F.again(); m.set("two", F.text(2)); F.again(); m.delete("one"); F.again(); return F.list(m) }
function walkedAcrossTheMove(m: Map<string, unknown>): string { let out = "", turn = 0; for (const [k, v] of m) { if (turn++ === 1) { m.set(F.key(9), F.inner(9)); m.set(F.key(10), F.text(10)) } F.again(); out += k + ":" + typeof v + " " } return out + F.list(m) }
function namesAcrossTheMove(s: Set<string>): string { let out = "", turn = 0; for (const k of s) { if (turn < 6) s.add(F.key(turn)); if (turn === 2) s.delete("beta"); turn++; F.again(); out += k + " " } return out + s.size }
function made(): Map<string, unknown> { return new Map<string, unknown>([["x", 1], ["y", "why"], ["z", false]]) }
function eachItsOwn(count: number): string { const all: Map<string, unknown>[] = []; for (let i = 0; i < count; i++) { const m = F.made(); if (i & 1) m.set(F.key(i), F.inner(i)); all.push(m); F.again() } return all.map(m => F.list(m)).join("| ") }
function grownOld(count: number): Map<string, Inner> { const m = new Map<string, Inner>(); for (let i = 0; i < count; i++) m.set(F.key(i), F.inner(i)); collect(true); collect(true); return m }
function sum(m: Map<string, Inner>): string { let s = 0, k = 0; for (const [name, v] of m) { s += v.n + v.label.length; k += name.length } return m.size + ":" + s + ":" + k }
function youngValuesInOldEntries(m: Map<string, Inner>, count: number): string { for (let i = 0; i < count; i += 2) m.set(F.key(i), F.inner(1000 + i)); F.young(); F.young(); return F.sum(m) }
function youngEntriesInAnOldTable(m: Map<string, Inner>, from: number, to: number): string { for (let i = from; i < to; i++) { m.set(F.key(i), F.inner(i)); F.young() } return F.sum(m) }
function oldWalkerOfAReplacedTable(m: Map<string, Inner>, more: number): string { const walker = m.entries(); walker.next(); collect(true); collect(true); for (let i = 0; i < more; i++) m.set(F.key(5000 + i), F.inner(i)); F.young(); F.young(); let s = 0, seen = 0; for (const [, v] of walker) { s += v.n; seen++ } return seen + ":" + s }
const F = { inner, key, text, churn, again, young, list, firstWrite, walkedAcrossTheMove, namesAcrossTheMove, made, eachItsOwn, grownOld, sum, youngValuesInOldEntries, youngEntriesInAnOldTable, oldWalkerOfAReplacedTable };
console.log("the first write:", F.firstWrite(TEXTS));
console.log("walked across the move:", F.walkedAcrossTheMove(MIXED));
console.log("a set across the move:", F.namesAcrossTheMove(NAMES));
console.log("each its own:", F.eachItsOwn(6));
for (const count of [3, 8, 20, 70]) {
  const m = F.grownOld(count);
  console.log(count, "young values in old entries:", F.youngValuesInOldEntries(m, count), "| young entries, the table grows:", F.youngEntriesInAnOldTable(m, count, count * 2 + 3), "| an old walker:", F.oldWalkerOfAReplacedTable(m, count + 5));
}
