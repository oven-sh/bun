// String concatenations with numbers among their operands, and their use as property keys.
// CALLS- pairKey operationAOTConcatenate
// CALLS- templateKey operationAOTConcatenate
// CALLS- idAndAlias operationAOTConcatenate
// CALLS- three operationAOTConcatenate
// CALLS- named operationAOTConcatenate
// CALLS- stringsOnly operationAOTConcatenate
// CALLS- handled operationAOTConcatenate
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
interface T { id: number; name: string }
export function pairKey(a: T, b: T): string { return a.id + "," + b.id; }
export function templateKey(a: T, b: T, postfix: string): string { return `${a.id},${b.id}${postfix}`; }
export function idAndAlias(a: T, alias: string): string { return a.id + alias; }
export function aliasAndId(alias: string, a: T): string { return alias + a.id; }
export function three(a: number, b: number, c: number): string { return a + ":" + b + ":" + c; }
export function named(a: T, n: number): string { return a.name + "#" + n; }
export function stringsOnly(a: T, b: T): string { return a.name + "," + b.name; }
export function withBoolean(a: T, flag: boolean): string { return a.id + "," + flag; }
export function usedTwice(a: T, b: T): string { const head = a.id + ","; return head + b.id + head; }
export function textTwice(a: T): string { const text = "" + a.id; return text + "/" + text; }
export function manyParts(a: number): string { return a + "a" + a + "b" + a + "c" + a + "d" + a + "e" + a; }
export function longConstant(a: number): string { return "0123456789012345678901234567890123456789012345678901234" + a; }
export function appended(ids: number[]): string { let result = ""; for (const id of ids) { if (result.length) result += ","; result += id; } return result; }
export function between(a: T, b: T, log: string[]): string { const head = a.name + a.id; log.push("between"); return head + b.id; }
export function handled(a: T, b: T): string { try { return a.id + "," + b.id; } catch { return a.id + "!"; } }
export function integers(s: string, i: number): string { return s.length + ":" + (i | 0) + ":" + (i >>> 0); }
const numbers = [0, -0, 1, 9, 10, 1023, 1024, 65535, 123456, 2147483647, 2147483648, -1, -2147483648, -2147483649, 4294967295, 2 ** 53, -(2 ** 53), 1e21, 1e-7, 0.1, -0.5, 1.5, NaN, Infinity, -Infinity, 1e300, 5e-324];
const strings = ["", "x", "@12", "café", "日本", "a".repeat(30), "a".repeat(40), "a".repeat(41), "a".repeat(42), "a".repeat(52), "a".repeat(53), "a".repeat(64), "a".repeat(200), cat("ab", "cd"), cat3("a", "b", "c"), part("xxabcdefxx", 2, 8), flattened(cat("ab", "cd")), cat("日", "x")];
function check(made: string, expected: string, what: string): string { return made === expected && made.length === expected.length ? "" : " DIFFERS " + what + " " + show(made) + " " + show(expected); }
let bad = "", sum = 0;
function note(s: string): void { for (let i = 0; i < s.length; i++) sum = (sum * 31 + s.charCodeAt(i)) | 0; }
for (const x of numbers) {
    for (const y of numbers) {
        const a: T = { id: x, name: "n" + x }, b: T = { id: y, name: "m" };
        const X = String(x), Y = String(y);
        bad += check(pairKey(a, b), [X, Y].join(","), "pairKey") + check(three(x, y, x), [X, Y, X].join(":"), "three") + check(usedTwice(a, b), X + "," + Y + X + ",", "usedTwice") + check(handled(a, b), [X, Y].join(","), "handled");
        note(pairKey(a, b)); note(withBoolean(a, y > 0));
        for (const s of strings) {
            bad += check(templateKey(a, b, s), [X, Y].join(",").concat(s), "templateKey");
            if (x === y)
                bad += check(idAndAlias(a, s), X.concat(s), "idAndAlias") + check(aliasAndId(s, a), s.concat(X), "aliasAndId") + check(named({ id: 0, name: s }, x), s.concat("#", X), "named") + check(stringsOnly({ id: 0, name: s }, b), s.concat(",m"), "stringsOnly");
        }
    }
    bad += check(textTwice({ id: x, name: "" }), String(x) + "/" + String(x), "textTwice") + check(manyParts(x), [x, x, x, x, x, x].map(String).join("?").replace("?", "a").replace("?", "b").replace("?", "c").replace("?", "d").replace("?", "e"), "manyParts");
    bad += check(longConstant(x), "0123456789012345678901234567890123456789012345678901234".concat(String(x)), "longConstant") + check(integers("abc", x), "3:" + String(x | 0) + ":" + String(x >>> 0), "integers");
}
print("differences:" + bad + " " + sum);
print(appended([]) + "|" + appended([5]) + "|" + appended([1, 22, 333, 4444, 55555, 666666, 7777777, 88888888, 999999999, 1.5, -0, NaN]) + "|" + appended(Array.from({ length: 40 }, (_, i) => i * 1000)).length);
const log: string[] = [];
print(between({ id: 1, name: "n" }, { id: 2, name: "" }, log) + " " + log.join());
// As keys: a string created flat and the same string created any other way are the same key.
const map = new Map<string, number>(), set = new Set<string>(), record: Record<string, number> = {};
for (let i = 0; i < 300; i++) { const a: T = { id: i * 37, name: "" }, b: T = { id: 100000 - i, name: "" }; map.set(pairKey(a, b), i); set.add(templateKey(a, b, i & 1 ? "" : ":1")); record[idAndAlias(a, "@" + i)] = i; }
let found = 0;
for (let i = 0; i < 300; i++) {
    const plain = String(i * 37) + "," + String(100000 - i);
    if (map.get(plain) === i) found++;
    if (map.get(pairKey({ id: i * 37, name: "" }, { id: 100000 - i, name: "" })) === i) found++;
    if (set.has(plain + (i & 1 ? "" : ":1"))) found++;
    if (record[String(i * 37) + "@" + String(i)] === i) found++;
    if (map.has(three(i, i, i))) found--;
}
print("found " + found + " of 1200; " + map.size + " " + set.size + " " + Object.keys(record).length + " " + [...map.keys()].slice(0, 3).join(" "));
function nil(): any { return numbers.length > 1000 ? { id: 1, name: "" } : undefined; }
print(attempt(() => pairKey(nil(), { id: 1, name: "" })) + " " + attempt(() => pairKey({ id: 1, name: "" }, nil())) + " " + attempt(() => templateKey({ id: 1, name: "" }, nil(), "")));
(globalThis as any).kept = [pairKey, templateKey, idAndAlias, aliasAndId, three, named, stringsOnly, withBoolean, usedTwice, textTwice, manyParts, longConstant, appended, between, handled, integers]; console.log("number");
