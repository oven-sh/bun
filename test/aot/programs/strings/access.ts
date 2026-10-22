// `length`, `[i]`, `at`, `charAt`, `charCodeAt` and `codePointAt` on every internal representation of a string, with every kind of index.
// CALLS- length_ CallHostFunction|operationAOT(Call|GetById)
// On a string the character is read in place. An index that may not be an integer has the general call as its fallback; an index that is an integer needs none.
// CALLS+ charCodeAt_ RopeCharacters
// CALLS+ charAt_ RopeCharacters
// CALLS+ at_ RopeCharacters
// CALLS+ codePointAt_ RopeCharacters
// CALLS+ element_ RopeCharacters
// CALLS- masked CallHostFunction|CallValue|GetByVal
// CALLS- sum CallHostFunction|CallValue|GetByVal
// CALLS+ charCodeAtOfAnything CallHostFunction|CallValue|CallMethodById
// CALLS- charCodeAtOfAnything RopeCodeUnit|SubstringCharacters|RopeCharacters
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
    () => "é",
    () => "café ßÿµ au lait",
    () => "日本語の text",
    () => "日",
    () => "a😀b\ud83d",
    () => "\ude00\ud83dx",
    () => cat("The quick ", "brown fox"),
    () => cat("abc", "日本"),
    () => cat("\ud83d", "\ude00"),
    () => cat3("one", " two ", "three"),
    () => cat(cat("a", "b"), cat("c", cat("d", "e"))),
    () => flattened(cat("The quick ", "brown fox")),
    () => part("xxThe quick brown foxxx", 2, 21),
    () => part("xx日本語の textxx", 2, 11),
    () => part(part("xxThe quick brown foxxx", 2, 21), 4, 15),
    () => part(cat("xxThe quick ", "brown foxxx"), 2, 21),
    () => flattened(part("xxThe quick brown foxxx", 2, 21)),
    () => cat(part("xxThe quick brown foxxx", 2, 12), part("xxThe quick brown foxxx", 12, 21)),
];
const indexes = [0, 1, 2, 3, 5, 18, 19, 100, -1, -2, -5, -19, -20, -100, 0.5, 1.9, -0.5, -0.999, -1.5, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 4294967297, 1e21, -1e21, -0, 9007199254740991];
export function length_(s: string): number { return s.length; }
export function element_(s: string, i: number): string { return s[i]; }
export function at_(s: string, i: number): string | undefined { return s.at(i); }
export function charAt_(s: string, i: number): string { return s.charAt(i); }
export function charCodeAt_(s: string, i: number): number { return s.charCodeAt(i); }
export function codePointAt_(s: string, i: number): number | undefined { return s.codePointAt(i); }
export function masked(s: string, i: number): string { return show(s[i & 7]) + show(s.at(i & 7)) + show(s.at(-(i & 7))) + show(s.charAt(i & 7)) + show(s.charCodeAt(i & 7)) + show(s.codePointAt(i & 7)); }
export function sum(s: string): number {
    let t = 0;
    for (let i = 0; i < s.length; i++)
        t = (t * 31 + s.charCodeAt(i) + (s.codePointAt(i) ?? 0) + s.charAt(i).length + s[i].length + (s.at(i) ?? "").length) % 1000003;
    return t;
}
export function charCodeAtOfAnything(s: any, i: any): unknown { return s.charCodeAt(i); }
export function allOfAnything(s: any, i: any): string { return show(s.length) + show(s[i]) + show(s.at(i)) + show(s.charAt(i)) + show(s.charCodeAt(i)) + show(s.codePointAt(i)); }
for (let m = 0; m < makers.length; m++) {
    const make = makers[m];
    print(m + " " + show(make()) + " length " + length_(make()) + " sum " + sum(make()));
    let line = "";
    for (const i of indexes)
        line += " " + show(element_(make(), i)) + show(at_(make(), i)) + show(charAt_(make(), i)) + show(charCodeAt_(make(), i)) + show(codePointAt_(make(), i));
    print(line);
    line = "";
    for (let i = 0; i < 9; i++)
        line += " " + masked(make(), i);
    print(line);
    line = "";
    for (const i of [0, 3, -1, 1.5, NaN, 100, "1", "x", undefined, null, true, { valueOf() { return 2; } }, [1]])
        line += " " + allOfAnything(make(), i);
    print(line);
}
// Twice on one rope: the second look finds it flat.
const rope = cat("The quick ", "brown fox");
print(show(charCodeAt_(rope, 12)) + show(charCodeAt_(rope, 3)) + show(length_(rope)) + show(charAt_(rope, 18)));
for (const nil of [undefined, null]) {
    const s = nil as unknown as string;
    print(attempt(() => length_(s)) + "; " + attempt(() => element_(s, 0)) + "; " + attempt(() => at_(s, 0)) + "; " + attempt(() => charAt_(s, 0)) + "; " + attempt(() => charCodeAt_(s, 100)) + "; " + attempt(() => codePointAt_(s, -1)));
    print(attempt(() => charCodeAtOfAnything(nil, 0)));
}
// What is no primitive string takes JavaScriptCore's function, or whatever it finds under the name.
class Shout extends String { charCodeAt(i: number): number { return -super.charCodeAt(i); } }
for (const other of [new String("boxed"), new Shout("loud"), { charCodeAt(i: number) { return i * 2; }, length: 3 }, ["ab", "cd"], 12345])
    print(attempt(() => charCodeAtOfAnything(other, 1)) + " " + attempt(() => (other as any).length) + " " + attempt(() => (other as any)[1]));
print(attempt(() => String.prototype.charCodeAt.call(12345, 1)) + attempt(() => String.prototype.at.call(true, -1)) + attempt(() => String.prototype.charAt.call({ toString() { return "obj"; } }, 2)) + attempt(() => String.prototype.codePointAt.call(undefined, 0)));
let order = "";
print(attempt(() => charCodeAtOfAnything({ charCodeAt: undefined }, (order += "argument", 0))) + " " + order);
// The functions the expectations name stay functions: one that is copied into all its callers has no code of its own.
(globalThis as any).kept = [length_, charCodeAt_, charAt_, at_, codePointAt_, element_, charCodeAtOfAnything]; console.log("number");
