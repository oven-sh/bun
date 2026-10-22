// `startsWith`, `endsWith`, `includes`, `indexOf` and `lastIndexOf` inside and outside loops.
// CALLS- starts5L StringStartsWithLiteral
// CALLS- ends5L StringEndsWithLiteral
// CALLS+ indexOfTextL operationAOTStringFind8
// CALLS- indexOfTextL operationAOTStringIndexOfLiteral
// CALLS+ indexOfCharacterL operationAOTStringFindCharacter8
// CALLS+ lastIndexOfTextL operationAOTStringReverseFind8
// CALLS+ lastIndexOfCharacterL operationAOTStringReverseFindCharacter8
// Outside a loop the sites of one method that look for the same text share one body, which holds the text and so goes by the operation for a text that is known, and a site is a short call of it. A site that is the only one with its text stays in place.
// CALLS+ starts5 StringStartsWithLiteral
// CALLS- starts5 CallHostFunction|CallMethod|CallValue|f:;
// SIZE< starts5 240
// CALLS+ ends5 StringEndsWithLiteral
// CALLS- ends5 CallHostFunction|CallMethod|CallValue|f:;
// SIZE< ends5 240
// CALLS+ includesText StringFindLiteral
// CALLS- includesText CallHostFunction|CallMethod|CallValue
// CALLS+ includesText f:;
// SIZE< includesText 80
// CALLS+ indexOfCharacter StringFindCharacter
// CALLS- indexOfCharacter CallHostFunction|CallMethod|CallValue
// CALLS+ indexOfCharacter f:;
// SIZE< indexOfCharacter 80
// CALLS+ indexOfText StringFindLiteral
// CALLS- indexOfText CallHostFunction|CallMethod|CallValue
// CALLS+ indexOfText f:;
// SIZE< indexOfText 80
// CALLS+ lastIndexOfText operationAOTStringReverseFindLiteral8
// CALLS- lastIndexOfText CallHostFunction|CallMethod|CallValue
// CALLS+ lastIndexOfText f:;
// SIZE< lastIndexOfText 80
// CALLS- indexOfString operationAOTStringIndexOfLiteral
// CALLS- startsInLoop StringStartsWithLiteral
// CALLS- startsAt StringStartsWithLiteral
// CALLS- startsAccented StringStartsWithLiteral
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
export function starts1(s: string): boolean { return s.startsWith("a"); }
export function ends1(s: string): boolean { return s.endsWith("a"); }
export function starts2(s: string): boolean { return s.startsWith("ab"); }
export function ends2(s: string): boolean { return s.endsWith("ab"); }
export function starts3(s: string): boolean { return s.startsWith("abc"); }
export function ends3(s: string): boolean { return s.endsWith("abc"); }
export function starts4(s: string): boolean { return s.startsWith("abcd"); }
export function ends4(s: string): boolean { return s.endsWith("abcd"); }
export function starts5(s: string): boolean { return s.startsWith("abcde"); }
export function ends5(s: string): boolean { return s.endsWith("abcde"); }
export function starts7(s: string): boolean { return s.startsWith("abcdefg"); }
export function ends7(s: string): boolean { return s.endsWith("abcdefg"); }
export function starts8(s: string): boolean { return s.startsWith("abcdefgh"); }
export function ends8(s: string): boolean { return s.endsWith("abcdefgh"); }
export function starts9(s: string): boolean { return s.startsWith("abcdefghi"); }
export function ends9(s: string): boolean { return s.endsWith("abcdefghi"); }
export function starts15(s: string): boolean { return s.startsWith("abcdefghijklmno"); }
export function ends15(s: string): boolean { return s.endsWith("abcdefghijklmno"); }
export function starts16(s: string): boolean { return s.startsWith("abcdefghijklmnop"); }
export function ends16(s: string): boolean { return s.endsWith("abcdefghijklmnop"); }
export function starts17(s: string): boolean { return s.startsWith("abcdefghijklmnopq"); }
export function ends17(s: string): boolean { return s.endsWith("abcdefghijklmnopq"); }
export function starts33(s: string): boolean { return s.startsWith("abcdefghijklmnopqrstuvwxyz0123456"); }
export function ends33(s: string): boolean { return s.endsWith("abcdefghijklmnopqrstuvwxyz0123456"); }

