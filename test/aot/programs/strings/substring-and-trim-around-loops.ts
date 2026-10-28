// `slice`, `substring`, `substr` and the `trim` methods inside and outside loops, on every internal representation of a string.
// CALLS+ slicedL Substring(;|$)
// CALLS- slicedL operationAOTSubstring
// CALLS+ slicedH Substring(;|$)
// CALLS- slicedH operationAOTSubstring
// CALLS+ trimmed StringTrim(;|$)
// CALLS+ trimmedStart StringTrimStart(;|$)
// CALLS+ trimmedEnd StringTrimEnd(;|$)
// CALLS+ trimmedL StringTrim(;|$)
// CALLS+ trimmedInLoop StringTrim(;|$)
// CALLS- trimmed operationAOTStringTrim
// CALLS- trimmedL operationAOTStringTrim
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

export function sliced(s: string, a: number, b: number): string { return s.slice(a, b); }
export function slicedFrom(s: string, a: number): string { return s.slice(a); }
export function slicedOne(s: string): string { return s.slice(1); }
export function slicedLast(s: string): string { return s.slice(-1) + "|" + s.slice(0, -1) + "|" + s.slice(0, 1) + "|" + s.slice(2, 4); }
export function substringed(s: string, a: number, b: number): string { return s.substring(a, b); }
export function substred(s: string, a: number, b: number): string { return s.substr(a, b); }
export function slicedUntyped(s: any, a: any, b: any): any { return s.slice(a, b); }
export function trimmed(s: string): string { return s.trim(); }
export function trimmedStart(s: string): string { return s.trimStart(); }
export function trimmedEnd(s: string): string { return s.trimEnd(); }
export function trimmedUntyped(s: any): any { return s.trim(); }
export function slicedInLoop(list: string[]): string { let out = ""; for (const s of list) out += s.slice(1, 3) + ","; return out; }
export function trimmedInLoop(list: string[]): string { let out = ""; for (const s of list) out += "[" + s.trim() + "]"; return out; }
export function recorded(s: string): { a: number; b: string; c: string; d: number } { return { a: 1, b: s.slice(1), c: s.trim(), d: 2 }; }
// The same with the operation inside a loop, where it is compiled inline.
export function slicedL(s: string, a: number, b: number, n: number): string { let r = ""; for (let k = 0; k < n; k++) r = s.slice(a, b); return r; }
export function substringedL(s: string, a: number, b: number, n: number): string { let r = ""; for (let k = 0; k < n; k++) r = s.substring(a, b); return r; }
export function substredL(s: string, a: number, b: number, n: number): string { let r = ""; for (let k = 0; k < n; k++) r = s.substr(a, b); return r; }
export function trimmedL(s: string, n: number): string { let r = ""; for (let k = 0; k < n; k++) r = s.trim(); return r; }
export function trimmedStartL(s: string, n: number): string { let r = ""; for (let k = 0; k < n; k++) r = s.trimStart(); return r; }
export function trimmedEndL(s: string, n: number): string { let r = ""; for (let k = 0; k < n; k++) r = s.trimEnd(); return r; }
// A call through a table is still inlined into the caller's loop, after a test of the callee (IsClosureOf), and the inline code would run there. A function called by code that the compiler never saw runs its own code.
const f: any = { recorded, sliced, slicedFrom, slicedOne, slicedLast, substringed, substred, slicedUntyped, trimmed, trimmedStart, trimmedEnd, trimmedUntyped, slicedInLoop, trimmedInLoop };
const unseen: any = new Function("f", "return (...args) => f(...args)");
for (const name of Object.keys(f)) f[name] = unseen(f[name]);
const g: any = { slicedL, substringedL, substredL, trimmedL, trimmedStartL, trimmedEndL };
export function slicedH(s: string, a: number, b: number, n: number): string { let r = ""; try { for (let k = 0; k < n; k++) r = s.slice(a, b); } catch (e) { r = "caught"; } return r; }
export function substringedH(s: string, a: number, b: number, n: number): string { let r = ""; for (let k = 0; k < n; k++) { try { r = s.substring(a, b); } catch (e) { r = "caught"; } } return r; }
export function slicedThenThrown(s: string, a: number, b: number): string { let r = "none"; try { for (let k = 0; k < 3; k++) { r = s.slice(a, b); if (k === 1) throw new Error(r); } } catch (e) { return r + "|" + (e as Error).message; } return r; }
const handled: any = { slicedH, substringedH, slicedThenThrown };
const wide = (s: string): string => ("日" + s).slice(1);
const rope = (s: string): string => s.length < 2 ? s : s.slice(0, s.length >> 1) + s.slice(s.length >> 1);
const deepRope = (s: string): string => { let out = ""; for (const c of s) out = out + c; return out; };
const cutOut = (s: string): string => ("<<" + s + ">>").substring(2, 2 + s.length);
const cutOutOfRope = (s: string): string => rope("<<" + s + ">>").substring(2, 2 + s.length);
const cutOutOfWide = (s: string): string => wide("<<" + s + ">>").substring(2, 2 + s.length);
const cutOutTwice = (s: string): string => ("<<<<" + s + ">>>>").substring(2, 6 + s.length).substring(2, 2 + s.length);
const fresh = (s: string): string => String.fromCharCode(...[...s].map(c => c.charCodeAt(0)));
const kinds: [string, (s: string) => string][] = [["same", s => s], ["wide", wide], ["rope", rope], ["deepRope", deepRope], ["part", cutOut], ["partOfWide", cutOutOfWide], ["partOfPart", cutOutTwice], ["partOfRope", cutOutOfRope], ["fresh", fresh]];
const places = [0, 1, 2, 3, 5, 6, 7, 99, -1, -2, -6, -7, -99, 1.5, -1.5, NaN, Infinity, -Infinity, -0, 2147483648, -2147483649, 4294967297];
for (const [name, make] of kinds) {
    for (const text of ["", "a", "ab", "abcdef", "café au lait", "日本語の", "a😀b"]) {
        let h = 0, sample = "";
        for (const a of places) for (const b of places) { const got = [f.sliced(make(text), a, b), f.substringed(make(text), a, b), f.substred(make(text), a, b), f.slicedUntyped(make(text), a, b)].join("\x01"); for (let i = 0; i < got.length; i++) h = (Math.imul(h, 31) + got.charCodeAt(i)) | 0; if (a === 1 && b === 3) sample = show(got); }
        print(name + " " + show(text) + " " + h + " " + sample + " " + places.map(a => f.slicedFrom(make(text), a).length).join("") + " " + show(f.slicedOne(make(text))) + show(f.slicedLast(make(text))));
    }
}
// A part is the string itself where it is the whole, and JavaScriptCore's own strings where it is one character or none.
{ const s = fresh("abcdef"); print([f.sliced(s, 0, 6) === s, f.slicedFrom(s, 0) === s, f.trimmed(s) === s, f.sliced(s, 2, 2) === "", f.sliced(s, 4, 2) === "", f.sliced(s, 2, 3) === "c", f.sliced(wide("abc"), 1, 2) === "b", f.sliced("日本", 1, 2) === "本"].join()); }
{ const parts: string[] = []; let s = "0123456789".repeat(20); while (s.length > 2) { s = f.sliced(s, 1, s.length - 1); parts.push(s[0] + s.length); } print(parts.join("").length + " " + parts.slice(-3).join()); }
const spaces = ["", " ", "  ", "\t", "\n", "\v", "\f", "\r", " ", " \t\n\v\f\r ", "\u0085", "​", "\x1f", "\x0e", "\x08", "!", " ", " ", " ", " ", " ", " ", " ", "　", "﻿", "᠎"];
for (const [name, make] of kinds) print(name + ": " + spaces.map(w => ["", "x", "x y", "é", "日"].map(core => { const s = make(w + core + w); return [f.trimmed(s), f.trimmedStart(s), f.trimmedEnd(s), f.trimmedUntyped(s)].map(t => t.length).join(""); }).join(".")).join(" "));
print([f.slicedInLoop(["abcd", "x", "", wide("abcd"), rope("abcd")]), f.trimmedInLoop([" a ", "", "  ", wide(" b "), rope("  c  ")])].join(" ") + " " + [() => f.slicedUntyped(undefined, 0, 1), () => f.slicedUntyped(12345, 1, 3), () => f.slicedUntyped([1, 2, 3], 1, 3), () => f.slicedUntyped("abcdef", "1", "3"), () => f.slicedUntyped("abcdef", { valueOf: () => 2 }, undefined), () => f.slicedUntyped("abcdef", null, true), () => f.trimmedUntyped(null), () => f.trimmedUntyped({ trim: () => "mine" }), () => f.sliced(null, 0, 1), () => f.trimmed(undefined)].map(attempt).join());
{ let n = 0; for (let i = 0; i < 30000; i++) { const s = "  line " + i + (i % 3 ? " " : ""); n += f.trimmed(s).length + f.sliced(s, i % 5, 9).length + f.slicedOne(s).length; } print(String(n)); }
print([" ab ", "", "x", rope("  abcd  ")].map(s => JSON.stringify(f.recorded(s))).join());
{ const held: string[] = []; const base = fresh("0123456789abcdefghijklmnopqrstuvwxyz"); for (let i = 0; i < 100000; i++) held.push(i & 1 ? f.sliced(base, i % 30, i % 30 + 2 + i % 5) : f.trimmed(" " + base.slice(i % 20, i % 20 + 3 + i % 7) + i + " ")); let h = 0; for (const s of held) for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; print(held.length + " " + h); }
{ let compared = 0, differ = 0; for (const [, make] of kinds) { for (const text of ["", "a", "ab", "abcdef", "café au lait", "日本語の", "a😀b"]) for (const a of places) for (const b of places) { compared += 3; if (f.sliced(make(text), a, b) !== g.slicedL(make(text), a, b, 1)) differ++; if (f.substringed(make(text), a, b) !== g.substringedL(make(text), a, b, 1)) differ++; if (f.substred(make(text), a, b) !== g.substredL(make(text), a, b, 1)) differ++; } for (const w of spaces) for (const v of spaces) for (const core of ["", "x", "x y", "é", "日"]) { compared += 3; const t = w + core + v; if (f.trimmed(make(t)) !== g.trimmedL(make(t), 1)) differ++; if (f.trimmedStart(make(t)) !== g.trimmedStartL(make(t), 1)) differ++; if (f.trimmedEnd(make(t)) !== g.trimmedEndL(make(t), 1)) differ++; } } print("the stubs against the code in place: " + compared + " compared, " + differ + " differ"); }
{ let compared = 0, differ = 0; for (const [, make] of kinds) { for (const text of ["", "a", "ab", "abcdef", "café au lait", "日本語の", "a😀b"]) for (const a of places) for (const b of places) { compared += 3; const expected = f.sliced(make(text), a, b); if (expected !== handled.slicedH(make(text), a, b, 2)) differ++; if (f.substringed(make(text), a, b) !== handled.substringedH(make(text), a, b, 2)) differ++; if (expected + "|" + expected !== handled.slicedThenThrown(make(text), a, b)) differ++; } } print("under a handler: " + compared + " compared, " + differ + " differ"); }
(globalThis as any).kept = [slicedH, substringedH, slicedThenThrown, slicedL, substringedL, substredL, trimmedL, trimmedStartL, trimmedEndL, recorded, sliced, slicedFrom, slicedOne, slicedLast, substringed, substred, slicedUntyped, trimmed, trimmedStart, trimmedEnd, trimmedUntyped, slicedInLoop, trimmedInLoop]; console.log("number");
