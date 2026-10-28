// `s === "literal"` inside and outside loops, for every length, every internal representation of the string and every kind of value.
// In a loop the characters are compared in place and only the rarely taken arm for 16-bit strings calls out, handing over the literal's number.
// Outside a loop the whole comparison is one call of the stub.
// CALLS- is5L (?<!Typed)StringEqualsLiteral
// CALLS+ is5L operationAOTStringEqualsLiteral
// CALLS- is5L StringHasAt
// CALLS- ofAnyL (?<!Typed)(String|Value)EqualsLiteral
// CALLS+ is5 (?<!Typed)StringEqualsLiteral
// CALLS- is5 (^|[ f])TypedString(;|$)
// CALLS+ branch1 (?<!Typed)StringEqualsLiteral
// CALLS+ branch2 (?<!Typed)StringEqualsLiteral
// CALLS+ branch3 ShortStringOfValue
// CALLS- branch3 (?<!Typed)(String|Value)EqualsLiteral
// CALLS+ switched (?<!Typed)StringEqualsLiteral
// CALLS- branch3 StringHasAt|Flatten
// CALLS- inLoop (?<!Typed)StringEqualsLiteral
// CALLS+ ofAny ValueEqualsLiteral
// CALLS- isEmpty StringEqualsLiteral
// CALLS- isAccented StringEqualsLiteral
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
export function is1(s: string): boolean { return s === "a"; }
export function is2(s: string): boolean { return s === "ab"; }
export function is3(s: string): boolean { return s === "abc"; }
export function is4(s: string): boolean { return s === "abcd"; }
export function is5(s: string): boolean { return s === "abcde"; }
export function is6(s: string): boolean { return s === "abcdef"; }
export function is7(s: string): boolean { return s === "abcdefg"; }
export function is8(s: string): boolean { return s === "abcdefgh"; }
export function is9(s: string): boolean { return s === "abcdefghi"; }
export function is10(s: string): boolean { return s === "abcdefghij"; }
export function is12(s: string): boolean { return s === "abcdefghijkl"; }
export function is15(s: string): boolean { return s === "abcdefghijklmno"; }
export function is16(s: string): boolean { return s === "abcdefghijklmnop"; }
export function is17(s: string): boolean { return s === "abcdefghijklmnopq"; }
export function is23(s: string): boolean { return s === "abcdefghijklmnopqrstuvw"; }
export function is24(s: string): boolean { return s === "abcdefghijklmnopqrstuvwx"; }
export function is25(s: string): boolean { return s === "abcdefghijklmnopqrstuvwxy"; }
export function is31(s: string): boolean { return s === "abcdefghijklmnopqrstuvwxyz01234"; }
export function is32(s: string): boolean { return s === "abcdefghijklmnopqrstuvwxyz012345"; }
export function is33(s: string): boolean { return s === "abcdefghijklmnopqrstuvwxyz0123456"; }
export function is40(s: string): boolean { return s === "abcdefghijklmnopqrstuvwxyz0123456789ABCD"; }
export function is64(s: string): boolean { return s === "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_"; }
export function is65(s: string): boolean { return s === "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_."; }

