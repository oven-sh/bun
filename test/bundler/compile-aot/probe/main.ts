const out: string[] = [];
const any = (x: unknown): any => x;
const say = (name: string, f: () => unknown) => {
  let text: string;
  try { text = String(f()); } catch (e: any) { text = "threw " + e?.name + ": " + e?.message; }
  out.push(name + " = " + text);
};
const young = () => Bun.gc(false);
const full = () => Bun.gc(true);

function readP(o: any) { return o.p; }
function readQ(o: any) { return o.q; }
function readBoth(o: any) { return o.p + ":" + o.q; }
function readLength(o: any) { return o.length; }
function readName(o: any) { return o.name; }
function readDeep(o: any) { return o.inner.p; }
function readTwice(o: any) { const a = o.p; const b = o.p; return a === b ? a : "differs " + a + " " + b; }
const warm = (f: (o: any) => unknown, o: any, times = 300) => { let r: unknown; for (let i = 0; i < times; i++) r = f(o); return r; };

const makers: ((v: unknown) => any)[] = [
  v => ({ p: v }),
  v => ({ a: 1, p: v }),
  v => ({ a: 1, b: 2, p: v }),
  v => ({ p: v, a: 1 }),
  v => ({ a: 1, p: v, b: 2 }),
  v => ({ z: 0, y: 0, x: 0, w: 0, p: v }),
  v => ({ z: 0, y: 0, x: 0, w: 0, v: 0, u: 0, p: v }),
  v => { const o: any = {}; o.p = v; return o; },
  v => { const o: any = { a: 1 }; o.b = 2; o.p = v; return o; },
  v => { const o: any = {}; for (let i = 0; i < 12; i++) o["k" + i] = i; o.p = v; return o; },
  v => { const o: any = {}; for (let i = 0; i < 80; i++) o["k" + i] = i; o.p = v; return o; },
  v => Object.assign(Object.create(null), { p: v }),
  v => Object.create({ p: v }),
  v => Object.create(Object.create({ p: v })),
  v => ({ get p() { return v; } }),
  v => Object.create({ get p() { return v; } }),
  v => new (class { p = v; })(),
  v => new (class { a = 1; p = v; b = 2; })(),
  v => Object.assign(() => 1, { p: v }),
  v => Object.assign([1, 2], { p: v }),
  v => Object.freeze({ a: 1, p: v }),
  v => Object.seal({ p: v, c: 3 }),
  v => new Proxy({}, { get: (_t, k) => (k === "p" ? v : undefined) }),
  v => Object.assign(new Map(), { p: v }),
  v => Object.assign(new Error("e"), { p: v }),
];
const kept = makers.map((m, i) => m("v" + i));
const sweep = (f: (o: any) => unknown, list: any[]) => list.map(o => f(o)).join();
say("each once", () => sweep(readP, kept));
say("each many times", () => kept.map(o => warm(readP, o)).join());
say("each once again", () => sweep(readP, kept));
full();
say("after a full collection", () => sweep(readP, kept));
say("and back to front", () => sweep(readP, [...kept].reverse()));
young();
say("after a young one", () => sweep(readP, kept));
say("two by two", () => { const r: unknown[] = []; for (let i = 0; i < kept.length; i++) for (let j = 0; j < kept.length; j++) { const a = readP(kept[i]), b = readP(kept[j]), c = readP(kept[i]); if (a !== "v" + i || b !== "v" + j || c !== a) r.push(i + "/" + j); } return r.length ? r.join() : "all right"; });
say("runs of each", () => { let bad = 0; for (let round = 0; round < 6; round++) for (let i = 0; i < kept.length; i++) for (let n = 0; n < 7; n++) if (readP(kept[i]) !== "v" + i) bad++; return bad; });
say("read twice in a row", () => sweep(readTwice, kept));

