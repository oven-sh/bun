// `a === b` on two strings inside and outside loops, for every pair of internal representations, every length, and null or undefined on either side.
// CALLS+ sameL FlatStringsAreEqual
// CALLS- sameL StringEq
// CALLS+ sameOrNilL FlatStringsAreEqual
// CALLS+ same StringsAreEqual
// CALLS+ different StringsAreEqual
// CALLS+ branched StringsAreEqual
// CALLS- same FlatStringsAreEqual
// CALLS- different FlatStringsAreEqual
// CALLS- branched FlatStringsAreEqual
// CALLS+ counted FlatStringsAreEqual
// CALLS- sameCharacters StringsAreEqual
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

export function same(a: string, b: string): boolean { return a === b; }
export function sameOrNil(a: string | null | undefined, b: string | null | undefined): boolean { return a === b; }
export function different(a: string, b: string): boolean { return a !== b; }
export function branched(a: string, b: string): string { if (a === b) return "="; return "#"; }
export function counted(list: string[], wanted: string): number { let n = 0; for (const s of list) if (s === wanted) n++; return n; }
export function sameCharacters(a: string, b: string, i: number): boolean { return a[i] === b[i]; }
export function ofAny(a: any, b: any): boolean { return a === b; }
export function flattenedBefore(a: string, b: string): string { const joined = a + b; const first = joined.charCodeAt(0); return first + " " + (joined === a) + " " + (a === joined) + " " + (joined === a + b); }
export function ofFields(p: { name: string }, q: { name: string }): boolean { return p.name === q.name; }
export function recorded(s: string, t: string): { a: number; b: boolean; c: number } { return { a: 1, b: s === t, c: 2 }; }
// The same with the operation inside a loop.
export function sameL(a: string, b: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = a === b; return r; }
export function sameOrNilL(a: string | null | undefined, b: string | null | undefined, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = a === b; return r; }
// A call through a table is inlined all the same, behind a test of the callee (IsClosureOf), into the loop of the caller: there the code in place would run. What is called by code that the compiler never saw runs its own code.
const f: any = { recorded, same, sameOrNil, different, branched, counted, sameCharacters, ofAny, ofFields };
const unseen: any = new Function("f", "return (...args) => f(...args)");
for (const name of Object.keys(f)) f[name] = unseen(f[name]);
const g: any = { sameL, sameOrNilL };
const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_.";
const wide = (s: string): string => ("日" + s).slice(1);
const rope = (s: string): string => s.length < 2 ? s : s.slice(0, s.length >> 1) + s.slice(s.length >> 1);
const deepRope = (s: string): string => { let out = ""; for (const c of s) out = out + c; return out; };
const wideRope = (s: string): string => s.length < 2 ? wide(s) : wide(s.slice(0, 1)) + s.slice(1);
const cutOut = (s: string): string => ("<<" + s + ">>").substring(2, 2 + s.length);
const cutOutOfWide = (s: string): string => wide("<<" + s + ">>").substring(2, 2 + s.length);
const cutOutTwice = (s: string): string => ("<<<<" + s + ">>>>").substring(2, 6 + s.length).substring(2, 2 + s.length);
const fresh = (s: string): string => String.fromCharCode(...[...s].map(c => c.charCodeAt(0)));
const key = (s: string): string => Object.keys({ [s]: 1 })[0] ?? "";
const kinds: [string, (s: string) => string][] = [["same", s => s], ["wide", wide], ["rope", rope], ["deepRope", deepRope], ["wideRope", wideRope], ["part", cutOut], ["partOfWide", cutOutOfWide], ["partOfPart", cutOutTwice], ["fresh", fresh], ["key", key]];
for (const [first, make] of kinds) {
    let out = first + ":";
    for (const [second, other] of kinds) {
        let bits = "";
        for (const n of [0, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 31, 32, 33, 64, 65]) {
            const text = alphabet.slice(0, n);
            const changed = (at: number): string => n ? text.slice(0, at) + "#" + text.slice(at + 1) : "#";
            const answers = [f.same(make(text), other(text)), f.same(make(text), other(changed(0))), f.same(make(changed(n - 1)), other(text)), f.same(make(text), other(changed(n >> 1))), f.same(make(text), other(text + "x")), f.different(make(text), other(text)), f.branched(make(text), other(text)) === "=", f.sameOrNil(make(text), other(text)), f.ofAny(make(text), other(text)), f.ofFields({ name: make(text) }, { name: other(text) })];
            bits += answers.map(Number).join("") === "1000001111" ? "." : "[" + n + ":" + answers.map(Number).join("") + "]";
        }
        out += " " + second + "=" + bits;
    }
    print(out);
}
print([[undefined, undefined], [null, null], [undefined, null], [null, undefined], ["", undefined], [undefined, ""], ["a", null], [null, "a"], ["", ""], ["", rope("")], [wide(""), ""], ["undefined", undefined], ["null", null]].map(([a, b]) => Number(f.sameOrNil(a as any, b as any))).join(""));
print(["café", "日本", "a\0b", "😀", "\ud83d", "é"].map(t => kinds.map(([, make]) => kinds.map(([, other]) => Number(f.same(make(t), other(t))) + "" + Number(f.same(make(t), other(t + "x"))) + Number(f.same(make(t), other(t.slice(0, -1) + "z")))).join("")).join(" ")).join(" | "));
print([f.counted(["a", "b", rope("ab"), "ab", wide("ab")], "ab"), f.counted([], "x"), f.sameCharacters("abc", "xbz", 1), f.sameCharacters("abc", "xbz", 0), f.sameCharacters("abc", "ab", 2), f.same("x".repeat(5000), "x".repeat(5000)), f.same("x".repeat(5000), "x".repeat(4999) + "y"), f.same(rope("x".repeat(5000)), deepRope("x".repeat(500)).repeat(10))].join());
{ let n = 0; const names = ["alpha", "beta", "gamma", "delta"]; for (let i = 0; i < 40000; i++) { if (f.same(names[i & 3], i % 5 ? names[(i >> 2) & 3] : fresh(names[i & 3]))) n++; if (f.sameOrNil(i % 7 ? names[i & 3] : undefined, i % 11 ? names[i & 3] : null)) n += 2; } print(String(n)); }
print([["x", "x"], ["x", "y"], [rope("abcd"), "abcd"]].map(([s, t]) => JSON.stringify(f.recorded(s, t))).join());
print([["0", "-"], ["abcdefgh", "i"], ["a", ""], [wide("ab"), "c"], [rope("abcd"), "abcd"]].map(([s, t]) => flattenedBefore(s, t)).join());
{ let compared = 0, differ = 0; for (const [, make] of kinds) for (const [, other] of kinds) for (const n of [0, 1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 31, 32, 33, 64, 65]) { const text = alphabet.slice(0, n); for (const t of [text, "#" + text.slice(1), text.slice(0, -1) + "#", text + "x", text.slice(1), text.slice(0, -1) + "é", text.slice(0, -1) + "š"]) { compared += 2; if (f.same(make(text), other(t)) !== g.sameL(make(text), other(t), 1)) differ++; if (f.sameOrNil(make(t), other(text)) !== g.sameOrNilL(make(t), other(text), 1)) differ++; } } for (const a of [undefined, null, "", "a", rope("ab")]) for (const b of [undefined, null, "", "a", "ab"]) { compared++; if (f.sameOrNil(a, b) !== g.sameOrNilL(a, b, 1)) differ++; } print("the stub against the code in place: " + compared + " compared, " + differ + " differ"); }
(globalThis as any).kept = [sameL, sameOrNilL, recorded, same, sameOrNil, different, branched, counted, sameCharacters, ofAny, ofFields]; console.log("number");
