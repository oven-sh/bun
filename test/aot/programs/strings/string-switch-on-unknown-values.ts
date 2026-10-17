// `switch` and `if .. else if` over string literals on a value of unknown type.
// CALLS+ whichAny ^whichAny: ([0-9]{1,2}|1[0-9]{2}|2[0-4][0-9]) instructions
// CALLS- whichAny StrictEqual
// CALLS- oneLength Flatten
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

const unseen = (f: any): any => new Function("f", "return (...a) => f(...a)")(f);
export function whichAny(s: any): number { switch (s) { case "lit": return 1; case "other": return 2; case "literal": return 3; case "li": return 4; case "abcdef": return 5; case "LIT": return 6; default: return 0; } }
export function whichUnknown(s: unknown): number { if (s === "lit") return 1; else if (s === "other") return 2; else if (s === "literal") return 3; else if (s === "li") return 4; else if (s === "abcdef") return 5; else if (s === "LIT") return 6; return 0; }
export function whichOrNumber(s: string | number): number { switch (s) { case "lit": return 1; case "other": return 2; case 7: return 7; case "li": return 4; default: return 0; } }
export function whichOrObject(s: string | { a: number } | null): number { if (s === "lit") return 1; if (s === "LIT") return 6; if (s === null) return -1; return 0; }
export function whichOrSymbol(s: string | symbol | bigint | boolean | undefined): number { if (s === "lit") return 1; else if (s === "true") return 2; else if (s === "undefined") return 3; return 0; }
export function oneLength(s: any): number { if (s === "abc") return 1; else if (s === "abd") return 2; else if (s === "xyz") return 3; return 0; }
export function single(s: any): boolean { if (s === "literal") return true; return false; }
export function negated(s: any): number { if (s !== "lit") { if (s !== "other") return 0; return 2; } return 1; }
export function inLoop(list: any[]): number { let n = 0; for (const s of list) { switch (s) { case "lit": n += 1; break; case "other": n += 20; break; case "literal": n += 300; break; default: n += 4000; } } return n; }
export function longTexts(s: any): number { switch (s) { case "a text of more than thirty-two characters": return 1; case "another text of over thirty-two characters": return 2; case "short": return 3; default: return 0; } }
export function fallsThrough(s: any): string { let r = ""; switch (s) { case "lit": r += "a"; case "other": r += "b"; break; case "li": r += "c"; default: r += "d"; } return r; }
const fresh = (x: string): string => String.fromCharCode(...[...x].map(c => c.charCodeAt(0)));
const kinds: [string, (s: string) => unknown][] = [["same", s => s], ["fresh", fresh], ["wide", s => ("日" + fresh(s)).slice(1)], ["rope", s => s.length < 2 ? s : fresh(s.slice(0, 1)) + fresh(s.slice(1))], ["part", s => fresh("<<" + s + ">>").substring(2, 2 + s.length)],
    ["partOfWide", s => fresh("日<" + s + ">").substring(2, 2 + s.length)], ["object", s => new String(s)], ["array", s => [s]], ["boxedToString", s => ({ toString: () => s, valueOf: () => s })], ["symbol", s => Symbol(s)]];
const texts = ["lit", "other", "literal", "li", "abcdef", "LIT", "", "l", "lix", "abc", "abd", "xyz", "abx", "true", "undefined", "short", "a text of more than thirty-two characters", "another text of over thirty-two characters", "a text of more than thirty-two characterz", "café", "lit"];
const strangers: unknown[] = [undefined, null, true, false, 0, -0, 7, 7.5, NaN, 10n, {}, [], () => "lit", Symbol.iterator, new Date(0), /lit/];
// A parameter with a type is given what fits it: anything else is turned away at the door, which is not what is tested here. Of the kinds the first six are strings.
const all: [string, any, number, unknown[]][] = [["whichAny", whichAny, kinds.length, strangers], ["whichUnknown", whichUnknown, kinds.length, strangers], ["whichOrNumber", whichOrNumber, 6, [0, -0, 7, 7.5, NaN, 1e21]], ["whichOrObject", whichOrObject, 6, [null, { a: 1 }]],
    ["whichOrSymbol", whichOrSymbol, 6, [Symbol("lit"), Symbol.iterator, 10n, true, false, undefined]], ["oneLength", oneLength, kinds.length, strangers], ["single", single, kinds.length, strangers], ["negated", negated, kinds.length, strangers], ["longTexts", longTexts, kinds.length, strangers],
    ["fallsThrough", fallsThrough, kinds.length, strangers]];
for (const [name, f, count] of all) { const g = unseen(f); for (const [kind, make] of kinds.slice(0, count)) print(name + " " + kind + ": " + texts.map(t => g(make(t))).join()); }
for (const [name, f, , others] of all) print(name + " strangers: " + others.map(v => unseen(f)(v)).join());
for (const [kind, make] of kinds) print("inLoop " + kind + ": " + unseen(inLoop)(texts.map(make)));
print("inLoop strangers: " + unseen(inLoop)(strangers));
(globalThis as any).kept = [all, inLoop]; console.log("number");
