// `for..of`, spread and destructuring over strings whose static type is not `string`, and over iterators with ordinary and unusual result objects.
const print = (s: string) => console.log(s);
function show(x: unknown): string {
    if (typeof x !== "string")
        return Object.is(x, -0) ? "-0" : String(x);
    let out = '"';
    for (let i = 0; i < x.length; i++) {
        const c = x.charCodeAt(i);
        out += c >= 32 && c < 127 ? x[i] : "\\u" + (c + 0x10000).toString(16).slice(1);
    }
    return out + '"';
}
function attempt(f: () => unknown): string {
    try {
        return show(f());
    } catch (e) {
        return "throws " + (e as Error).name;
    }
}
function cat(a: string, b: string): string { return a + b; }
function cat3(a: string, b: string, c: string): string { return `${a}${b}${c}`; }
function part(s: string, from: number, to: number): string { return s.slice(from, to); }
function flattened(s: string): string { s.charCodeAt(0); return s; }
function units(s: string): string { let out = ""; for (let i = 0; i < s.length; i++) out += (i ? "." : "") + s.charCodeAt(i).toString(16); return out; }
export function walk(x: any): string { let out = ""; for (const c of x) out += "[" + units(c) + "]"; return out; }
export function walkTyped(x: string): string { let out = ""; for (const c of x) out += "[" + units(c) + "]"; return out; }
export function firstTwo(x: any): string { let n = 0, out = ""; for (const c of x) { out += units(c) + ","; if (++n === 2) break; } return out; }
export function nested(x: any, y: any): number { let n = 0; for (const a of x) for (const b of y) if (a === b) n++; return n; }
export function spread(x: any): string { return [...x].map(units).join("|"); }
export function destructured(x: any): string { const [a, b = "default", ...rest] = x; return String(a === undefined ? a : units(a)) + "/" + units(b) + "/" + rest.length; }
export function returned(x: any): string { for (const c of x) if (c !== "a") return units(c); return "none"; }
export function thrown(x: any): string { try { for (const c of x) if (c === "b") throw new Error("at " + c); return "through"; } catch (e) { return (e as Error).message; } }
const strings = ["", "a", "ab", "abc", "café", "ÿĀ", "日本語", "\u{1f600}", "a\u{1f600}b", "\u{1f44d}\u{1f3fd}", "\ud83d", "\ude00", "\ud83d😀", "\ude00\ud83d", "x\ud83d", "\ud83dx", "é", cat("ab", "cd"), cat3("\u{1f600}", "b", "日"), cat("\ud83d", "\ude00"), part("xxabcdefxx", 2, 8), part("日\u{1f600}本", 1, 3), part("日\u{1f600}本", 2, 4), flattened(cat("ab", "\u{1f680}")), "a".repeat(300)];
for (const s of strings) print(units(s).slice(0, 40) + ": " + (walk(s) === walkTyped(s) ? "same" : "TYPED DIFFERS") + " " + walk(s).slice(0, 90) + " " + firstTwo(s) + " " + spread(s).slice(0, 60) + " " + destructured(s) + " " + returned(s) + " " + thrown(s));
print("nested " + nested("abcabc", "cab") + " " + nested("\u{1f600}\u{1f600}", "x\u{1f600}") + " " + nested("", "abc") + " " + nested(cat("ab", "ab"), part("zzabzz", 2, 4)));
// A String object finds the same method, but is not a string.
print(walk(new String("a\u{1f600}")) + " " + walk(Object("xy")) + " " + attempt(() => walk(5)) + " " + attempt(() => walk(undefined)) + " " + attempt(() => walk({})) + " " + attempt(() => walk(Symbol.iterator)));
// The string's own iterator, taken by hand and handed on half used.
{ const it = "ab\u{1f600}c"[Symbol.iterator](); const first = it.next(); print(units(first.value as string) + " " + first.done + " " + walk(it) + " " + JSON.stringify(it.next())); }
// Results as JavaScriptCore makes them, handed through by an iterator of the program; and results that are not.
const log: string[] = [];
function through(inner: Iterator<any>): any { return { [Symbol.iterator]() { return this; }, next() { log.push("next"); return inner.next(); }, return() { log.push("return"); return {}; } }; }
function collect(x: any, most = 100): string { const out: string[] = []; for (const v of x) { out.push(typeof v === "string" ? units(v) : JSON.stringify(v) ?? String(v)); if (out.length === most) break; } return out.join(","); }
function* generated(): Generator<any> { yield 1; yield "a"; yield undefined; yield [2]; return 9; }
print(collect(through("a\u{1f600}"[Symbol.iterator]())) + " " + collect(through([1, , 3][Symbol.iterator]())) + " " + collect(through(new Map([[1, 2]])[Symbol.iterator]())) + " " + collect(through(new Set(["x"]).values())) + " " + collect(through(generated())) + " " + collect(through([1, 2, 3].values()), 2) + " " + log.join());
function made(results: any[]): any { let i = 0; return { [Symbol.iterator]() { return this; }, next() { return results[i++]; } }; }
function watched(value: any, done: any): any { return { get done() { log.push("done"); return done; }, get value() { log.push("value"); return value; } }; }
log.length = 0;
print(collect(made([watched(1, false), watched(2, 0), watched(3, ""), watched(4, null), watched(5, NaN), watched(6, "yes"), watched(7, false)])) + " " + log.join());
print(collect(made([{ value: 1 }, { value: 2, done: undefined }, { done: false }, {}, Object.freeze({ value: 5, done: false }), { done: false, value: 6 }, { value: 7, done: false, extra: 1 }, Object.create({ value: 8, done: false }), [], () => 1, { value: 9, done: {} }])));
for (const bad of [undefined, null, 1, "s", true, Symbol()]) print(attempt(() => collect(made([{ value: 1, done: false }, bad]))));
// An engine-made result that the program has changed since.
function changed(change: (r: any) => void): any { const inner = [10, 20, 30].values(); return { [Symbol.iterator]() { return this; }, next() { const r = inner.next(); if (!r.done) change(r); return r; } }; }
log.length = 0;
print(collect(changed(r => { r.value++; })) + " " + collect(changed(r => { r.done = r.value === 20; })) + " " + collect(changed(r => { delete r.value; })) + " " + collect(changed(r => { delete r.done; })) + " " + collect(changed(r => { Object.defineProperty(r, "value", { get() { log.push("got"); return "g"; } }); })) + " " + collect(changed(r => { r.more = 1; })) + " " + collect(changed(r => { Object.setPrototypeOf(r, null); })) + " " + collect(changed(r => { Object.freeze(r); })) + " " + log.join());
if (typeof Intl === "object" && typeof (Intl as any).Segmenter === "function") {
    const segmenter = new (Intl as any).Segmenter();
    let out = ""; for (const { segment, index } of segmenter.segment("a\u{1f44d}\u{1f3fd}é\r\n日")) out += index + ":" + units(segment) + " ";
    print(out + collect(through(segmenter.segment("ab")[Symbol.iterator]())).length);
}
(globalThis as any).kept = [walk, walkTyped, firstTwo, nested, spread, destructured, returned, thrown]; console.log("number");