const pq = [{ p: 1, q: 2 }, { q: 3, p: 4 }, { a: 0, p: 5, q: 6 }, { a: 0, q: 7, p: 8 }, { p: 9, a: 0, q: 10 }, { q: 11, a: 0, b: 0, p: 12 }];
say("p and q, first", () => sweep(readBoth, pq));
for (const o of pq) warm(readBoth, o);
full();
say("p and q, once they are old", () => { const r: string[] = []; for (let i = 0; i < 40; i++) r.push(sweep(readBoth, pq)); return new Set(r).size + " " + r[0]; });
say("p and q, shuffled", () => { let seed = 7, bad = 0; for (let i = 0; i < 5000; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; const o: any = pq[seed % pq.length]; if (readBoth(o) !== o.p + ":" + o.q) bad++; } return bad; });

const some = [{ p: "here" }, { a: 1 }, { a: 1, b: 2 }, { b: 1, p: "there" }, {}, Object.create(null), Object.create({ q: 1 })];
for (const o of some) warm(readP, o);
full();
say("absent and present", () => { const r: string[] = []; for (let i = 0; i < 30; i++) r.push(sweep(readP, some)); return new Set(r).size + " " + r[0]; });
say("then it is added", () => { const o: any = { a: 1 }; const before = warm(readP, o); o.p = "added"; return before + "," + readP(o) + "," + readP({ a: 1 }) + "," + readP(o); });
say("then it is put on what they inherit from", () => { const proto: any = {}; const o = Object.create(proto); warm(readP, o); full(); const before = readP(o); proto.p = "late"; const after = readP(o); delete proto.p; return before + "," + after + "," + readP(o); });

say("deleted and put back", () => { const o: any = { a: 1, p: "first", b: 2 }; warm(readP, o); full(); warm(readP, o); delete o.p; const gone = readP(o); o.p = "second"; return gone + "," + readP(o) + "," + warm(readP, o); });
say("deleted, and another takes its place", () => { const o: any = { p: "p", z: "z" }; warm(readP, o); full(); warm(readP, kept[1]); warm(readP, o); delete o.p; o.y = "y"; const gone = readP(o); o.p = "back"; return gone + "," + readP(o) + "," + o.y + "," + o.z; });
say("a dictionary", () => { const o: any = {}; for (let i = 0; i < 200; i++) o["d" + i] = i; o.p = "in a dictionary"; for (let i = 0; i < 150; i++) delete o["d" + i]; warm(readP, o); full(); warm(readP, kept[0]); const a = warm(readP, o); delete o.p; o.fresh = "not p"; const b = readP(o); o.p = "again"; return a + "," + b + "," + readP(o); });
say("a small dictionary", () => { const o: any = { a: 1, p: "small", b: 2 }; delete o.a; warm(readP, o); full(); warm(readP, kept[2]); const a = warm(readP, o); delete o.p; o.c = "not p"; o.d = "nor this"; return a + "," + readP(o) + "," + warm(readP, o); });
say("value, then getter, then value", () => { const o: any = { a: 1, p: "value" }; warm(readP, o); full(); warm(readP, kept[3]); const a = warm(readP, o); Object.defineProperty(o, "p", { get: () => "getter", configurable: true }); const b = warm(readP, o); Object.defineProperty(o, "p", { value: "value again", configurable: true }); return a + "," + b + "," + warm(readP, o); });
say("made read-only", () => { const o: any = { p: "rw", a: 1 }; warm(readP, o); full(); warm(readP, o); Object.defineProperty(o, "p", { writable: false }); return warm(readP, o) + "," + readP(kept[0]) + "," + readP(o); });
say("frozen afterwards", () => { const o: any = { a: 1, b: 2, p: "thawed" }; warm(readP, o); full(); warm(readP, kept[4]); warm(readP, o); Object.freeze(o); return warm(readP, o); });
say("given another prototype", () => { const o: any = { a: 1 }; warm(readP, o); full(); warm(readP, o); Object.setPrototypeOf(o, { p: "from the new one" }); const a = warm(readP, o); Object.setPrototypeOf(o, null); return a + "," + warm(readP, o); });
say("own hides inherited", () => { const proto = { p: "inherited" }; const o: any = Object.create(proto); const a = warm(readP, o); full(); o.p = "own"; const b = warm(readP, o); full(); warm(readP, kept[5]); const c = warm(readP, o); delete o.p; return a + "," + b + "," + c + "," + warm(readP, o); });
say("written between reads", () => { const o: any = { a: 1, p: 0 }; const other: any = { p: -1 }; warm(readP, o); warm(readP, other); full(); let bad = 0; for (let i = 0; i < 2000; i++) { o.p = i; other.p = -i; if (readP(o) !== i || readP(other) !== -i) bad++; } return bad; });

