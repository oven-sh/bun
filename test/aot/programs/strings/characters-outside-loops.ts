// `s[i]`, `charAt`, `at` and `charCodeAt` inside and outside loops, on every internal representation of a string and with every kind of index.
// CALLS- startsWithSlash StringEqualsLiteral|StringHasAt|(^|[ f])TypedString(;|$)
// CALLS+ endsWithNewline tests for equality with [0-9 ]*\b10\b
// CALLS- byIndex Flatten
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
export function byIndex(s: string, i: number): string | undefined { return s[i]; }
export function byCharAt(s: string, i: number): string { return s.charAt(i); }
export function byAt(s: string, i: number): string | undefined { return s.at(i); }
export function byCharCodeAt(s: string, i: number): number { return s.charCodeAt(i); }
export function byCodePointAt(s: string, i: number): number | undefined { return s.codePointAt(i); }

export function first(s: string): string { return s[0] + "|" + s.charAt(0) + "|" + s.at(0) + "|" + s.charCodeAt(0); }
export function last(s: string): string { return s[s.length - 1] + "|" + s.charAt(s.length - 1) + "|" + s.at(-1) + "|" + s.charCodeAt(s.length - 1); }
export function startsWithSlash(s: string): boolean { return s[0] === "/"; }
export function endsWithNewline(s: string): boolean { return s.at(-1) === "\n"; }
export function isDigitAt(s: string, i: number): boolean { const c = s.charCodeAt(i); return c >= 48 && c <= 57; }
export function sameAt(a: string, b: string, i: number): string { return "" + Number(a[i] === b[i]) + Number(a.charAt(i) === b.charAt(i)) + Number(a.charCodeAt(i) === b.charCodeAt(i)) + Number(a.at(i) === b.at(i)); }
export function untyped(s: any, i: any): any { return [s[i], s.charAt(i), s.at(i), s.charCodeAt(i)].join("|"); }
export function byInteger(s: string, i: number): string { const j = i | 0; return s[j] + "|" + s.charAt(j) + "|" + s.at(j) + "|" + s.charCodeAt(j); }
export function recorded(s: string): { a: number; b: string; c: number; d: string | undefined } { return { a: 1, b: s.charAt(1), c: s.charCodeAt(0), d: s[2] }; }
export function handled(s: string, i: number): string { let c: string | undefined = "?"; try { c = s[i]; if (i === 1) throw new Error("x"); return "r" + c; } catch { return "c" + c + s.charAt(i); } }
// The same with the operation inside a loop: there it stands in place.
export function byIndexL(s: string, i: number, n: number): string | undefined { let r: string | undefined = undefined; for (let k = 0; k < n; k++) r = s[i]; return r; }
export function byCharAtL(s: string, i: number, n: number): string { let r: string = ""; for (let k = 0; k < n; k++) r = s.charAt(i); return r; }
export function byAtL(s: string, i: number, n: number): string | undefined { let r: string | undefined = undefined; for (let k = 0; k < n; k++) r = s.at(i); return r; }
export function byCharCodeAtL(s: string, i: number, n: number): number { let r: number = 0; for (let k = 0; k < n; k++) r = s.charCodeAt(i); return r; }
export function byCodePointAtL(s: string, i: number, n: number): number | undefined { let r: number | undefined = undefined; for (let k = 0; k < n; k++) r = s.codePointAt(i); return r; }
// A call through a table is inlined all the same, behind a test of the callee (IsClosureOf), into the loop of the caller: there the code in place would run. What is called by code that the compiler never saw runs its own code.
const f: any = { byIndex, byCharAt, byAt, byCharCodeAt, byCodePointAt, first, last, startsWithSlash, endsWithNewline, isDigitAt, sameAt, untyped, byInteger, recorded, handled };
const unseen: any = new Function("f", "return (...args) => f(...args)");
for (const name of Object.keys(f)) f[name] = unseen(f[name]);
const g: any = { byIndexL, byCharAtL, byAtL, byCharCodeAtL, byCodePointAtL };
const wide = (s: string): string => ("日" + s).slice(1);
const rope = (s: string): string => s.length < 2 ? s : s.slice(0, s.length >> 1) + s.slice(s.length >> 1);
const deepRope = (s: string): string => { let out = ""; for (const c of s) out = out + c; return out; };
const wideRope = (s: string): string => s.length < 2 ? wide(s) : wide(s.slice(0, 1)) + s.slice(1);
const cutOut = (s: string): string => ("<<" + s + ">>").substring(2, 2 + s.length);
const cutOutOfRope = (s: string): string => rope("<<" + s + ">>").substring(2, 2 + s.length);
const cutOutOfWide = (s: string): string => wide("<<" + s + ">>").substring(2, 2 + s.length);
const cutOutTwice = (s: string): string => ("<<<<" + s + ">>>>").substring(2, 6 + s.length).substring(2, 2 + s.length);
const fresh = (s: string): string => String.fromCharCode(...[...s].map(c => c.charCodeAt(0)));
const kinds: [string, (s: string) => string][] = [["same", s => s], ["wide", wide], ["rope", rope], ["deepRope", deepRope], ["wideRope", wideRope], ["part", cutOut], ["partOfWide", cutOutOfWide], ["partOfPart", cutOutTwice], ["partOfRope", cutOutOfRope], ["fresh", fresh]];
const places = [0, 1, 2, 3, 5, 6, 7, 99, -1, -2, -6, -7, -99, 0.5, 1.5, -0.5, -1.5, NaN, Infinity, -Infinity, -0, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 4294967297, 9007199254740991, -9007199254740991, 1e300, -1e300];
const texts = ["", "a", "/", "ab", "abcdef", "/usr/bin\n", "café", "ÿĀ", "日本語", "a😀b", "\ud83d", "\0\x01"];
for (const [name, make] of kinds) print(name + ": " + texts.map(t => show(t) + "=" + places.map(i => [f.byIndex(make(t), i), f.byCharAt(make(t), i), f.byAt(make(t), i), f.byCharCodeAt(make(t), i), f.byCodePointAt(make(t), i)].map(x => x === undefined ? "u" : typeof x === "string" ? (x === "" ? "e" : x.charCodeAt(0).toString(36)) : x !== x ? "n" : x.toString(36)).join("")).join(",")).join(" "));
for (const [name, make] of kinds) print(name + ": " + texts.map(t => [show(f.first(make(t))), show(f.last(make(t))), Number(f.startsWithSlash(make(t))), Number(f.endsWithNewline(make(t))), Number(f.isDigitAt(make(t + "7"), t.length)), f.sameAt(make(t), make(t + "x"), t.length), f.sameAt(make(t), wide(t), 0), show(f.byInteger(make(t), 1.9)), show(f.byInteger(make(t), -1)), show(f.handled(make(t), 0)), show(f.handled(make(t), 1)), JSON.stringify(f.recorded(make(t)))].join("/")).join(" "));
// The strings of one character are JavaScriptCore's own.
print([f.byIndex("abc", 1) === "b", f.byCharAt(wide("abc"), 1) === "b", f.byAt(rope("abc"), -1) === "c", f.byIndex("日本", 1) === "本", f.byCharAt("abc", 9) === "", f.byIndex("abc", 9) === undefined, Object.is(f.byCharCodeAt("abc", 9), NaN), Object.is(f.byCharCodeAt("abc", -1), NaN)].join());
print([() => f.untyped("abc", 1), () => f.untyped("abc", "1"), () => f.untyped("abc", -1), () => f.untyped("abc", null), () => f.untyped("abc", undefined), () => f.untyped("abc", { valueOf: () => 2 }), () => f.untyped("abc", "length"), () => f.untyped(rope("abcd"), 3), () => f.untyped(["x", "y"], 1), () => f.untyped(5, 0), () => f.untyped(null, 0), () => f.byIndex(undefined, 0), () => f.byCharAt(null, 0), () => f.byCharCodeAt(undefined, 0)].map(attempt).join(" "));
{ let compared = 0, differ = 0; const same = (a: any, b: any): boolean => Object.is(a, b); for (const [, make] of kinds) for (const t of texts) for (const i of places) for (const n of ["byIndex", "byCharAt", "byAt", "byCharCodeAt", "byCodePointAt"]) { compared++; if (!same(f[n](make(t), i), g[n + "L"](make(t), i, 1))) differ++; } print("the stub against the code in place: " + compared + " compared, " + differ + " differ"); }
{ let n = 0; for (let i = 0; i < 40000; i++) { const s = (i % 3 ? "/path" : "path") + i + (i % 4 ? "" : "\n"); if (f.startsWithSlash(s)) n++; if (f.endsWithNewline(s)) n += 2; n += f.byCharCodeAt(s, i % 9) | 0; if (f.isDigitAt(i % 5 ? s : rope(s), 5)) n += 3; } print(String(n)); }
(globalThis as any).kept = [byIndex, byCharAt, byAt, byCharCodeAt, byCodePointAt, first, last, startsWithSlash, endsWithNewline, isDigitAt, sameAt, untyped, byInteger, recorded, handled, byIndexL, byCharAtL, byAtL, byCharCodeAtL, byCodePointAtL]; console.log("number");
