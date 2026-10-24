// Map.set and Set.add where nothing is known about the key: strings that are flat and hashed, strings never hashed, ropes, equal text in another cell, numbers, -0 and NaN, objects, symbols, BigInts, undefined: replaced, appended, appended behind deleted entries, through growth of the table, in copies of a Map (`new Map(other)`), and in old tables that get young values.
const lines = [];
const show = m => [...m].map(e => Array.isArray(e) ? String(typeof e[0] === "symbol" ? e[0].toString() : Object.is(e[0], -0) ? "-0" : typeof e[0] === "object" && e[0] ? "{" + e[0].id + "}" : typeof e[0] === "bigint" ? e[0] + "n" : e[0]) + "=" + String(e[1]) : String(typeof e === "symbol" ? e.toString() : typeof e === "object" && e ? "{" + e.id + "}" : typeof e === "bigint" ? e + "n" : e)).join(",");
const made = n => "key" + n;
const rope = (a, b) => a + b;
const object1 = { id: 1 }, object2 = { id: 2 }, mark = Symbol("mark");
const kinds = ["a", "b", "", "a b", made(1), made(2), rope("long key that is ", "a rope until it is asked"), 0, -0, 1, 1.5, NaN, -1, 2 ** 31, 2 ** 53, object1, object2, mark, Symbol.iterator, 10n, 2n ** 70n, undefined, null, true, false];
function set(m, k, v) { return m.set(k, v); }
function add(s, k) { return s.add(k); }
function fill(keys, from) { const m = new Map(); for (let i = 0; i < keys.length; i++) set(m, keys[i], from + i); return m; }
function collect(keys) { const s = new Set(); for (let i = 0; i < keys.length; i++) add(s, keys[i]); return s; }
for (let turn = 0; turn < 3; turn++) lines.push("filled: " + show(fill(kinds, turn)), "collected: " + show(collect(kinds)));
lines.push("the receiver comes back: " + (set(new Map(), "a", 1) instanceof Map) + " " + (add(new Set(), "a") instanceof Set));
const kept = fill(kinds, 0);
for (let turn = 0; turn < 3; turn++) { for (let i = 0; i < kinds.length; i++) set(kept, kinds[i], 100 * turn + i); lines.push("replaced: " + show(kept) + " size " + kept.size); }
for (const [first, second] of [["same text", ["same", "text"].join(" ")], [made(7), "key" + (3 + 4)], [rope("ab", "cd"), "abcd"], [String(12), "12"], [12, "12"], [10n, 10n + 0n], [NaN, 0 / 0], [0, -0]]) {
  const m = new Map(), s = new Set();
  set(m, first, "first"); set(m, second, "second"); add(s, first); add(s, second);
  lines.push("two keys: " + show(m) + " | " + show(s));
}
const names = [];
for (let i = 0; i < 300; i++) names.push("name" + i);
const grown = new Map(), grownSet = new Set();
let sizes = "";
for (let i = 0; i < names.length; i++) { set(grown, names[i], i); add(grownSet, names[i]); if ((i & (i + 1)) === 0) sizes += grown.size + "/" + grownSet.size + " "; }
lines.push("grown: " + sizes + show(grown).length + " " + show(grownSet).length);
let sum = 0;
for (let i = 0; i < names.length; i++) sum += grown.get("name" + i) + (grownSet.has("name" + i) ? 1 : 0);
lines.push("all are found again: " + sum);
for (let i = 0; i < names.length; i += 3) { grown.delete(names[i]); grownSet.delete(names[i]); }
for (let i = 0; i < names.length; i += 2) { set(grown, names[i], -i); add(grownSet, names[i]); }
lines.push("deleted and set again: " + grown.size + " " + grownSet.size + " " + [...grown.keys()].slice(-5).join(",") + " " + [...grownSet].slice(-5).join(",") + " " + [...grown.values()].reduce((a, b) => a + b, 0));
const base = fill(["p", "q", "r", "s", "t", "u", "v"], 0);
for (let turn = 0; turn < 4; turn++) {
  const copy = new Map(base);
  set(copy, "q", "replaced " + turn); set(copy, "new" + turn, turn); set(copy, "w", turn); set(copy, object1, turn);
  const copied = new Set(base.keys());
  add(copied, "q"); add(copied, "new" + turn); add(copied, 5);
  lines.push("a copy: " + show(copy) + " | " + show(copied) + " | the original: " + show(base));
}
const old = fill(names.slice(0, 40), 0), oldSet = collect(names.slice(0, 40));
const waste = [];
for (let round = 0; round < 40; round++) {
  for (let i = 0; i < 2000; i++) waste[i & 255] = { id: i, text: "waste" + i };
  for (let i = 0; i < 40; i++) set(old, names[i], { id: round * 100 + i });
  set(old, "young" + round, { id: -round }); add(oldSet, "young" + round);
}
lines.push("young values in an old table: " + [...old.values()].reduce((a, b) => a + b.id, 0) + " " + old.size + " " + oldSet.size + " " + [...oldSet].slice(-3).join(","));
class Other { set(k, v) { return "my own set " + k + v; } add(k) { return "my own add " + k; } }
lines.push(set(new Other, "a", 1), add(new Other, "a"));
const attempt = f => { try { return String(f()); } catch (e) { return e.constructor.name; } };
lines.push(attempt(() => set(null, "a", 1)), attempt(() => add(undefined, "a")), attempt(() => Map.prototype.set.call(new Set(), "a", 1)), attempt(() => Set.prototype.add.call(new Map(), "a")));
console.log(lines.join("\n"));
