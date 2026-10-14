// Array methods that build a new array, on subclasses of Array, with `Symbol.species` returning an array the program keeps, on frozen sources and on large arrays.
const D = typeof describe === "function" ? describe : null;
const sid = v => D ? (/StructureID: (\d+)/.exec(D(v)) || [, "?"])[1] : "";
const shape = v => D ? (/, ((?:CopyOnWrite)?ArrayWith\w+)[,\]]/.exec(D(v)) || [, "?"])[1] : "";
// The Structures of arrays made in ways that have nothing to do with the loops under test: an array in the making has none of them.
const known = new Set(); function learn() { if (!D) return; const grown = x => { const a = []; a.push(x); return a; }; const sparse = []; sparse[100000] = 1; const cut = []; cut[100000] = 1; cut.length = 0;
  for (const v of [[], [1, 2], [1.5, 2.5], ["a", "b"], [{}], new Array(), new Array(3), new Array(1, 2), new Array(1.5, 2.5), new Array("a", "b"), Array(0), Array.of(), Array.of(1), Array.of(1.5), Array.of("a"), grown(1), grown(1.5), grown("a"), grown({}), [1, 2].slice(), [1.5, 2.5].slice(), ["a"].slice(), [].slice(), [1].concat([2]), [1.5].concat([2.5]), ["a"].concat(["b"]), [].concat([]), sparse, cut, JSON.parse("[]"), JSON.parse("[1]"), JSON.parse("[1.5]"), JSON.parse('["a"]'), "a,b".split(","), Object.keys({ a: 1 })]) known.add(sid(v)); }