export function includesText(s: string): boolean { return s.includes("needle"); }
export function includesCharacter(s: string): boolean { return s.includes("\x1b"); }
export function indexOfText(s: string): number { return s.indexOf("needle"); }
export function indexOfCharacter(s: string): number { return s.indexOf(","); }
export function indexOfFrom(s: string, from: number): number { return s.indexOf("ne", from); }
export function lastIndexOfText(s: string): number { return s.lastIndexOf("needle"); }
export function lastIndexOfCharacter(s: string): number { return s.lastIndexOf(","); }
export function lastIndexOfFrom(s: string, from: number): number { return s.lastIndexOf("ne", from); }
export function indexOfString(s: string, other: string): number { return s.indexOf(other); }
export function lastIndexOfString(s: string, other: string): number { return s.lastIndexOf(other); }
export function includesString(s: string, other: string): boolean { return s.includes(other); }
export function startsString(s: string, other: string): string { return "" + Number(s.startsWith(other)) + Number(s.endsWith(other)); }
export function startsAt(s: string, at: number): boolean { return s.startsWith("ne", at); }
export function endsAt(s: string, at: number): boolean { return s.endsWith("ne", at); }
export function startsEmpty(s: string): string { return "" + Number(s.startsWith("")) + Number(s.endsWith("")) + Number(s.includes("")) + s.indexOf("") + s.lastIndexOf(""); }
export function startsAccented(s: string): string { return "" + Number(s.startsWith("café")) + Number(s.endsWith("café")) + s.indexOf("é") + s.lastIndexOf("日"); }
export function untyped(s: any): any { return "" + Number(s.startsWith("ab")) + Number(s.endsWith("yz")) + Number(s.includes("mn")) + s.indexOf("c") + s.lastIndexOf("c"); }
export function startsInLoop(list: string[]): number { let n = 0; for (const s of list) if (s.startsWith("ab") || s.endsWith("yz") || s.includes("mn")) n++; return n; }
export function recorded(s: string): { a: number; b: boolean; c: number; d: boolean } { return { a: 1, b: s.startsWith("ab"), c: s.indexOf("b"), d: s.endsWith("b") }; }
// The same with the operation inside a loop: there it stands in place.
export function starts1L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.startsWith("a"); return r; }
export function ends1L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.endsWith("a"); return r; }
export function starts2L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.startsWith("ab"); return r; }
export function ends2L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.endsWith("ab"); return r; }
export function starts3L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.startsWith("abc"); return r; }
export function ends3L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.endsWith("abc"); return r; }
export function starts4L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.startsWith("abcd"); return r; }
export function ends4L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.endsWith("abcd"); return r; }
export function starts5L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.startsWith("abcde"); return r; }
export function ends5L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.endsWith("abcde"); return r; }
export function starts7L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.startsWith("abcdefg"); return r; }
export function ends7L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.endsWith("abcdefg"); return r; }
export function starts8L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.startsWith("abcdefgh"); return r; }
export function ends8L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.endsWith("abcdefgh"); return r; }
export function starts9L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.startsWith("abcdefghi"); return r; }
export function ends9L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.endsWith("abcdefghi"); return r; }
export function starts15L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.startsWith("abcdefghijklmno"); return r; }
export function ends15L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.endsWith("abcdefghijklmno"); return r; }
export function starts16L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.startsWith("abcdefghijklmnop"); return r; }
export function ends16L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.endsWith("abcdefghijklmnop"); return r; }
export function starts17L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.startsWith("abcdefghijklmnopq"); return r; }
export function ends17L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.endsWith("abcdefghijklmnopq"); return r; }
export function starts33L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.startsWith("abcdefghijklmnopqrstuvwxyz0123456"); return r; }
export function ends33L(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.endsWith("abcdefghijklmnopqrstuvwxyz0123456"); return r; }
export function indexOfTextL(s: string, n: number): number { let r = 0; for (let k = 0; k < n; k++) r = s.indexOf("needle"); return r; }
export function indexOfCharacterL(s: string, n: number): number { let r = 0; for (let k = 0; k < n; k++) r = s.indexOf(","); return r; }
export function indexOfFromL(s: string, from: number, n: number): number { let r = 0; for (let k = 0; k < n; k++) r = s.indexOf("ne", from); return r; }
export function lastIndexOfTextL(s: string, n: number): number { let r = 0; for (let k = 0; k < n; k++) r = s.lastIndexOf("needle"); return r; }
export function lastIndexOfCharacterL(s: string, n: number): number { let r = 0; for (let k = 0; k < n; k++) r = s.lastIndexOf(","); return r; }
export function lastIndexOfFromL(s: string, from: number, n: number): number { let r = 0; for (let k = 0; k < n; k++) r = s.lastIndexOf("ne", from); return r; }
export function includesTextL(s: string, n: number): boolean { let r = false; for (let k = 0; k < n; k++) r = s.includes("needle"); return r; }
export function indexOfStringL(s: string, other: string, n: number): number { let r = 0; for (let k = 0; k < n; k++) r = s.indexOf(other); return r; }
export function lastIndexOfStringL(s: string, other: string, n: number): number { let r = 0; for (let k = 0; k < n; k++) r = s.lastIndexOf(other); return r; }
// A call through a table is inlined all the same, behind a test of the callee (IsClosureOf), into the loop of the caller: there the code in place would run. What is called by code that the compiler never saw runs its own code.
const f: any = { starts1, ends1, starts2, ends2, starts3, ends3, starts4, ends4, starts5, ends5, starts7, ends7, starts8, ends8, starts9, ends9, starts15, ends15, starts16, ends16, starts17, ends17, starts33, ends33, includesText, includesCharacter, indexOfText, indexOfCharacter, indexOfFrom, lastIndexOfText, lastIndexOfCharacter, lastIndexOfFrom, indexOfString, lastIndexOfString, includesString, startsString, startsAt, endsAt, startsEmpty, startsAccented, untyped, startsInLoop, recorded };
const unseen: any = new Function("f", "return (...args) => f(...args)");
for (const name of Object.keys(f)) f[name] = unseen(f[name]);
const g: any = { starts1L, ends1L, starts2L, ends2L, starts3L, ends3L, starts4L, ends4L, starts5L, ends5L, starts7L, ends7L, starts8L, ends8L, starts9L, ends9L, starts15L, ends15L, starts16L, ends16L, starts17L, ends17L, starts33L, ends33L, indexOfTextL, indexOfCharacterL, indexOfFromL, lastIndexOfTextL, lastIndexOfCharacterL, lastIndexOfFromL, includesTextL, indexOfStringL, lastIndexOfStringL };
const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-_.";
const wide = (s: string): string => ("日" + s).slice(1);
const rope = (s: string): string => s.length < 2 ? s : s.slice(0, s.length >> 1) + s.slice(s.length >> 1);
const deepRope = (s: string): string => { let out = ""; for (const c of s) out = out + c; return out; };
const wideRope = (s: string): string => s.length < 2 ? wide(s) : wide(s.slice(0, 1)) + s.slice(1);
const cutOut = (s: string): string => ("<<" + s + ">>").substring(2, 2 + s.length);
const cutOutOfWide = (s: string): string => wide("<<" + s + ">>").substring(2, 2 + s.length);
const cutOutTwice = (s: string): string => ("<<<<" + s + ">>>>").substring(2, 6 + s.length).substring(2, 2 + s.length);
const fresh = (s: string): string => String.fromCharCode(...[...s].map(c => c.charCodeAt(0)));
const kinds: [string, (s: string) => string][] = [["same", s => s], ["wide", wide], ["rope", rope], ["deepRope", deepRope], ["wideRope", wideRope], ["part", cutOut], ["partOfWide", cutOutOfWide], ["partOfPart", cutOutTwice], ["fresh", fresh]];
for (const [name, make] of kinds) {
    let out = name + ":";
    for (const n of [1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 33]) {
        const text = alphabet.slice(0, n);
        const changed = (at: number): string => text.slice(0, at) + "#" + text.slice(at + 1);
        out += " " + n + "=" + [text, text + "tail", "head" + text, "head" + text + "tail", changed(0) + "tail", changed(n - 1) + "tail", "head" + changed(0), "head" + changed(n - 1), text.slice(1), text.slice(0, -1), "", text + text, text + "é", "š" + text].map(t => "" + Number(f["starts" + n](make(t))) + Number(f["ends" + n](make(t)))).join("");
    }
    print(out);
}
const hay = ["", "needle", "a needle", "needle, needle", "needl", "nee,dle", ",", ",,", "no", "x".repeat(300) + "needle" + "y".repeat(300) + ",", "ne", "nene", "\x1b[0m", "café", "un café", "日本 needle 日", "NEEDLE"];
for (const [name, make] of kinds) print(name + ": " + hay.map(t => { const s = make(t); return [Number(f.includesText(s)), Number(f.includesCharacter(s)), f.indexOfText(s), f.indexOfCharacter(s), f.lastIndexOfText(s), f.lastIndexOfCharacter(s), f.startsEmpty(s), f.startsAccented(s)].join("/") + ":" + [0, 1, 2, 7, 99, -1, 1.5, NaN, Infinity, -Infinity].map(at => "" + f.indexOfFrom(s, at) + f.lastIndexOfFrom(s, at) + Number(f.startsAt(s, at)) + Number(f.endsAt(s, at))).join(""); }).join(" "));
for (const [name, make] of kinds) print(name + ": " + [["abcabc", "bc"], ["abcabc", ""], ["", ""], ["", "a"], ["abc", "abc"], ["abc", "abcd"], ["a日b日", "日"], ["café", "é"], ["x".repeat(400) + "yz", "yz"], ["aaa", "aa"]].map(([s, o]) => kinds.map(([, other]) => "" + f.indexOfString(make(s), other(o)) + f.lastIndexOfString(make(s), other(o)) + Number(f.includesString(make(s), other(o))) + f.startsString(make(s), other(o))).join(".")).join(" "));
print([f.untyped("abc mn c yz"), f.untyped(rope("abcyz")), attempt(() => f.untyped(5)), attempt(() => f.untyped(null)), attempt(() => f.untyped(["ab", "c"])), attempt(() => f.starts5(undefined)), attempt(() => f.indexOfText(null)), attempt(() => "abc".startsWith(/a/ as any)), f.startsInLoop(["ab", "xyz", "amn", "q", rope("abq"), wide("qyz")]), JSON.stringify(f.recorded("ab")), JSON.stringify(f.recorded(rope("xxb")))].join(" "));
{ let n = 0; for (let i = 0; i < 30000; i++) { const s = (i % 3 ? "abcde" : "abcd") + i + (i % 4 ? "" : ",needle"); if (f.starts5(s)) n++; if (f.ends5(i % 5 ? s : s + "abcde")) n += 2; n += f.indexOfText(s) + f.lastIndexOfCharacter(s) + Number(f.includesCharacter(s)); } print(String(n)); }
{ let compared = 0, differ = 0; for (const [, make] of kinds) { for (const n of [1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 33]) { const text = alphabet.slice(0, n); for (const t of [text, text + "tail", "head" + text, "head" + text + "tail", "#" + text.slice(1) + "tail", text.slice(0, -1) + "#tail", "head#" + text.slice(1), "head" + text.slice(0, -1) + "#", text.slice(1), text.slice(0, -1), "", text + text, text + "é", "š" + text, text + "š", "é" + text]) { compared += 2; if (f["starts" + n](make(t)) !== g["starts" + n + "L"](make(t), 1)) differ++; if (f["ends" + n](make(t)) !== g["ends" + n + "L"](make(t), 1)) differ++; } } for (const t of hay) { compared += 5; const s = () => make(t); if (f.indexOfText(s()) !== g.indexOfTextL(s(), 1)) differ++; if (f.indexOfCharacter(s()) !== g.indexOfCharacterL(s(), 1)) differ++; if (f.lastIndexOfText(s()) !== g.lastIndexOfTextL(s(), 1)) differ++; if (f.lastIndexOfCharacter(s()) !== g.lastIndexOfCharacterL(s(), 1)) differ++; if (f.includesText(s()) !== g.includesTextL(s(), 1)) differ++; for (const at of [0, 1, 2, 7, 99, -1, 1.5, NaN, Infinity, -Infinity]) { compared += 2; if (f.indexOfFrom(s(), at) !== g.indexOfFromL(s(), at, 1)) differ++; if (f.lastIndexOfFrom(s(), at) !== g.lastIndexOfFromL(s(), at, 1)) differ++; } for (const [, other] of kinds) for (const o of ["", "n", "ne", "needle", ",", "日", "é", "y,"]) { compared += 2; if (f.indexOfString(s(), other(o)) !== g.indexOfStringL(s(), other(o), 1)) differ++; if (f.lastIndexOfString(s(), other(o)) !== g.lastIndexOfStringL(s(), other(o), 1)) differ++; } } } print("the stubs and operations against the code in place: " + compared + " compared, " + differ + " differ"); }
(globalThis as any).kept = [starts1L, ends1L, starts2L, ends2L, starts3L, ends3L, starts4L, ends4L, starts5L, ends5L, starts7L, ends7L, starts8L, ends8L, starts9L, ends9L, starts15L, ends15L, starts16L, ends16L, starts17L, ends17L, starts33L, ends33L, indexOfTextL, indexOfCharacterL, indexOfFromL, lastIndexOfTextL, lastIndexOfCharacterL, lastIndexOfFromL, includesTextL, indexOfStringL, lastIndexOfStringL, starts1, ends1, starts2, ends2, starts3, ends3, starts4, ends4, starts5, ends5, starts7, ends7, starts8, ends8, starts9, ends9, starts15, ends15, starts16, ends16, starts17, ends17, starts33, ends33, includesText, includesCharacter, indexOfText, indexOfCharacter, indexOfFrom, lastIndexOfText, lastIndexOfCharacter, lastIndexOfFrom, indexOfString, lastIndexOfString, includesString, startsString, startsAt, endsAt, startsEmpty, startsAccented, untyped, startsInLoop, recorded]; console.log("number");
