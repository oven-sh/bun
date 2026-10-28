// `slice`, `substring` and `substr` on every internal representation of a string, with every kind of position.
// CALLS- slice2 CallHostFunction|CallValue
// CALLS- slice1 CallHostFunction|CallValue
// CALLS- substring2 CallHostFunction|CallValue
// CALLS- substr2 CallHostFunction|CallValue
// CALLS+ sliceOfAnything CallHostFunction|CallValue|Call2
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
];
const places = [0, 1, 2, 4, 5, 18, 19, 20, 100, -1, -2, -4, -18, -19, -20, -100, 0.5, 1.9, -0.5, -1.5, NaN, Infinity, -Infinity, 2147483648, -2147483649, 4294967297, 1e21, -1e21, -0];
export function slice1(s: string, a: number): string { return s.slice(a); }
export function slice2(s: string, a: number, b: number): string { return s.slice(a, b); }
export function substring1(s: string, a: number): string { return s.substring(a); }
export function substring2(s: string, a: number, b: number): string { return s.substring(a, b); }
export function substr1(s: string, a: number): string { return s.substr(a); }
export function substr2(s: string, a: number, b: number): string { return s.substr(a, b); }
export function masked(s: string, i: number): string { return show(s.slice(i & 7, 12)) + show(s.slice(-(i & 7))) + show(s.substring(i & 7, i & 3)) + show(s.substr(i & 7, i & 3)) + show(s.slice(i & 3, -(i & 3))); }
export function sliceOfAnything(s: any, a: any, b: any): unknown { return s.slice(a, b); }
export function partsOfAnything(s: any, a: any, b: any): string { return show(s.slice(a, b)) + show(s.substring(a, b)) + show(s.substr(a, b)) + show(s.slice(a)) + show(s.slice()); }
function hash(s: string): number {
    let t = s.length;
    for (let i = 0; i < s.length; i++)
        t = (t * 31 + s.charCodeAt(i)) % 1000003;
    return t;
}
for (let m = 0; m < makers.length; m++) {
    const make = makers[m];
    let line = m + " " + show(make());
    for (const a of places)
        line += " " + show(slice1(make(), a)) + show(substring1(make(), a)) + show(substr1(make(), a));
    print(line);
    // All pairs: by a checksum, and by the length of the result, which a rope knows without being flattened.
    let t = 0;
    for (const a of places) {
        for (const b of places) {
            const x = slice2(make(), a, b), y = substring2(make(), a, b), z = substr2(make(), a, b);
            t = (t * 7 + x.length + 3 * y.length + 5 * z.length + hash(x) + hash(y) + hash(z)) % 1000003;
        }
    }
    print(" pairs " + t);
    line = "";
    for (let i = 0; i < 9; i++)
        line += " " + masked(make(), i);
    print(line);
    line = "";
    for (const [a, b] of [[1, 3], [undefined, undefined], [1, undefined], [undefined, 3], [null, 2], ["1", "3"], ["x", 2], [true, 3], [{ valueOf() { return 1; } }, [3]], [-2, undefined], [2, 1]])
        line += " " + partsOfAnything(make(), a, b);
    print(line);
}
// A substring of a substring of a substring, and strings built from substrings.
let rest = "one,two,three,four,five,six,seven";
let seen = "";
while (rest.length > 0) {
    const comma = rest.indexOf(",");
    seen += "[" + (comma < 0 ? rest : rest.slice(0, comma)) + "]";
    rest = comma < 0 ? "" : rest.slice(comma + 1);
}
print(seen);
for (const nil of [undefined, null]) {
    const s = nil as unknown as string;
    print(attempt(() => slice1(s, 0)) + attempt(() => slice2(s, 0, 1)) + attempt(() => substring2(s, 0, 1)) + attempt(() => substr2(s, 0, 1)) + attempt(() => sliceOfAnything(nil, 0, 1)));
}
class Odd extends String { slice(): string { return "overridden"; } }
for (const other of [new String("boxed string"), new Odd("odd"), [1, 2, 3, 4], { slice(a: number, b: number) { return a + b; } }, new Uint8Array([1, 2, 3, 4])])
    print(attempt(() => String(sliceOfAnything(other, 1, 3))));
print(attempt(() => String.prototype.slice.call(12345, 1, 3)) + attempt(() => String.prototype.substring.call(true, 1)) + attempt(() => String.prototype.substr.call({ toString() { return "object"; } }, 2, 2)) + attempt(() => String.prototype.slice.call(null, 0)));
let order = "";
print(show(sliceOfAnything("abcdef", { valueOf() { order += "a"; return 1; } }, { valueOf() { order += "b"; return 4; } })) + order);
// The functions that the expectations name must stay functions: one that is inlined into all of its callers has no code of its own.
(globalThis as any).kept = [slice2, slice1, substring2, substr2, sliceOfAnything]; console.log("number");