learn();
function row(name, f) { let r; try { r = f(); } catch (e) { console.log(name + ": threw " + e.name); return; } learn(); console.log(name + ": " + JSON.stringify(r) + " " + (!D || !Array.isArray(r) || known.has(sid(r)) ? "same" : "ANOTHER STRUCTURE (" + shape(r) + ")")); }
function tell(name, f) { try { console.log(name + ": " + f()); } catch (e) { console.log(name + ": threw " + e.name + " " + String(e.message).slice(0, 40)); } }
let bad = false; function badTime() { if (bad) return; bad = true; const p = {}; Object.create(p); Object.defineProperty(p, 0, { value: 7, writable: false }); }
class H extends Array {} class HF extends Array { tag = "t"; more = [1]; sum() { return this.reduce((a, b) => a + b, 0); } }
const about = r => [JSON.stringify(r), r.constructor.name, r instanceof H || r instanceof HF, r.tag, r.more && r.more.length, Object.keys(r).join("/"), typeof r.sum].join(" ");
for (const [n, mk] of [["an heir", () => H.of(3, 1, 2)], ["an heir with fields", () => HF.of(3, 1, 2)]]) {
  tell(n + " map", () => about(mk().map(x => x * 2))); tell(n + " filter", () => about(mk().filter(x => x > 1))); tell(n + " filter none", () => about(mk().filter(() => false)));
  tell(n + " flatMap", () => about(mk().flatMap(x => [x, x]))); tell(n + " toSorted", () => about(mk().toSorted())); tell(n + " sort", () => about(mk().sort())); tell(n + " slice", () => about(mk().slice(1)));
  tell(n + " Array.from of it", () => about(Array.from(mk()))); tell(n + " from.call", () => about(Array.from.call(mk().constructor, [1, 2], x => x)));
}
tell("a species that hands over a kept array with a property", () => { let kept; class S extends Array { static get [Symbol.species]() { return function (n) { kept = new Array(n); kept.extra = "mine"; kept.other = { o: 1 }; return kept; }; } } const r = S.of(3, 1, 2).filter(x => x > 1); return [r === kept, r.extra, JSON.stringify(r.other), JSON.stringify(r), Object.keys(r).join("/")].join(" "); });
tell("the same with map", () => { let kept; class S extends Array { static get [Symbol.species]() { return function (n) { kept = new Array(n); kept.extra = "mine"; return kept; }; } } const r = S.of(3, 1, 2).map(x => x * 2); return [r === kept, r.extra, JSON.stringify(r)].join(" "); });
tell("the same with flatMap", () => { let kept; class S extends Array { static get [Symbol.species]() { return function (n) { kept = []; kept.extra = "mine"; return kept; }; } } const r = S.of(3, 1).flatMap(x => [x, x]); return [r === kept, r.extra, JSON.stringify(r)].join(" "); });
tell("a species that is no array", () => { class S extends Array { static get [Symbol.species]() { return function (n) { return { length: 0, made: "object" }; }; } } const r = S.of(3, 1, 2).filter(x => x > 1); return JSON.stringify(r); });
tell("constructor replaced on an ordinary array", () => { let kept; const a = [3, 1, 2]; a.constructor = { [Symbol.species]: function (n) { kept = new Array(n); kept.extra = "mine"; return kept; } }; const r = a.map(x => x * 2); return [r === kept, r.extra, JSON.stringify(r)].join(" "); });
tell("a source with a property of its own", () => { const a = [3, 1, 2]; a.extra = "mine"; return [a.map(x => x), a.filter(() => true), a.toSorted(), a.flatMap(x => x), Array.from(a)].map(r => JSON.stringify(r) + ("extra" in r) + (!D || known.has(sid(r)) ? "same" : "ANOTHER")).join(" ") + " " + a.sort().extra; });
tell("a frozen source", () => { const a = Object.freeze([3, 1, 2]); return [a.map(x => x), a.filter(() => true), a.toSorted()].map(r => JSON.stringify(r) + Object.isFrozen(r)).join(" "); });
const sum = r => { learn(); let t = 0; for (let i = 0; i < r.length; i++) t = (t * 31 + (r[i] | 0)) | 0; return r.length + ":" + t + ":" + (!D || known.has(sid(r)) ? "same" : "ANOTHER " + shape(r)); };
for (const n of [31, 32, 33, 1000, 9999, 10000, 10001, 99999, 100000, 100001, 300000]) {
  const src = () => { const a = []; for (let i = 0; i < n; i++) a.push((i * 7919) % n); return a; };
  tell("map " + n, () => sum(src().map(x => x + 1))); tell("map to doubles " + n, () => sum(src().map(x => x + 0.5))); tell("map to texts " + n, () => sum(src().map(x => "t")));
  tell("filter half " + n, () => sum(src().filter(x => x % 2))); tell("filter all " + n, () => sum(src().filter(() => true))); tell("filter one " + n, () => sum(src().filter(x => x === 1)));
  tell("from " + n, () => sum(Array.from(src()))); tell("from a length " + n, () => sum(Array.from({ length: n }, (_, i) => i)));
  tell("flatMap " + n, () => sum(src().flatMap(x => [x, x]))); tell("toSorted " + n, () => sum(src().toSorted((a, b) => a - b))); tell("sort " + n, () => sum(src().sort((a, b) => a - b)));
}
for (const n of [33, 10001, 100001]) {
  const src = () => { const a = []; for (let i = 0; i < n; i++) a.push((i * 7919) % n); return a; }; const half = n >> 1;
  tell("in a bad time from half way, map " + n, () => sum(src().map((x, i) => { if (i === half) badTime(); return x + 1; })));
  tell("born in it, filter " + n, () => sum(src().filter(x => x % 2))); tell("born in it, from " + n, () => sum(Array.from(src()))); tell("born in it, flatMap " + n, () => sum(src().flatMap(x => [x, x])));
  tell("born in it, toSorted " + n, () => sum(src().toSorted((a, b) => a - b))); tell("born in it, sort " + n, () => sum(src().sort((a, b) => a - b))); tell("born in it, map to doubles " + n, () => sum(src().map(x => x + 0.5)));
}
