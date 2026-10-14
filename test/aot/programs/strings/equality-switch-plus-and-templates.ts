// `===`, `!==`, `switch`, `+` and templates on strings.
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
export function differs(a: string, b: string): boolean { return a !== b; }
export function sameOptional(a: string | undefined, b: string | null): boolean { return a === b; }
export function sameAnything(a: unknown, b: unknown): boolean { return a === b; }
export function isText(a: string): string {
    return "" + (a === "") + (a === "x") + (a === "fox") + (a === "The quick brown fox") + (a === "The quick brown fox jumps over the lazy dog and runs") + (a !== "caf\u00e9") + (a === "\u65e5\u672c") + ("12345678" === a) + (a === "123456789") + (a === "1234567") + (a === "undefined") + (a === "null");
}
export function pick(a: string): number {
    switch (a) {
    case "": return 1;
    case "x": return 2;
    case "fox": return 3;
    case "box": return 4;
    case "The quick brown fox": return 5;
    case "caf\u00e9": return 6;
    case "\u65e5\u672c": return 7;
    case "12345678": return 8;
    }
    return 0;
}
export function plus(a: string, b: string): string { return a + b; }
export function plus3(a: string, b: string, c: string): string { return a + b + c; }
export function template(a: string, n: number, b: string): string { return `<${a}|${n}|${b}>`; }
export function plusNumber(a: string, n: number): string { return a + n + (n + a) + (a + (n | 0)); }
export function appended(a: string, n: number): string {
    let s = "";
    for (let i = 0; i < n; i++)
        s += a;
    return s;
}
const makers = [
    () => "", () => "x", () => "y", () => "fox", () => "box", () => "foy", () => "The quick brown fox", () => "The quick brown fax", () => "the quick brown fox", () => "The quick brown fox jumps over the lazy dog and runs", () => "The quick brown fox jumps over the lazy dog and rung",
    () => "12345678", () => "12345679", () => "02345678", () => "123456789", () => "1234567", () => "1234567812345678", () => "1234567812345679", () => "123456781234567812345", () => "123456781234567812346", () => "caf\u00e9", () => "cafe", () => "\u65e5\u672c", () => "\u65e5\u672d", () => "\u00e5", () => "\u65e5",
    () => cat("f", "ox"), () => cat("The quick ", "brown fox"), () => cat("1234", "5678"), () => cat("caf", "\u00e9"), () => cat("\u65e5", "\u672c"), () => cat3("The quick", " brown", " fox"), () => part("xfoxx", 1, 4), () => part("xxThe quick brown foxxx", 2, 21), () => part("x\u65e5\u672cx", 1, 3), () => part("\u65e5fox\u65e5", 1, 4),
    () => flattened(cat("f", "ox")), () => ["f", "o", "x"].join(""), () => "undefined", () => "null",
];
const keyed: Record<string, number> = {};
for (const make of makers)
    keyed[make()] = 1;
for (let m = 0; m < makers.length; m++) {
    let line = m + " " + isText(makers[m]()) + " " + pick(makers[m]()) + " ";
    for (const other of makers)
        line += (same(makers[m](), other()) ? "1" : "0") + (differs(makers[m](), other()) ? "1" : "0") + (sameOptional(makers[m](), other()) ? "1" : "0") + (sameAnything(makers[m](), other()) ? "1" : "0");
    print(line);
}
const u = undefined as unknown as string, n = null as unknown as string;
print("" + same(u, u) + same(n, n) + same(u, n) + same(u, "") + same("", n) + same(u, "undefined") + same("null", n) + differs(u, n) + differs(u, u) + differs("x", n) + sameOptional(undefined, null) + sameOptional(undefined, "") + sameOptional("", null) + " " + isText(u) + " " + isText(n) + " " + pick(u) + pick(n));
print("" + sameAnything("1", 1) + sameAnything("", 0) + sameAnything("x", new String("x")) + sameAnything("true", true) + sameAnything(cat("a", "b"), "ab") + sameAnything(Symbol.for("a"), "a") + sameAnything("1", 1n));
let total = 0;
for (const a of makers) {
    for (const b of makers) {
        const s = plus(a(), b()), t = plus3(a(), b(), a()), w = template(a(), total & 7, b());
        total = (total * 7 + s.length + 3 * t.length + 5 * w.length + (s.length ? s.charCodeAt(s.length - 1) : 0) + (t.length ? t.charCodeAt(t.length >> 1) : 0) + w.charCodeAt(w.length >> 1) + (same(s, plus(a(), b())) ? 1 : 0)) % 1000003;
    }
}
print("concatenation " + total);
print(show(plus("", "")) + show(plus("a", "")) + show(plus("", "b")) + show(plus3("", "", "")) + show(plus3("", "b", "")) + show(plus(u, "x")) + show(plus("x", n)) + show(template(u, -0, n)) + show(plusNumber("a", 1.5)) + show(plusNumber("", -0)) + show(plusNumber("\u65e5", 1e21)));
print(show(appended("ab", 5)) + appended("\u65e5x", 1000).length + appended("", 10).length + show(appended("abc", 100).slice(148, 152)) + show(appended("abc", 100).charCodeAt(299)) + appended("abc", 100).lastIndexOf("c"));
const big = "x".repeat(1 << 30);
print(attempt(() => plus(big, big).length) + attempt(() => plus3(big, "", "").length) + attempt(() => plus3(big, big, big).length) + attempt(() => template(big, 1, big).length));
