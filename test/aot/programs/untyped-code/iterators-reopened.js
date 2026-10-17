// One iterator object (array, Map, Set, string ..) is used by a loop more than once: after exhaustion, after `break`, and in nested loops.
function row(name, f) { try { console.log(name + ": " + f()); } catch (e) { console.log(name + ": threw " + e.name + " " + e.message); } }
const KINDS = {
  "array entries": () => [7, 8, 9, 10].entries(), "array keys": () => [7, 8, 9, 10].keys(), "array values": () => [7, 8, 9, 10].values(), "array @@iterator": () => [7, 8, 9, 10][Symbol.iterator](),
  "map entries": () => new Map([[1, "a"], [2, "b"], [3, "c"], [4, "d"]]).entries(), "map keys": () => new Map([[1, "a"], [2, "b"], [3, "c"], [4, "d"]]).keys(), "map values": () => new Map([[1, "a"], [2, "b"], [3, "c"], [4, "d"]]).values(), "map @@iterator": () => new Map([[1, "a"], [2, "b"], [3, "c"], [4, "d"]])[Symbol.iterator](),
  "set values": () => new Set([5, 6, 7, 8]).values(), "set entries": () => new Set([5, 6, 7, 8]).entries(), "set @@iterator": () => new Set([5, 6, 7, 8])[Symbol.iterator](),
  "string @@iterator": () => "wxyz"[Symbol.iterator](), "typed array entries": () => new Uint8Array([1, 2, 3, 4]).entries(), "typed array values": () => new Uint8Array([1, 2, 3, 4]).values(),
};
// the kinds through a table: the generic path, as a control
for (const k in KINDS) row("by a table, " + k, () => { const e = KINDS[k](); let s = ""; for (let r = 0; r < 3; r++) { for (const x of e) { s += String(x) + ";"; break; } s += "|"; } return s; });
// each kind written where it is used, so that the call goes to one place
row("entries, exhausted twice", () => { const e = [7, 8].entries(); let n = 0; for (let r = 0; r < 2; r++) for (const [i] of e) n++; return n; });
row("entries, break", () => { const e = [7, 8, 9, 10].entries(); let s = ""; for (let r = 0; r < 3; r++) { for (const [i, x] of e) { s += i + ":" + x + ";"; break; } s += "|"; } return s; });
row("entries, break at the second", () => { const e = [7, 8, 9, 10, 11].entries(); let s = ""; for (let r = 0; r < 3; r++) { let c = 0; for (const [i, x] of e) { s += i + ":" + x + ";"; if (++c === 2) break; } s += "|"; } return s; });
row("entries, the pair kept", () => { const e = [7, 8, 9].entries(); let s = ""; for (let r = 0; r < 2; r++) { for (const p of e) { s += p.join(":") + ";"; break; } s += "|"; } return s; });
row("entries, only the value", () => { const e = [7, 8, 9].entries(); let s = ""; for (let r = 0; r < 2; r++) { for (const [, x] of e) { s += x + ";"; break; } s += "|"; } return s; });
row("keys, break", () => { const e = [7, 8, 9, 10].keys(); let s = ""; for (let r = 0; r < 3; r++) { for (const i of e) { s += i + ";"; break; } s += "|"; } return s; });
row("keys, exhausted twice", () => { const e = [7, 8].keys(); let n = 0; for (let r = 0; r < 2; r++) for (const i of e) n++; return n; });
row("values, break", () => { const e = [7, 8, 9, 10].values(); let s = ""; for (let r = 0; r < 3; r++) { for (const x of e) { s += x + ";"; break; } s += "|"; } return s; });
row("values, exhausted twice", () => { const e = [7, 8].values(); let n = 0; for (let r = 0; r < 2; r++) for (const x of e) n++; return n; });
row("@@iterator of an array, break", () => { const e = [7, 8, 9, 10][Symbol.iterator](); let s = ""; for (let r = 0; r < 3; r++) { for (const x of e) { s += x + ";"; break; } s += "|"; } return s; });
row("map entries, break", () => { const m = new Map([[1, "a"], [2, "b"], [3, "c"]]); const e = m.entries(); let s = ""; for (let r = 0; r < 3; r++) { for (const [k, v] of e) { s += k + v + ";"; break; } s += "|"; } return s; });
row("map entries, exhausted twice", () => { const m = new Map([[1, "a"], [2, "b"]]); const e = m.entries(); let n = 0; for (let r = 0; r < 2; r++) for (const [k] of e) n++; return n; });
row("map keys, break", () => { const m = new Map([[1, "a"], [2, "b"], [3, "c"]]); const e = m.keys(); let s = ""; for (let r = 0; r < 3; r++) { for (const k of e) { s += k + ";"; break; } s += "|"; } return s; });
row("map values, exhausted twice", () => { const m = new Map([[1, "a"], [2, "b"]]); const e = m.values(); let n = 0; for (let r = 0; r < 2; r++) for (const v of e) n++; return n; });
row("map @@iterator, break", () => { const m = new Map([[1, "a"], [2, "b"], [3, "c"]]); const e = m[Symbol.iterator](); let s = ""; for (let r = 0; r < 3; r++) { for (const [k, v] of e) { s += k + v + ";"; break; } s += "|"; } return s; });
row("set values, break", () => { const t = new Set([5, 6, 7]); const e = t.values(); let s = ""; for (let r = 0; r < 3; r++) { for (const v of e) { s += v + ";"; break; } s += "|"; } return s; });
row("set values, exhausted twice", () => { const t = new Set([5, 6]); const e = t.values(); let n = 0; for (let r = 0; r < 2; r++) for (const v of e) n++; return n; });
row("set entries, break", () => { const t = new Set([5, 6, 7]); const e = t.entries(); let s = ""; for (let r = 0; r < 3; r++) { for (const [a, b] of e) { s += a + "" + b + ";"; break; } s += "|"; } return s; });
row("string @@iterator, break", () => { const e = "wxyz"[Symbol.iterator](); let s = ""; for (let r = 0; r < 3; r++) { for (const c of e) { s += c + ";"; break; } s += "|"; } return s; });
row("string @@iterator, exhausted twice", () => { const e = "wx"[Symbol.iterator](); let n = 0; for (let r = 0; r < 2; r++) for (const c of e) n++; return n; });
row("typed array entries, break", () => { const e = new Uint8Array([1, 2, 3]).entries(); let s = ""; for (let r = 0; r < 3; r++) { for (const [i, x] of e) { s += i + ":" + x + ";"; break; } s += "|"; } return s; });
row("a generator, break closes it", () => { function* g() { yield 1; yield 2; yield 3; } const e = g(); let s = ""; for (let r = 0; r < 3; r++) { for (const x of e) { s += x + ";"; break; } s += "|"; } return s; });
// every form of outer cycle, over entries
row("while", () => { const e = [7, 8, 9].entries(); let s = "", r = 0; while (r++ < 2) { for (const [i] of e) { s += i + ";"; break; } s += "|"; } return s; });
row("do while", () => { const e = [7, 8, 9].entries(); let s = "", r = 0; do { for (const [i] of e) { s += i + ";"; break; } s += "|"; } while (++r < 2); return s; });
row("for of", () => { const e = [7, 8, 9].entries(); let s = ""; for (const r of [0, 1]) { for (const [i] of e) { s += i + ";"; break; } s += "|"; } return s; });
row("for in", () => { const e = [7, 8, 9].entries(); let s = ""; for (const r in { a: 1, b: 2 }) { for (const [i] of e) { s += i + ";"; break; } s += "|"; } return s; });
row("a labelled continue", () => { const e = [7, 8, 9].entries(); let s = ""; outer: for (let r = 0; r < 2; r++) { for (const [i] of e) { s += i + ";"; continue outer; } s += "|"; } return s; });
row("two cycles deep", () => { const e = [7, 8, 9, 10, 11].entries(); let s = ""; for (let q = 0; q < 2; q++) for (let r = 0; r < 2; r++) { for (const [i] of e) { s += i + ";"; break; } s += "|"; } return s; });
row("made in the head of the outer loop", () => { let s = ""; for (let e = [7, 8, 9].entries(), r = 0; r < 2; r++) { for (const [i] of e) { s += i + ";"; break; } s += "|"; } return s; });
row("made in the outer loop, each time: begins again", () => { let s = ""; for (let r = 0; r < 2; r++) { const e = [7, 8, 9].entries(); for (const [i] of e) { s += i + ";"; break; } s += "|"; } return s; });
row("made once under a condition", () => { let e, s = ""; for (let r = 0; r < 3; r++) { if (!e) e = [7, 8, 9, 10].entries(); for (const [i] of e) { s += i + ";"; break; } s += "|"; } return s; });
row("in a try with finally", () => { const e = [7, 8, 9].entries(); let s = ""; for (let r = 0; r < 2; r++) { try { for (const [i] of e) { s += i + ";"; break; } } finally { s += "|"; } } return s; });
row("left by a throw", () => { const e = [7, 8, 9].entries(); let s = ""; for (let r = 0; r < 2; r++) { try { for (const [i] of e) { s += i + ";"; throw 1; } } catch (x) { s += "|"; } } return s; });
row("left by return, in a closure called twice", () => { const e = [7, 8, 9].entries(); const first = () => { for (const [i, x] of e) return i + ":" + x; return "none"; }; return first() + " " + first() + " " + first() + " " + first(); });
row("in a generator, a yield between the rounds", () => { function* g() { const e = [7, 8, 9].entries(); for (let r = 0; r < 2; r++) { for (const [i] of e) { yield i; break; } yield "|"; } } return [...g()].join(""); });
row("the array grows between the rounds", () => { const a = [7]; const e = a.entries(); let s = ""; for (let r = 0; r < 3; r++) { for (const [i, x] of e) s += i + ":" + x + ";"; s += "|"; a.push(8 + r); } return s; });
row("the array grows in the round", () => { const a = [7, 8]; const e = a.entries(); let s = ""; for (let r = 0; r < 2; r++) { for (const [i, x] of e) { s += i + ":" + x + ";"; if (a.length < 4) a.push(9); break; } s += "|"; } return s; });
row("hot", () => { let t = 0; for (let h = 0; h < 300; h++) { const e = [7, 8, 9].entries(); for (let r = 0; r < 2; r++) for (const [i] of e) { t += i + 1; break; } } return t; });
row("both in the same loops: as before", () => { let t = 0; for (let r = 0; r < 3; r++) for (const [i, x] of [7, 8].entries()) t += i + x; return t; });
