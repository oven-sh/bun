// A plain object that something else also holds is handed, as `any`, to a place of a record type that has more fields than the object has room for. It gives every required field, so it satisfies the type. It cannot become the record where it lies, and a copy would be another object: so it stays as it is and is read by name. Both holders go on seeing one object. By what the record holds, and by every road into the type.
class Point { x = 1; }
interface Inner { k: number; f: () => number }
interface Data { a: number; b: number[]; c: string; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number }
interface Fn { a: () => number; b: number[]; c: string; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number }
interface Mapped { a: Map<string, number>; b: number[]; c: string; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number }
interface Dated { a: Date; b: number[]; c: string; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number }
interface Pointed { a: Point; b: number[]; c: string; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number }
interface Matched { a: RegExp; b: number[]; c: string; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number }
interface Promised { a: Promise<number>; b: number[]; c: string; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number }
interface Nested { a: Inner; b: number[]; c: string; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number }
interface Fns { a: (() => number)[]; b: number[]; c: string; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number }
interface Anything { a: any; b: number[]; c: string; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number }
interface Unknown { a: unknown; b: number[]; c: string; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number }
interface Method { a: number; m(): number; b: number[]; c: string; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number }
function attempt(name: string, f: () => string): void { try { console.log(name, f()); } catch (e) { console.log(name, (e as Error).name + ": " + (e as Error).message.split("\n")[1]?.trim().slice(0, 110)); } }
const kept: any[] = [];
function showData(h: Data): string { return h.c + h.b.length + (h.o10 ?? "-"); }
const knownData: Data = { a: 1, b: [1], c: "k", o1: 1, o2: 2, o3: 3, o4: 4, o5: 5, o6: 6, o7: 7, o8: 8, o9: 9, o10: 10 };
attempt("Data:", () => { const h: any = { a: 1, b: [1, 2], c: "s" }; kept.push(h); const before = showData(h); h.c = "t"; return showData(knownData) + " " + before + " " + showData(h) + " " + Object.keys(h).join(); });
function showFn(h: Fn): string { return h.c + h.b.length + (h.o10 ?? "-"); }
const knownFn: Fn = { a: () => 1, b: [1], c: "k", o1: 1, o2: 2, o3: 3, o4: 4, o5: 5, o6: 6, o7: 7, o8: 8, o9: 9, o10: 10 };
attempt("Fn:", () => { const h: any = { a: () => 2, b: [1, 2], c: "s" }; kept.push(h); const before = showFn(h); h.c = "t"; return showFn(knownFn) + " " + before + " " + showFn(h) + " " + Object.keys(h).join(); });
function showMapped(h: Mapped): string { return h.c + h.b.length + (h.o10 ?? "-"); }
const knownMapped: Mapped = { a: new Map(), b: [1], c: "k", o1: 1, o2: 2, o3: 3, o4: 4, o5: 5, o6: 6, o7: 7, o8: 8, o9: 9, o10: 10 };
attempt("Mapped:", () => { const h: any = { a: new Map([["k", 1]]), b: [1, 2], c: "s" }; kept.push(h); const before = showMapped(h); h.c = "t"; return showMapped(knownMapped) + " " + before + " " + showMapped(h) + " " + Object.keys(h).join(); });
function showDated(h: Dated): string { return h.c + h.b.length + (h.o10 ?? "-"); }
const knownDated: Dated = { a: new Date(0), b: [1], c: "k", o1: 1, o2: 2, o3: 3, o4: 4, o5: 5, o6: 6, o7: 7, o8: 8, o9: 9, o10: 10 };
attempt("Dated:", () => { const h: any = { a: new Date(5), b: [1, 2], c: "s" }; kept.push(h); const before = showDated(h); h.c = "t"; return showDated(knownDated) + " " + before + " " + showDated(h) + " " + Object.keys(h).join(); });
function showPointed(h: Pointed): string { return h.c + h.b.length + (h.o10 ?? "-"); }
const knownPointed: Pointed = { a: new Point(), b: [1], c: "k", o1: 1, o2: 2, o3: 3, o4: 4, o5: 5, o6: 6, o7: 7, o8: 8, o9: 9, o10: 10 };
attempt("Pointed:", () => { const h: any = { a: new Point(), b: [1, 2], c: "s" }; kept.push(h); const before = showPointed(h); h.c = "t"; return showPointed(knownPointed) + " " + before + " " + showPointed(h) + " " + Object.keys(h).join(); });
function showMatched(h: Matched): string { return h.c + h.b.length + (h.o10 ?? "-"); }
const knownMatched: Matched = { a: /x/, b: [1], c: "k", o1: 1, o2: 2, o3: 3, o4: 4, o5: 5, o6: 6, o7: 7, o8: 8, o9: 9, o10: 10 };
attempt("Matched:", () => { const h: any = { a: /y/, b: [1, 2], c: "s" }; kept.push(h); const before = showMatched(h); h.c = "t"; return showMatched(knownMatched) + " " + before + " " + showMatched(h) + " " + Object.keys(h).join(); });
function showPromised(h: Promised): string { return h.c + h.b.length + (h.o10 ?? "-"); }
const knownPromised: Promised = { a: Promise.resolve(1), b: [1], c: "k", o1: 1, o2: 2, o3: 3, o4: 4, o5: 5, o6: 6, o7: 7, o8: 8, o9: 9, o10: 10 };
attempt("Promised:", () => { const h: any = { a: Promise.resolve(2), b: [1, 2], c: "s" }; kept.push(h); const before = showPromised(h); h.c = "t"; return showPromised(knownPromised) + " " + before + " " + showPromised(h) + " " + Object.keys(h).join(); });
function showNested(h: Nested): string { return h.c + h.b.length + (h.o10 ?? "-"); }
const knownNested: Nested = { a: { k: 1, f: () => 2 }, b: [1], c: "k", o1: 1, o2: 2, o3: 3, o4: 4, o5: 5, o6: 6, o7: 7, o8: 8, o9: 9, o10: 10 };
attempt("Nested:", () => { const h: any = { a: { k: 3, f: () => 4 }, b: [1, 2], c: "s" }; kept.push(h); const before = showNested(h); h.c = "t"; return showNested(knownNested) + " " + before + " " + showNested(h) + " " + Object.keys(h).join(); });
function showFns(h: Fns): string { return h.c + h.b.length + (h.o10 ?? "-"); }
const knownFns: Fns = { a: [() => 1], b: [1], c: "k", o1: 1, o2: 2, o3: 3, o4: 4, o5: 5, o6: 6, o7: 7, o8: 8, o9: 9, o10: 10 };
attempt("Fns:", () => { const h: any = { a: [() => 2, () => 3], b: [1, 2], c: "s" }; kept.push(h); const before = showFns(h); h.c = "t"; return showFns(knownFns) + " " + before + " " + showFns(h) + " " + Object.keys(h).join(); });
function showAnything(h: Anything): string { return h.c + h.b.length + (h.o10 ?? "-"); }
const knownAnything: Anything = { a: 1, b: [1], c: "k", o1: 1, o2: 2, o3: 3, o4: 4, o5: 5, o6: 6, o7: 7, o8: 8, o9: 9, o10: 10 };
attempt("Anything:", () => { const h: any = { a: "x", b: [1, 2], c: "s" }; kept.push(h); const before = showAnything(h); h.c = "t"; return showAnything(knownAnything) + " " + before + " " + showAnything(h) + " " + Object.keys(h).join(); });
function showUnknown(h: Unknown): string { return h.c + h.b.length + (h.o10 ?? "-"); }
const knownUnknown: Unknown = { a: 1, b: [1], c: "k", o1: 1, o2: 2, o3: 3, o4: 4, o5: 5, o6: 6, o7: 7, o8: 8, o9: 9, o10: 10 };
attempt("Unknown:", () => { const h: any = { a: "y", b: [1, 2], c: "s" }; kept.push(h); const before = showUnknown(h); h.c = "t"; return showUnknown(knownUnknown) + " " + before + " " + showUnknown(h) + " " + Object.keys(h).join(); });
function showMethod(h: Method): string { return h.c + h.b.length + h.m(); }
const knownMethod: Method = { a: 1, m() { return 2; }, b: [1], c: "k", o1: 1, o2: 2, o3: 3, o4: 4, o5: 5, o6: 6, o7: 7, o8: 8, o9: 9, o10: 10 };
attempt("Method:", () => { const h: any = { a: 1, m() { return 3; }, b: [1, 2], c: "s" }; kept.push(h); return showMethod(knownMethod) + " " + showMethod(h); });
attempt("filled by typed code:", () => { const h: any = { a: () => 5, b: [], c: "u" }; kept.push(h); const held: Fn = h; held.o10 = 10; held.o1 = 1; return showFn(held) + " " + Object.keys(h).join() + " " + h.o10 + " " + String((held as unknown) === kept[kept.length - 1]); });
interface Circle { kind: "circle"; r: () => number; list: number[]; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number }
interface Square { kind: "square"; s: () => number; list: number[]; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number }
function area(x: Circle | Square): string { return x.kind === "circle" ? "c" + x.r() : "s" + x.s(); }
const circle: Circle = { kind: "circle", r: () => 1, list: [], o1: 1, o2: 2, o3: 3, o4: 4, o5: 5, o6: 6, o7: 7, o8: 8, o9: 9, o10: 10 }; const square: Square = { kind: "square", s: () => 2, list: [], o1: 1, o2: 2, o3: 3, o4: 4, o5: 5, o6: 6, o7: 7, o8: 8, o9: 9, o10: 10 };
attempt("a union told apart by a constant:", () => { const h: any = { kind: "circle", r: () => 3, list: [1] }; kept.push(h); const g: any = { kind: "square", s: () => 4, list: [1] }; kept.push(g); return area(circle) + area(square) + area(h) + area(g); });
interface Round { r: () => number; list: number[]; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number }
interface Sided { s: () => number; list: number[]; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number }
function size(x: Round | Sided): string { return "r" in x ? "r" + x.r() : "s" + x.s(); }
const round: Round = { r: () => 1, list: [], o1: 1, o2: 2, o3: 3, o4: 4, o5: 5, o6: 6, o7: 7, o8: 8, o9: 9, o10: 10 }; const sided: Sided = { s: () => 2, list: [], o1: 1, o2: 2, o3: 3, o4: 4, o5: 5, o6: 6, o7: 7, o8: 8, o9: 9, o10: 10 };
attempt("a union told apart by a member:", () => { const h: any = { r: () => 3, list: [1] }; kept.push(h); const g: any = { s: () => 4, list: [1] }; kept.push(g); return size(round) + size(sided) + size(h) + size(g); });
class Impl implements Fn { a = () => 1; b: number[] = []; c = "i"; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number }
attempt("a type that a class implements:", () => { const h: any = { a: () => 3, b: [1], c: "p" }; kept.push(h); return showFn(new Impl()) + " " + showFn(h); });
interface Box<T> { a: () => T; list: T[]; o1?: number; o2?: number; o3?: number; o4?: number; o5?: number; o6?: number; o7?: number; o8?: number; o9?: number; o10?: number }
function showBox<T>(h: Box<T>): string { return "" + h.a() + h.list.length; }
const box: Box<number> = { a: () => 0, list: [], o1: 1, o2: 2, o3: 3, o4: 4, o5: 5, o6: 6, o7: 7, o8: 8, o9: 9, o10: 10 };
attempt("a generic record:", () => { const h: any = { a: () => 3, list: [1] }; kept.push(h); return showBox(box) + " " + showBox<number>(h); });
class Keeper { host: Fn | null = null; }
attempt("a field:", () => { const keeper = new Keeper(); keeper.host = knownFn; const h: any = { a: () => 3, b: [1], c: "f" }; kept.push(h); keeper.host = h; h.c = "g"; return showFn(keeper.host!) + " " + String((keeper.host as unknown) === h); });
interface Outer { name: string; inner: Fn }
function showOuter(o: Outer): string { return o.name + showFn(o.inner); }
const outer: Outer = { name: "k", inner: knownFn };
attempt("below another record:", () => { const inner: any = { a: () => 3, b: [1], c: "n" }; kept.push(inner); const o: any = { name: "o", inner }; kept.push(o); const before = showOuter(o); inner.c = "m"; return showOuter(outer) + " " + before + " " + showOuter(o); });
function showAll(all: Fn[]): string { return all.map(showFn).join(); }
attempt("an element:", () => { const h: any = { a: () => 3, b: [1], c: "e" }; kept.push(h); const all: any = [h, knownFn]; return showAll(all); });
function give(x: any): Fn { return x; }
attempt("a result:", () => { const h: any = { a: () => 3, b: [1], c: "r" }; kept.push(h); return showFn(give(h)) + " " + String((give(h) as unknown) === h); });
attempt("again and again:", () => { const h: any = { a: () => 3, b: [1], c: "z" }; kept.push(h); let out = 0; for (let i = 0; i < 1000; i++) out += showFn(h).length; return String(out); });
