// `for..of` through a value of no known type over Sets and Maps of every kind of key, their iterators, changed while they are stepped through: deleted from, added to, cleared, grown past a rehash.
const out: string[] = [];
function all(x: any): string { const seen: string[] = []; for (const v of x) seen.push(Array.isArray(v) ? "[" + v.map(String).join(",") + "]" : typeof v === "symbol" ? v.toString() : Object.is(v, -0) ? "-0" : String(v)); return seen.join(" "); }
function some(x: any, stopAt: number): string { const seen: string[] = []; for (const v of x) { seen.push(String(v)); if (seen.length === stopAt) break; } return seen.join(" "); }
function changing(x: any, change: (v: any, turn: number) => void, limit = 60): string { const seen: string[] = []; let turn = 0; for (const v of x) { seen.push(String(v)); change(v, turn++); if (turn >= limit) break; } return seen.join(" "); }
const o = { toString() { return "object"; } }, sym = Symbol("s");
const kinds: [string, () => unknown[]][] = [
    ["integers", () => [0, 7, 14, 21, 28, 35]], ["doubles", () => [0.5, -0, NaN, Infinity, 1e21, 2 ** 31]], ["strings", () => ["a", "bb", "", "ccc", "7", "a b"]],
    ["mixed", () => [1, "1", true, null, undefined, o, sym, 10n, "x"]], ["none", () => []], ["one", () => [42]],
];
for (const [name, make] of kinds) {
    const keys = make();
    const set = new Set<unknown>(keys), map = new Map<unknown, unknown>(keys.map((k, i) => [k, i]));
    out.push(name + " | " + [all(set), all(set.values()), all(set.keys()), all(set.entries()), all(map), all(map.keys()), all(map.values()), all(map.entries())].join(" | "));
    out.push(name + " left early | " + [some(set, 2), some(map.keys(), 2), some(map.values(), 1), some(set, 100)].join(" | "));
    const it = set.values(); it.next();
    out.push(name + " begun elsewhere | " + all(it) + " | " + all(it));
}
for (const start of [[1, 2, 3, 4, 5, 6, 7, 8], ["a", "b", "c", "d", "e", "f", "g", "h"]] as unknown[][]) {
    const fresh = () => new Set<unknown>(start);
    let s = fresh(); out.push("deletes what comes next | " + changing(s, (v, t) => s.delete(start[t + 1 + (t & 1)])) + " | " + all(s));
    s = fresh(); out.push("deletes itself | " + changing(s, v => s.delete(v)) + " | " + all(s));
    s = fresh(); out.push("deletes and adds itself again | " + changing(s, (v, t) => { if (t < 12) { s.delete(v); s.add(v); } }) + " | " + all(s));
    s = fresh(); out.push("adds | " + changing(s, (v, t) => { if (t < 40) s.add(typeof v === "number" ? 100 + t : "k" + t); }).length + " | " + s.size);
    s = fresh(); out.push("clears | " + changing(s, (v, t) => { if (t === 2) s.clear(); }) + " | " + all(s));
    s = fresh(); out.push("clears and fills | " + changing(s, (v, t) => { if (t === 2) { s.clear(); s.add("new"); s.add(5); s.add(start[0]); } }) + " | " + all(s));
    s = fresh(); out.push("another kind of key comes | " + changing(s, (v, t) => { if (t === 1) { s.add(typeof v === "number" ? "text" : 99); s.add(o); } }) + " | " + all(s));
    s = fresh(); out.push("two at once | " + changing(s, v => { out.push("  inner " + some(s, 3)); }, 2));
    const m = new Map<unknown, unknown>(start.map((k, i) => [k, i]));
    out.push("a map's values, deleted from | " + changing(m.values(), (v, t) => m.delete(start[t + 2])) + " | " + all(m));
    const m2 = new Map<unknown, unknown>(start.map((k, i) => [k, i]));
    out.push("a map's keys, grown | " + changing(m2.keys(), (v, t) => { if (t < 30) m2.set(typeof v === "number" ? 1000 + t : "z" + t, t); }).length + " | " + m2.size);
}
let total = 0; const big = new Set<unknown>(); for (let i = 0; i < 5000; i++) big.add(i * 3); for (let r = 0; r < 20; r++) for (const v of big as any) total += v; out.push("big " + total);
console.log(out.join("\n"));
