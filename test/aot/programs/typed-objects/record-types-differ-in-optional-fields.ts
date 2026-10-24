// Objects of record types that differ only in their optional fields are read and written through one of the types.
type L = { a: number; n?: string };
type V = { a: number; m?: string };
type W = { a: number; k?: string; m?: string };
function makeL(i: number): L { return { a: i, n: "the value of n" }; }
function makeV(i: number): V { return { a: i, m: "the value of m" }; }
function makeW(i: number): W { return { a: i, k: "the value of k" }; }
function readM(v: V): string | undefined { return v.m; }
function readN(l: L): string | undefined { return l.n; }
function hasM(v: V): boolean { return v.m !== undefined; }
function writeM(v: V, s: string): void { v.m = s; }
const say = (what: string, got: unknown) => console.log(what + ": " + String(got));
const l = makeL(1), v = makeV(2), w = makeW(3);
say("m of an L", readM(l));
say("m of a V", readM(v));
say("m of a W", readM(w));
say("n of an L", readN(l));
say("an L has m", hasM(l));
say("keys of an L", Object.keys(l).join());
writeM(l, "written as m");
say("n of an L that m was written to", readN(l));
say("m of an L that m was written to", readM(l));
say("keys of it", Object.keys(l).join());
say("as JSON", JSON.stringify(l));
const all: V[] = [];
for (let i = 0; i < 6; i++) all.push(i % 3 === 0 ? makeL(i) : i % 3 === 1 ? makeV(i) : makeW(i));
let seen = "";
for (const x of all) seen += (x.m === undefined ? "-" : "m");
say("which of the mixture have m", seen);
type Wide = { f0: number; f1?: string; f2?: number; f3?: string; f4?: number; f5?: string; f6?: number; f7?: string; f8?: number; f9?: string; f10?: number; f11?: string; f12?: number; f13?: string };
function makeWide(i: number): Wide { return { f0: i, f1: "one", f2: 2, f3: "three", f4: 4, f5: "five", f6: 6, f7: "seven", f8: 8, f9: "nine", f10: 10, f11: "eleven", f12: 12, f13: "thirteen" }; }
function makeSparse(i: number): Wide { return { f0: i, f9: "only nine", f12: 120 }; }
function readWide(w: Wide): string { return [w.f0, w.f1, w.f2, w.f3, w.f4, w.f5, w.f6, w.f7, w.f8, w.f9, w.f10, w.f11, w.f12, w.f13].map(String).join(); }
function writeWide(w: Wide): void { w.f8 = 88; w.f13 = "written"; w.f11 = undefined; }
const wideFromOutside = JSON.parse('{"f13":"thirteen from outside","f0":5,"f8":80,"f3":"three from outside","f11":"eleven from outside"}') as Wide;
const wides: Wide[] = [makeWide(1), makeSparse(2), wideFromOutside, makeWide(3), makeSparse(4)];
for (const w of wides) say("a wide object", readWide(w));
let sum = 0, text = "";
for (const w of wides) { sum += (w.f8 ?? 0) + (w.f12 ?? 0) + (w.f10 ?? 0); text += (w.f9 ?? "-") + (w.f13 ?? "-") + ";"; }
say("sum over the wide objects", sum);
say("text over the wide objects", text);
for (const w of wides) writeWide(w);
for (const w of wides) say("after writing", readWide(w) + " " + Object.keys(w).join());
delete wides[0]!.f9;
say("after deleting f9", readWide(wides[0]!) + " " + JSON.stringify(wides[0]));
export {};
