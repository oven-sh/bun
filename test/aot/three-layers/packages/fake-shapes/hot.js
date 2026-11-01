export class HotA { constructor(n) { this.n = n; this.kind = "A"; } value() { return this.n; } get twice() { return this.n * 2; } }
export function sumN(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].n; return s; }
export function sumValue(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].value(); return s; }
export function sumTwice(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].twice; return s; }
export function bumpN(list) { for (let i = 0; i < list.length; i++) list[i].n += 1; return list.length; }
export function kindsOf(list) { let s = ""; for (let i = 0; i < list.length; i++) s += list[i].kind; return s; }
export function countA(list) { let c = 0; for (let i = 0; i < list.length; i++) if (list[i] instanceof HotA) c++; return c; }
export function countHas(list, key) { let c = 0; for (let i = 0; i < list.length; i++) if (key in list[i]) c++; return c; }
export function callEach(fs, x) { let s = 0; for (let i = 0; i < fs.length; i++) s += fs[i](x); return s; }
export function callEachWith(fs, self, ...args) { let s = 0; for (let i = 0; i < fs.length; i++) s += fs[i].call(self, ...args); return s; }
export function newEach(cs, x) { let s = 0; for (let i = 0; i < cs.length; i++) s += new cs[i](x).value(); return s; }
export function makeClosures(f) { const out = []; for (let i = 0; i < 4; i++) out.push(x => f(x) + i); return out; }
export function pingPong(n, other) { return n <= 0 ? 0 : 1 + other(n - 1, pingPong); }
export function throwAt(n, other) { if (n <= 0) throw new RangeError("bottom"); try { return other(n - 1, throwAt); } finally { throwAt.unwound = (throwAt.unwound || 0) + 1; } }
export function catchEvery(n, f) { let caught = 0; for (let i = 0; i < n; i++) { try { f(i); } catch (e) { caught += e instanceof Error ? 1 : 100; } } return caught; }
export const toJSONer = { n: 1, toJSON() { return { from: "pkg", n: this.n }; } };
export const primitive = { [Symbol.toPrimitive](hint) { return hint === "string" ? "pkg" : 7; } };
export function compareByN(a, b) { return a.n - b.n; }
