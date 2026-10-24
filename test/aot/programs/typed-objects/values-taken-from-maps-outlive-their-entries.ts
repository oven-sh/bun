// A Map or Set with string keys keeps keys and values as 32-bit references in a table of its own. A loop takes a key or a value out of the table, the entry is deleted (or the whole Map cleared), a collection runs and the freed cells are filled anew: what the loop variable alone holds must be as it was, also where it is used on one path only, and where it is stored into an object.
// The functions are called through a table, so that nothing is inlined and no object is dissolved. The program asks for its collections itself.
interface Inner { n: number; label: string }
function collect(): void { const g: any = globalThis; if (g.Bun) g.Bun.gc(true); else g.gc() }
function inner(i: number): Inner { return { n: i, label: "l" + i } }
function key(i: number): string { return "key" + i }
function churn(): number { let s = 0; for (let i = 0; i < 60; i++) s += F.inner(9000 + i).n + F.key(i).length; return s }
function again(): void { F.collect(); F.churn() }
function filled(count: number): Map<string, Inner> { const m = new Map<string, Inner>(); for (let i = 0; i < count; i++) m.set(F.key(i), F.inner(i)); return m }
function names(count: number): Set<string> { const s = new Set<string>(); for (let i = 0; i < count; i++) s.add(F.key(i)); return s }
function valueBehindItsEntry(m: Map<string, Inner>): number { let s = 0; for (const [k, v] of m) { m.delete(k); F.again(); s += v.n } return s }
function valueOnOnePath(m: Map<string, Inner>, which: number): number { let s = 0, i = 0; for (const [k, v] of m) { m.delete(k); F.again(); if ((i++ & 1) === which) s += v.n } return s }
function keyOnOnePath(m: Map<string, Inner>, which: number): number { let s = 0, i = 0; for (const [k] of m) { m.delete(k); F.again(); if ((i++ & 1) === which) s += k.length } return s }
function valuesOnly(m: Map<string, Inner>, which: number): number { let s = 0, i = 0; for (const v of m.values()) { if (i === 0) m.clear(); F.again(); if ((i++ & 1) === which) s += v.n } return s }
function nameOnOnePath(set: Set<string>, which: number): number { let s = 0, i = 0; for (const k of set) { set.delete(k); F.again(); if ((i++ & 1) === which) s += k.length } return s }
function storedBehind(m: Map<string, Inner>, out: { held: Inner | null }): number { let s = 0; for (const [k, v] of m) { m.delete(k); F.again(); out.held = v; F.again(); s += out.held.n } return s }
const F = { collect, inner, key, churn, again, filled, names, valueBehindItsEntry, valueOnOnePath, keyOnOnePath, valuesOnly, nameOnOnePath, storedBehind };
for (const count of [3, 9, 20]) console.log(count, F.valueBehindItsEntry(F.filled(count)), F.valueOnOnePath(F.filled(count), 0), F.valueOnOnePath(F.filled(count), 1), F.keyOnOnePath(F.filled(count), 1), F.valuesOnly(F.filled(count), 0), F.nameOnOnePath(F.names(count), 0), F.storedBehind(F.filled(count), { held: null }));
