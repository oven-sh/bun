// `indexOf`, `includes`, `lastIndexOf`, `startsWith` and `endsWith`.
// CALLS+ indexOfCharacter StringFindCharacter
// CALLS+ includesCharacter StringFindCharacter
// CALLS+ lastIndexOfCharacter operationAOTStringReverseFindCharacter8|operationAOTStringLastIndexOfLiteral
// CALLS+ indexOf1 StringFindString
// CALLS+ includes1 StringFindString
// CALLS+ lastIndexOf1 operationAOTStringReverseFind8|operationAOTStringLastIndexOf
// CALLS- searchKnown CallHostFunction|CallValue
// CALLS+ searchKnown StringFindString
// CALLS+ searchKnown operationAOTStringReverseFind8|operationAOTStringLastIndexOf
// CALLS- startsWithKnown CallHostFunction|CallValue|OperationValueWithInstance
// CALLS- endsWithKnown CallHostFunction|CallValue|OperationValueWithInstance
// CALLS- startsWithText CallHostFunction|CallValue|operationAOTStringConstant
// CALLS+ indexOfAnything CallHostFunction|CallValue|Call1
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
    () => "The quick brown fox",
    () => "",
    () => "x",
    () => "caf\u00e9 \u00df\u00ff\u00b5 au lait",
    () => "\u65e5\u672c\u8a9e\u306e text",
    () => "a\ud83d\ude00b\ud83d",
    () => cat("The quick ", "brown fox"),
    () => cat("abc", "\u65e5\u672c"),
    () => cat3("one", " two ", "three"),
    () => flattened(cat("The quick ", "brown fox")),
    () => part("xxThe quick brown foxxx", 2, 21),
    () => part("xx\u65e5\u672c\u8a9e\u306e textxx", 2, 11),
    () => part(part("xxThe quick brown foxxx", 2, 21), 4, 15),
    () => part(cat("xxThe quick ", "brown foxxx"), 2, 21),
    () => flattened(part("xxThe quick brown foxxx", 2, 21)),
    () => cat("a".repeat(200), "b".repeat(200) + "z" + "c".repeat(10)),
    () => cat("\u65e5".repeat(200), "b".repeat(200) + "z"),
    () => "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab",
    () => "abababababababababababababababababababababababababababababababc",
];
const needles = [
    () => "", () => "x", () => "o", () => "T", () => "fox", () => "The", () => "quick", () => " ", () => "brown fox", () => "The quick brown fox", () => "The quick brown fox!", () => "\u00e9", () => "\u00ff\u00b5", () => "\u65e5", () => "\u672c\u8a9e",
    () => "\ud83d", () => "\ude00b", () => "text", () => "z", () => "bz", () => "zc", () => "ab", () => "aab", () => "ababc", () => "aaaaaaaaab", () => "abababababc", () => cat("f", "ox"), () => cat("qu", "ick"), () => part("xfoxx", 1, 4), () => cat("\u672c", "\u8a9e"), () => "undefined", () => "null",
];
const positions = [0, 1, 4, 16, 17, 18, 19, 20, 100, 399, 400, 401, -1, -100, 0.5, 16.9, NaN, Infinity, -Infinity, 2147483648, -2147483649, 1e21, -0];
export function indexOf1(s: string, x: string): number { return s.indexOf(x); }
export function indexOf2(s: string, x: string, p: number): number { return s.indexOf(x, p); }
export function includes1(s: string, x: string): boolean { return s.includes(x); }
export function includes2(s: string, x: string, p: number): boolean { return s.includes(x, p); }
export function lastIndexOf1(s: string, x: string): number { return s.lastIndexOf(x); }
export function lastIndexOf2(s: string, x: string, p: number): number { return s.lastIndexOf(x, p); }
export function lastIndexOfMasked(s: string, x: string, p: number): number { return s.lastIndexOf(x, p & 31) * 100 + s.lastIndexOf(x, -(p & 31)); }
export function startsWith1(s: string, x: string): boolean { return s.startsWith(x); }
export function startsWith2(s: string, x: string, p: number): boolean { return s.startsWith(x, p); }
export function endsWith1(s: string, x: string): boolean { return s.endsWith(x); }
export function endsWith2(s: string, x: string, p: number): boolean { return s.endsWith(x, p); }
export function searchKnown(s: string, x: string): number { const a = `${s}`, b = `${x}`; return a.indexOf(b) + (a.includes(b) ? 1000 : 0) + 7 * a.lastIndexOf(b); }
export function startsWithKnown(s: string, x: string): boolean { const a = `${s}`, b = `${x}`; return a.startsWith(b); }
export function endsWithKnown(s: string, x: string): boolean { const a = `${s}`, b = `${x}`; return a.endsWith(b); }
export function indexOfCharacter(s: string): number { return s.indexOf("o"); }
export function includesCharacter(s: string): boolean { return s.includes("z"); }
export function lastIndexOfCharacter(s: string): number { return s.lastIndexOf("o"); }
export function charactersFrom(s: string, p: number): string { return s.indexOf("o", p) + "," + s.includes(" ", p) + "," + s.lastIndexOf("o", p & 31) + "," + s.indexOf("\u00e9", p) + "," + s.indexOf("\u65e5", p) + "," + s.indexOf("", p) + "," + s.lastIndexOf("", p & 31); }
export function startsWithText(s: string): string { return "" + s.startsWith("The") + s.startsWith("The quick brown fox") + s.startsWith("") + s.startsWith("x") + s.endsWith("fox") + s.endsWith("x") + s.endsWith("") + s.startsWith("quick", 4) + s.endsWith("quick", 9) + s.startsWith("The quick brown fox jumps over the lazy dog and runs away") + s.startsWith("\u65e5") + s.endsWith("\u00b5 au lait"); }
export function indexOfAnything(s: any, x: any): unknown { return s.indexOf(x); }
export function searchAnything(s: any, x: any, p: any): string { return show(s.indexOf(x, p)) + show(s.includes(x, p)) + show(s.lastIndexOf(x, p)) + show(s.startsWith(x, p)) + show(s.endsWith(x, p)); }
for (let m = 0; m < makers.length; m++) {
    const make = makers[m];
    let line = m + " " + make().length + ":";
    for (const needle of needles)
        line += " " + indexOf1(make(), needle()) + "," + includes1(make(), needle()) + "," + lastIndexOf1(make(), needle()) + "," + startsWith1(make(), needle()) + "," + endsWith1(make(), needle()) + "," + searchKnown(make(), needle()) + startsWithKnown(make(), needle()) + endsWithKnown(make(), needle());
    print(line);
    print(" " + indexOfCharacter(make()) + " " + includesCharacter(make()) + " " + lastIndexOfCharacter(make()) + " " + startsWithText(make()));
    let t = 0;
    line = "";
    for (const p of positions) {
        line += " " + charactersFrom(make(), p);
        for (const needle of needles) {
            t = (t * 7 + indexOf2(make(), needle(), p) + 3 * lastIndexOf2(make(), needle(), p) + lastIndexOfMasked(make(), needle(), p) + (includes2(make(), needle(), p) ? 11 : 0) + (startsWith2(make(), needle(), p) ? 13 : 0) + (endsWith2(make(), needle(), p) ? 17 : 0) + 1000) % 1000003;
        }
    }
    print(line);
    print(" with positions " + t);
    line = "";
    for (const [x, p] of [["o", 1], [undefined, undefined], ["o", undefined], [null, 0], [1, 0], ["", "2"], [{ toString() { return "fox"; } }, { valueOf() { return 2; } }], [["o"], null], [true, 0], ["o", "x"], ["o", NaN]])
        line += " " + searchAnything(make(), x, p);
    print(line);
}
print(show(indexOf1("undefined and null", undefined as unknown as string)) + show(includes1("undefined and null", null as unknown as string)) + show(lastIndexOf1("x", undefined as unknown as string)) + show(startsWith1("undefined", undefined as unknown as string)) + show(endsWith1("is null", null as unknown as string)));
for (const nil of [undefined, null]) {
    const s = nil as unknown as string;
    print(attempt(() => indexOf1(s, "a")) + attempt(() => includes1(s, "a")) + attempt(() => lastIndexOf1(s, "a")) + attempt(() => startsWith1(s, "a")) + attempt(() => endsWith1(s, "a")) + attempt(() => indexOfCharacter(s)) + attempt(() => startsWithText(s)) + attempt(() => indexOfAnything(nil, "a")));
}
print(attempt(() => searchAnything("a/b/", /b/, 0)) + attempt(() => ("a/b/" as any).indexOf(/b/)) + attempt(() => ("a/b/" as any).includes(/b/)) + attempt(() => ("a/b/" as any).startsWith(/a/)) + attempt(() => ("a/b/" as any).endsWith(/b/)));
print(attempt(() => indexOfAnything("abc", Symbol("b"))) + attempt(() => indexOfAnything([1, "b", 3], "b")) + attempt(() => indexOfAnything(new String("abc"), "c")) + attempt(() => indexOfAnything({ indexOf() { return "mine"; } }, "c")));
let order = "";
print(show(("abcabc" as any).indexOf({ toString() { order += "x"; return "c"; } }, { valueOf() { order += "p"; return 3; } })) + order);
// The functions that the expectations name must stay functions: one that is inlined into all of its callers has no code of its own.
(globalThis as any).kept = [indexOfCharacter, includesCharacter, lastIndexOfCharacter, indexOf1, includes1, lastIndexOf1, searchKnown, startsWithKnown, endsWithKnown, startsWithText, indexOfAnything]; console.log("number");