export function branch1(s: string): string { if (s === "alpha") return "A"; return "-"; }
export function branch2(s: string): string { if (s === "alpha") return "A"; else if (s === "beta") return "B"; return "-"; }
export function branch3(s: string): string { if (s === "alpha") return "A"; else if (s === "beta") return "B"; else if (s === "gamma") return "G"; return "-"; }
export function switched(s: string): number { switch (s) { case "one": return 1; case "two": return 2; case "three": return 3; case "four": return 4; case "fourteen": return 14; default: return 0; } }
export function inLoop(list: string[]): number { let n = 0; for (const s of list) if (s === "alpha") n++; return n; }
export function ofAny(x: any): boolean { return x === "hello"; }
export function ofUnion(x: string | number | undefined): boolean { return x === "hello"; }
export function ofNullable(x: string | null | undefined): boolean { return "hello" === x; }
export function ofTexts(t: "alpha" | "beta" | "gamma"): boolean { return t === "beta"; }
export function ofField(o: { kind: string }): boolean { return o.kind === "beta"; }
export function isNot(s: string): boolean { return s !== "hello"; }
export function chosen(s: string): number { return s === "hello" ? 1 : s === "world" ? 2 : 3; }
export function both(a: string, b: string): boolean { return a === "left" && b === "right"; }
export function loosely(x: any): boolean { return x == "12"; }
export function isEmpty(s: string): boolean { return s === ""; }
export function isAccented(s: string): boolean { return s === "café"; }
export function isWide(s: string): boolean { return s === "日本"; }
export function isOdd(s: string): string { return [s === "\0", s === "a\0b", s === "\n", s === "\x7f", s === "\"'\\", s === " "].map(Number).join(""); }
export function recorded(s: string): { a: number; b: boolean; c: number; d: boolean } { return { a: 1, b: s === "x1", c: 2, d: "yy" !== s }; }
// The same with the operation inside a loop: there it stands in place.
export function is1L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "a"; return r; }
export function is2L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "ab"; return r; }
export function is3L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "abc"; return r; }
export function is4L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "abcd"; return r; }
export function is5L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "abcde"; return r; }
export function is6L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "abcdef"; return r; }
export function is7L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "abcdefg"; return r; }
export function is8L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "abcdefgh"; return r; }
export function is9L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "abcdefghi"; return r; }
export function is10L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "abcdefghij"; return r; }
export function is12L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "abcdefghijkl"; return r; }
export function is15L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "abcdefghijklmno"; return r; }
export function is16L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "abcdefghijklmnop"; return r; }
export function is17L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "abcdefghijklmnopq"; return r; }
export function is23L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "abcdefghijklmnopqrstuvw"; return r; }
export function is24L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "abcdefghijklmnopqrstuvwx"; return r; }
export function is25L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "abcdefghijklmnopqrstuvwxy"; return r; }
export function is31L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "abcdefghijklmnopqrstuvwxyz01234"; return r; }
export function is32L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "abcdefghijklmnopqrstuvwxyz012345"; return r; }
export function is33L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "abcdefghijklmnopqrstuvwxyz0123456"; return r; }
export function is40L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "abcdefghijklmnopqrstuvwxyz0123456789ABCD"; return r; }
export function is64L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_"; return r; }
export function is65L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s === "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_."; return r; }
export function ofAnyL(x: any, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = x === "hello"; return r; }
// A call through a table is inlined all the same, behind a test of the callee (IsClosureOf), into the loop of the caller: there the code in place would run. What is called by code that the compiler never saw runs its own code.
const f: any = { recorded, branch1, branch2, branch3, switched, inLoop, ofAny, ofUnion, ofNullable, ofTexts, ofField, isNot, chosen, both, loosely, isEmpty, isAccented, isWide, isOdd, is5 };
const unseen: any = new Function("f", "return (...args) => f(...args)");
for (const name of Object.keys(f)) f[name] = unseen(f[name]);
const g: any = { is1L, is2L, is3L, is4L, is5L, is6L, is7L, is8L, is9L, is10L, is12L, is15L, is16L, is17L, is23L, is24L, is25L, is31L, is32L, is33L, is40L, is64L, is65L, ofAnyL };
const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_.";
const all: [number, (s: string) => boolean][] = [[1, is1], [2, is2], [3, is3], [4, is4], [5, is5], [6, is6], [7, is7], [8, is8], [9, is9], [10, is10], [12, is12], [15, is15], [16, is16], [17, is17], [23, is23], [24, is24], [25, is25], [31, is31], [32, is32], [33, is33], [40, is40], [64, is64], [65, is65]];
for (const pair of all) pair[1] = unseen(pair[1]);
// How a string with those characters can be kept.
const wide = (s: string): string => ("日" + s).slice(1);
const rope = (s: string): string => s.length < 2 ? s : s.slice(0, s.length >> 1) + s.slice(s.length >> 1);
const deepRope = (s: string): string => { let out = ""; for (const c of s) out = out + c; return out; };
const wideRope = (s: string): string => s.length < 2 ? wide(s) : wide(s.slice(0, 1)) + s.slice(1);
const cutOut = (s: string): string => ("<<" + s + ">>").substring(2, 2 + s.length);
const cutOutOfWide = (s: string): string => wide("<<" + s + ">>").substring(2, 2 + s.length);
const cutOutTwice = (s: string): string => ("<<<<" + s + ">>>>").substring(2, 6 + s.length).substring(2, 2 + s.length);
const fresh = (s: string): string => String.fromCharCode(...[...s].map(c => c.charCodeAt(0)));
const parsed = (s: string): string => JSON.parse(JSON.stringify(s));
const key = (s: string): string => Object.keys({ [s]: 1 })[0];
const kinds: [string, (s: string) => string][] = [["same", s => s], ["wide", wide], ["rope", rope], ["deepRope", deepRope], ["wideRope", wideRope], ["part", cutOut], ["partOfWide", cutOutOfWide], ["partOfPart", cutOutTwice], ["fresh", fresh], ["parsed", parsed], ["key", key]];
for (const [name, make] of kinds) {
    let out = name + ":";
    for (const [n, is] of all) {
        const text = alphabet.slice(0, n);
        const changed = (at: number): string => text.slice(0, at) + "#" + text.slice(at + 1);
        out += " " + n + "=" + [is(make(text)), is(make(changed(0))), is(make(changed(n - 1))), is(make(changed(n >> 1))), is(make(text + "x")), is(make(text.slice(1))), is(make(text.toUpperCase())), is(make(changed(n - 1).replace("#", "é"))), is(make(changed(0).replace("#", "š")))].map(Number).join("");
    }
    print(out);
}
for (const [name, make] of kinds) print(name + ": " + ["alpha", "beta", "gamma", "alph", "alphaa", "Alpha", "", "one", "two", "three", "four", "fourteen", "fourteeN", "hello", "world"].map(t => { const s = make(t); return f.branch1(s) + f.branch2(s) + f.branch3(s) + f.switched(s) + Number(f.isNot(s)) + f.chosen(s) + Number(f.isEmpty(s)) + Number(f.ofNullable(s)) + Number(f.ofAny(s)) + Number(f.ofUnion(s)) + Number(f.ofField({ kind: s })); }).join(" ") + " " + f.inLoop(["alpha", "beta", "alpha", "alph"].map(make)) + Number(f.both(make("left"), make("right"))) + Number(f.both(make("left"), make("righ"))));
print([undefined, null, 0, 12, NaN, true, false, {}, [], ["hello"], { toString: () => "hello" }, Symbol.iterator, 12n, () => "hello", new String("hello"), "hello"].map(x => "" + Number(f.ofAny(x)) + Number(f.loosely(x))).join(" ") + " " + [f.ofUnion(undefined), f.ofUnion(5), f.ofNullable(null), f.ofNullable(undefined), f.ofTexts("beta"), f.ofTexts("gamma"), f.ofTexts(rope("beta") as any), f.ofTexts(wide("beta") as any)].map(Number).join(""));
print(["café", "cafe", wide("café"), rope("café"), "cafè", "café", "日本", rope("日本"), "日", "日本語"].map(s => "" + Number(f.isAccented(s)) + Number(f.isWide(s))).join(" ") + " " + ["\0", "a\0b", "\n", "\x7f", "\"'\\", " ", "", "a\0c", wide("a\0b"), rope("a\0b")].map((s: any) => f.isOdd(s)).join(" "));
{ let n = 0; for (let i = 0; i < 40000; i++) { const s = i % 3 ? "hello" : i % 5 ? "hell" + (i & 1 ? "o" : "a") : "help" + i; if (f.ofAny(s)) n++; if (f.is5(i % 7 ? "abcde" : "abcd" + (i & 7))) n += 2; n += f.chosen(s); } print(String(n)); }
print(["x1", "yy", "", "x2"].map(s => JSON.stringify(f.recorded(s))).join());
{ let compared = 0, differ = 0; for (const [, make] of kinds) for (const [n, is] of all) { const text = alphabet.slice(0, n); for (const t of [text, "#" + text.slice(1), text.slice(0, -1) + "#", text.slice(0, n >> 1) + "#" + text.slice((n >> 1) + 1), text + "x", text.slice(1), "", text.slice(0, -1) + "é", text.slice(0, -1) + "š", text.toUpperCase()]) { compared++; if (is(make(t)) !== g["is" + n + "L"](make(t), 1)) differ++; } } for (const x of ["hello", rope("hello"), wide("hello"), "hellp", "", 5, null, undefined, {}, ["hello"], new String("hello"), Symbol.iterator, 1n, true]) { compared++; if (f.ofAny(x) !== g.ofAnyL(x, 1)) differ++; } print("the stub against the code in place: " + compared + " compared, " + differ + " differ"); }
(globalThis as any).kept = [is1L, is2L, is3L, is4L, is5L, is6L, is7L, is8L, is9L, is10L, is12L, is15L, is16L, is17L, is23L, is24L, is25L, is31L, is32L, is33L, is40L, is64L, is65L, ofAnyL, recorded, is1, is2, is3, is4, is5, is6, is7, is8, is9, is10, is12, is15, is16, is17, is23, is24, is25, is31, is32, is33, is40, is64, is65, branch1, branch2, branch3, switched, inLoop, ofAny, ofUnion, ofNullable, ofTexts, ofField, isNot, chosen, both, loosely, isEmpty, isAccented, isWide, isOdd]; console.log("number");