const shaped = (tag: string, n: number, v: unknown) => { const o: any = {}; for (let i = 0; i < n; i++) o[tag + i] = i; o.p = v; return o; };
say("structures that come and go, young collections", () => { let bad = 0; for (let round = 0; round < 60; round++) { const o = shaped("y" + round + "_", round % 5, "r" + round); for (let i = 0; i < 40; i++) if (readP(o) !== "r" + round) bad++; if (readP(kept[round % kept.length]) !== "v" + (round % kept.length)) bad++; young(); } return bad; });
say("structures that come and go, full collections", () => { let bad = 0; for (let round = 0; round < 40; round++) { const o = shaped("f" + round + "_", round % 5, "r" + round); for (let i = 0; i < 40; i++) if (readP(o) !== "r" + round) bad++; full(); for (let i = 0; i < 40; i++) if (readP(o) !== "r" + round) bad++; if (readP(kept[round % kept.length]) !== "v" + (round % kept.length)) bad++; } return bad; });
say("old ones that die while the slot has them", () => {
  let bad = 0;
  for (let round = 0; round < 30; round++) {
    let a: any = shaped("oa" + round + "_", 1 + (round % 4), "a" + round), b: any = shaped("ob" + round + "_", round % 3, "b" + round);
    warm(readP, a, 50); warm(readP, b, 50); full();
    for (let i = 0; i < 20; i++) { if (readP(a) !== "a" + round) bad++; if (readP(b) !== "b" + round) bad++; }
    a = b = null; full(); full();
    for (let k = 0; k < 8; k++) { const c = shaped("oc" + round + "_" + k + "_", (k + round) % 6, "c" + k); if (readP(c) !== "c" + k) bad++; if (readQ(c) !== undefined) bad++; }
  }
  return bad;
});
say("many at once, most of which die", () => { let bad = 0; for (let round = 0; round < 10; round++) { let all: any[] = []; for (let k = 0; k < 300; k++) all.push(shaped("m" + round + "_" + k + "_", k % 7, k)); for (const pass of [0, 1]) { for (let k = 0; k < all.length; k++) if (readP(all[k]) !== k) bad++; if (!pass) full(); } all = all.filter((_, k) => k % 50 === 0); full(); for (const o of all) if (typeof readP(o) !== "number") bad++; young(); } return bad; });

const lengths: any[] = [[1, 2, 3], "four", { length: 5 }, { a: 1, length: 6 }, function (_a: any, _b: any) { }, new Uint8Array(7), { get length() { return 8; } }, Object.create({ length: 9 }), new String("ten chars!"), (function (..._x: any[]) { return arguments; })(1, 2)];
say("length, first", () => sweep(readLength, lengths));
for (const o of lengths) warm(readLength, o);
full();
say("length, once they are old", () => { const r: string[] = []; for (let i = 0; i < 30; i++) r.push(sweep(readLength, lengths)); return new Set(r).size + " " + r[0]; });
say("length of an array that grows", () => { const a: any[] = []; const o = { length: "mine" }; let bad = 0; for (let i = 0; i < 500; i++) { if (readLength(a) !== i) bad++; if (readLength(o) !== "mine") bad++; a.push(i); } return bad; });
const names: any[] = [function named() { }, { name: "plain" }, class Klass { }, new Error("x"), { a: 1, name: "second" }, () => { }, Symbol, Object.assign(function over() { }, { extra: 1 })];
for (const o of names) warm(readName, o);
full();
say("name", () => { const r: string[] = []; for (let i = 0; i < 30; i++) r.push(sweep(readName, names)); return new Set(r).size + " " + r[0]; });

