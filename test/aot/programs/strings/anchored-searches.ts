// Searches that can match at one position only: `s.lastIndexOf(x, 0)` and `s.indexOf(x, s.length - x.length)`, the idioms from before `startsWith` and `endsWith`.
// CALLS- oldStartsWith ReverseFind|LastIndexOf
// CALLS- oldStartsWithDot ReverseFind|LastIndexOf
// CALLS- oldStartsWithText ReverseFind|LastIndexOf
// CALLS- lastIndexOfBelowZero ReverseFind|LastIndexOf
// CALLS+ lastIndexOfOne operationAOTStringReverseFind8|operationAOTStringLastIndexOf
// CALLS+ lastIndexOfAnywhere operationAOTStringReverseFind8|operationAOTStringLastIndexOf
// CALLS+ oldEndsWith StringFindString
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
const makers = [
    () => "The quick brown fox", () => "", () => "x", () => ".", () => ".ts", () => "a.ts", () => "café ßÿµ au lait", () => "日本語の text", () => "a😀b\ud83d",
    () => cat("The quick ", "brown fox"), () => cat("abc", "日本"), () => cat3("one", " two ", "three"), () => flattened(cat("The quick ", "brown fox")),
    () => part("xxThe quick brown foxxx", 2, 21), () => part("xx日本語の textxx", 2, 11), () => part(part("xxThe quick brown foxxx", 2, 21), 4, 15), () => part(cat("xxThe quick ", "brown foxxx"), 2, 21),
    () => cat("a".repeat(200), "b".repeat(200) + "z" + "c".repeat(10)), () => cat("日".repeat(200), "b".repeat(200) + "z"), () => "/usr/lib/node_modules/typescript/lib/lib.es2015.core.d.ts", () => cat("/usr/lib/", "lib.d.ts"),
    () => flattened(cat("日", "/src/index.ts")).slice(1), () => "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab", () => "abcdefgh", () => "abcdefghi", () => "abcdefg",
];
const needles = [
    () => "", () => "x", () => ".", () => "T", () => "fox", () => "The", () => "The ", () => "quick", () => " ", () => "brown fox", () => "The quick brown fox", () => "The quick brown fox!", () => "é", () => "café", () => "lait",
    () => "日", () => "日本", () => "text", () => "\ud83d", () => "a\ud83d", () => "z", () => "ccc", () => ".ts", () => ".d.ts", () => "d.ts", () => "/usr", () => "/", () => cat("f", "ox"), () => cat("Th", "e"), () => part("xfoxx", 1, 4),
    () => part("x日x", 1, 2), () => "abcdefgh", () => "abcdefg", () => "bcdefgh", () => "abcdefghi", () => "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab", () => "aaaaaaaaaaaaaaaaab", () => "one two three", () => " three", () => "one ",
];
export function oldStartsWith(s: string, x: string): boolean { return s.lastIndexOf(x, 0) === 0; }
export function oldStartsWithDot(s: string): boolean { return s.lastIndexOf(".", 0) === 0; }
export function oldStartsWithText(s: string): number { return s.lastIndexOf("The quick", 0); }
export function lastIndexOfAtZero(s: string, x: string): number { return s.lastIndexOf(x, 0); }
export function lastIndexOfBelowZero(s: string, x: string): number { return s.lastIndexOf(x, -3); }
export function lastIndexOfOne(s: string, x: string): number { return s.lastIndexOf(x, 1); }
export function lastIndexOfAnywhere(s: string, x: string, p: number): number { return s.lastIndexOf(x, p | 0); }
export function oldEndsWith(s: string, x: string): boolean { const expected = s.length - x.length; return expected >= 0 && s.indexOf(x, expected) === expected; }
export function indexOfFrom(s: string, x: string, p: number): number { return s.indexOf(x, p); }
export function includesFrom(s: string, x: string, p: number): boolean { return s.includes(x, p); }
export function indexOfTextFrom(s: string, p: number): number { return s.indexOf(".ts", p); }
export function indexOfDotFrom(s: string, p: number): number { return s.indexOf(".", p); }
for (let i = 0; i < makers.length; i++) {
    let line = show(makers[i]()).slice(0, 24) + ":";
    for (let j = 0; j < needles.length; j++) {
        const length = makers[i]().length, other = needles[j]().length;
        line += " " + (oldStartsWith(makers[i](), needles[j]()) ? 1 : 0) + lastIndexOfAtZero(makers[i](), needles[j]()) + lastIndexOfBelowZero(makers[i](), needles[j]()) + lastIndexOfOne(makers[i](), needles[j]()) + (oldEndsWith(makers[i](), needles[j]()) ? 1 : 0);
        if (oldStartsWith(makers[i](), needles[j]()) !== makers[i]().startsWith(needles[j]()) || oldEndsWith(makers[i](), needles[j]()) !== makers[i]().endsWith(needles[j]()))
            line += "DIFFERS";
        for (const p of [length - other - 2, length - other - 1, length - other, length - other + 1, length - other + 2, length - 1, length, length + 1, 0, -1, 0.5, length - other + 0.5, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32 + 1, -(2 ** 31)])
            line += "," + indexOfFrom(makers[i](), needles[j](), p) + (includesFrom(makers[i](), needles[j](), p) ? "t" : "f");
        for (const p of [0, -1, 1, -(2 ** 31), 2 ** 31 - 1, length - other, length])
            line += ";" + lastIndexOfAnywhere(makers[i](), needles[j](), p);
    }
    let sum = 0;
    for (let k = 0; k < line.length; k++)
        sum = (sum * 31 + line.charCodeAt(k)) | 0;
    print(line.slice(0, 150) + " .. " + line.length + " " + sum);
    let known = "";
    for (const p of [makers[i]().length - 4, makers[i]().length - 3, makers[i]().length - 2, makers[i]().length - 1, makers[i]().length, 0, -5])
        known += " " + indexOfTextFrom(makers[i](), p) + "," + indexOfDotFrom(makers[i](), p);
    print("  " + oldStartsWithDot(makers[i]()) + " " + oldStartsWithText(makers[i]()) + known);
}
function nil(): any { return makers.length > 1000 ? "" : undefined; }
print(attempt(() => oldStartsWith(nil(), "x")) + " " + attempt(() => oldStartsWithDot(nil())) + " " + attempt(() => oldEndsWith(nil(), "x")) + " " + attempt(() => lastIndexOfAtZero("undefined", nil())) + " " + attempt(() => indexOfFrom("xundefined", nil(), 1)));
// The functions that the expectations name must stay functions: one that is inlined into all of its callers has no code of its own.
(globalThis as any).kept = [oldStartsWith, oldStartsWithDot, oldStartsWithText, lastIndexOfBelowZero, lastIndexOfOne, lastIndexOfAnywhere, oldEndsWith]; console.log("number");