const odd: any[] = [1, "s", true, 1n, Symbol.iterator, 1.5, { p: "object" }, { a: 1, p: "another" }];
say("not objects", () => { (Number.prototype as any).q = "number"; (String.prototype as any).q = "string"; try { const r: string[] = []; const list = [...odd, { q: "own" }, { a: 1, q: "own too" }]; for (const o of list) warm(readQ, o, 50); full(); for (let i = 0; i < 20; i++) r.push(list.map(o => String(readQ(o))).join()); return new Set(r).size + " " + r[0]; } finally { delete (Number.prototype as any).q; delete (String.prototype as any).q; } });
say("null and undefined", () => { const r: string[] = []; for (const o of [{ p: 1 }, null, { a: 1, p: 2 }, undefined, { p: 3 }]) { try { r.push(String(readP(o))); } catch (e: any) { r.push(e.name); } } return r.join(); });

const deep = kept.filter((_, i) => i < 9).map((o, i) => (i % 2 ? { inner: o } : { pad: 0, inner: o }));
for (const o of deep) warm(readDeep, o);
full();
say("one level down", () => { const r: string[] = []; for (let i = 0; i < 30; i++) r.push(sweep(readDeep, deep)); return new Set(r).size + " " + r[0]; });
say("in a loop that a collection happens in", () => { let bad = 0; const list = kept.slice(0, 9); for (let i = 0; i < 3000; i++) { const k = (i * 7) % list.length; if (list[k].p !== "v" + k) bad++; if (i % 500 === 250) young(); if (i % 1000 === 999) full(); } return bad; });
say("with garbage made all the while", () => { let bad = 0, keep: any[] = []; for (let i = 0; i < 20000; i++) { const k = i % 9; if (readP(kept[k]) !== "v" + k) bad++; keep.push({ ["g" + (i % 97)]: i, p: i }); if (readP(keep[keep.length - 1]) !== i) bad++; if (keep.length > 50) keep = []; } return bad; });

function readM(o: any) { return o.m; }
function callM(o: any) { return o.m(); }
function readG(o: any) { return o.g; }
{
  const protoA: any = { m: "A" }, protoB: any = { m: "B" }, protoC: any = {}, protoD: any = { m: "D" };
  const a = Object.create(protoA), b = Object.create(protoB), c = Object.create(protoC), d = Object.create(protoD), own: any = { m: "own" }, far = Object.create(Object.create(protoA));
  const all = [a, b, c, d, own, far];
  const round = () => all.map(o => String(readM(o))).join();
  say("several, inherited: first", round);
  for (let i = 0; i < 40; i++) round();
  full();
  say("several, inherited: settled", () => { const r = new Set<string>(); for (let i = 0; i < 50; i++) r.add(round()); return r.size + " " + round(); });
  say("one of what they inherit from is written", () => { protoA.m = "A2"; const x = round(); protoA.m = "A"; return x + ";" + round(); });
  say("one loses it", () => { delete protoB.m; const x = round(); protoB.m = "B again"; return x + ";" + round(); });
  say("one that had none gets it", () => { protoC.m = "C at last"; const x = round(); delete protoC.m; return x + ";" + round(); });
  say("it is hidden in one object", () => { d.m = "hidden"; const x = round(); delete d.m; return x + ";" + round(); });
  say("it becomes a getter in one", () => { Object.defineProperty(protoD, "m", { get() { return "got"; }, configurable: true }); const x = round(); for (let i = 0; i < 30; i++) round(); const y = round(); Object.defineProperty(protoD, "m", { value: "D", writable: true, configurable: true }); return x + ";" + y + ";" + round(); });
  say("something comes in between", () => { const between: any = { m: "between" }; Object.setPrototypeOf(far, between); const x = round(); Object.setPrototypeOf(far, Object.create(protoA)); return x + ";" + round(); });
  say("Object.prototype gets it", () => { (Object.prototype as any).m = "everyone"; try { return round() + ";" + readM({}) + ";" + readM([]); } finally { delete (Object.prototype as any).m; } });
  say("and loses it", () => round() + ";" + readM({}) + ";" + readM([]));
  young(); full();
  say("after collections", round);
}
{
  class P { m() { return "P"; } } class Q { m() { return "Q"; } } class R extends P { } class T extends P { m() { return "T" + super.m(); } } class U { m = () => "U"; }
  const list: any[] = [new P(), new Q(), new R(), new T(), new U(), { m() { return "literal"; } }, { m: () => "arrow" }];
  const round = () => list.map(o => callM(o)).join();
  for (let i = 0; i < 40; i++) round();
  full();
  say("methods of seven kinds", () => { const r = new Set<string>(); for (let i = 0; i < 60; i++) r.add(round()); return r.size + " " + round(); });
  say("a method is replaced", () => { const was = P.prototype.m; P.prototype.m = function () { return "P2"; }; const x = round(); P.prototype.m = was; return x + ";" + round(); });
  say("a method is given to one object", () => { list[0].m = () => "mine"; const x = round(); delete list[0].m; return x + ";" + round(); });
  say("in every order", () => { let seed = 11, bad = 0; const want = list.map(o => o.m()); for (let i = 0; i < 8000; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; const k = seed % list.length; if (callM(list[k]) !== want[k]) bad++; } return bad; });
}
{
  let calls = 0;
  const g1 = { get g() { calls++; return "g1"; } }, g2 = Object.create({ get g() { calls++; return "g2"; } }), g3 = { a: 1, get g() { calls++; return "g3"; } }, v = { g: "value" }, none = { z: 1 }, thrower = { get g(): string { throw new RangeError("from a getter"); } };
  const list: any[] = [g1, g2, g3, v, none];
  const round = () => list.map(o => String(readG(o))).join();
  for (let i = 0; i < 40; i++) round();
  full();
  say("getters among several", () => { calls = 0; const r = new Set<string>(); for (let i = 0; i < 50; i++) r.add(round()); return r.size + " " + round() + " " + calls; });
  say("a getter that throws, among them", () => { const r: string[] = []; for (let i = 0; i < 6; i++) { try { r.push(readG(i % 2 ? thrower : g1)); } catch (e: any) { r.push(e.name); } } return r.join(); });
  say("this in a getter", () => { const p = { get g() { return (this as any).tag; } }; const x = Object.assign(Object.create(p), { tag: "x" }), y = Object.assign(Object.create(p), { pad: 0, tag: "y" }); const r: string[] = []; for (let i = 0; i < 40; i++) r.push(readG(x) + readG(y) + readG(v)); return new Set(r).size + " " + r[0]; });
}
say("more than it can remember, round and round", () => { const many = Array.from({ length: 11 }, (_, k) => shaped("w" + k + "_", k % 6, "w" + k)); for (const o of many) warm(readP, o, 20); full(); let bad = 0; for (let i = 0; i < 6000; i++) { const k = i % many.length; if (readP(many[k]) !== "w" + k) bad++; } return bad; });
say("what it remembers dies, all of it", () => { let bad = 0; for (let round = 0; round < 25; round++) { let four: any[] = [0, 1, 2, 3].map(k => shaped("q" + round + "_" + k + "_", k + 1, k)); for (let i = 0; i < 60; i++) for (let k = 0; k < 4; k++) if (readQ2(four[k]) !== k) bad++; four = []; full(); const next = [0, 1, 2, 3, 4, 5].map(k => shaped("n" + round + "_" + k + "_", (k * 5) % 7, "n" + k)); for (let i = 0; i < 10; i++) for (let k = 0; k < 6; k++) if (readQ2(next[k]) !== "n" + k) bad++; } return bad; });
function readQ2(o: any) { return o.p; }
say("holders that die", () => { let bad = 0; for (let round = 0; round < 25; round++) { let objects: any[] = [0, 1, 2].map(k => Object.create({ ["pad" + round + k]: 0, h: "h" + k })); for (let i = 0; i < 50; i++) for (let k = 0; k < 3; k++) if (readH(objects[k]) !== "h" + k) bad++; objects = []; full(); young(); if (readH({ h: "plain" }) !== "plain" || readH({}) !== undefined) bad++; } return bad; });
function readH(o: any) { return o.h; }

console.log(out.join("\n"));
console.log(out.length + " said");
if (process.env.BUN_HEAP_CENSUS) (await import("bun:jsc")).heapStats();
