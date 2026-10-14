// `switch (s)` and chains of `s === "literal"` compare the length first and then the characters.
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
export function kindOf(s: string): number {
    switch (s) {
        case "lit": return 1; case "other": return 2; case "literal": return 3; case "li": return 4; case "LIT": return 5; case "abcdef": return 6; case "abcdeg": return 7; case "x": return 8;
        case "0123456789012345678901234567890": return 9; case "01234567890123456789012345678901": return 10; case "012345678901234567890123456789012": return 11; case "": return 12; case "café": return 13; case "日本": return 14;
        case "lit": return 15;
        default: return 0;
    }
}
export function chain(s: string): string {
    if (s === "get") return "G"; else if (s === "set") return "S"; else if ("has" === s) return "H"; else if (s === "delete") return "D"; else if (s === "getOwn") return "O";
    return "?";
}
export function either(s: string): boolean { return s === "yes" || s === "y" || s === "true" || s === "on" || s === "1"; }
export function both(s: string, t: string): number { let n = 0; if (s === "a1" && t === "b1") n += 1; if (s === "a1" && t === "b2") n += 2; if (s === "a2") n += 4; else if (t === "b1") n += 8; else if (s === "a3") n += 16; return n; }
export function grouped(s: string): number { let n = 0; switch (s) { case "one": case "uno": case "eins": n += 1; case "two": n += 2; break; default: n += 100; case "three": n += 3; break; case "four": n += 4; } return n; }
export function asValue(s: string): boolean { const is = s === "lit"; return is; }
export function negated(s: string): number { if (s !== "lit") { if (s !== "other") return 0; return 2; } return 1; }
export function optional(s: string | undefined | null): number { switch (s) { case "lit": return 1; case "undefined": return 2; case "null": return 3; case undefined: return 4; case null: return 5; default: return 0; } }
export function inLoop(words: string[]): number { let n = 0; for (const w of words) { switch (w) { case "lit": n += 1; break; case "other": n += 10; continue; case "li": n += 100; break; default: n += 1000; } n += 5; } return n; }
export function between(s: string, log: string[]): number { if (s === "lit") return 1; log.push(s); if (s === "other") return 2; return 0; }
export function keeps(s: string): string { switch (s) { case "lit": return s + "!"; case "other": return "other"; default: return s; } }
const wideBase = "日lit日other日literal日x日get日日yes日one";
const subjects = ["lit", "other", "literal", "li", "LIT", "abcdef", "abcdeg", "abcdeh", "x", "y", "", "l", "lis", "liu", "Lit", "lit ", " lit", "0123456789012345678901234567890", "01234567890123456789012345678901", "012345678901234567890123456789012", "0123456789012345678901234567890x", "café", "cafe", "日本", "日", "日札",
    "get", "set", "has", "delete", "getOwn", "getown", "yes", "y", "true", "on", "1", "no", "a1", "a2", "a3", "b1", "b2", "one", "uno", "eins", "two", "three", "four", "five", "undefined", "null",
    cat("l", "it"), cat3("o", "th", "er"), cat("liter", "al"), cat("", "lit"), cat("abc", "deg"), part("xxlitxx", 2, 5), part("xxotherxx", 2, 7), part("xx", 1, 2), flattened(cat("l", "it")), part(wideBase, 1, 4), part(wideBase, 5, 10), part(wideBase, 11, 18), part(wideBase, 19, 20), part(wideBase, 21, 24), part(wideBase, 25, 25), part(wideBase, 26, 29), part(wideBase, 30, 33), cat(part(wideBase, 1, 3), "t"), cat("l", part(wideBase, 2, 4)), "lit".repeat(50), cat("lit".repeat(400), "x")];
for (const s of subjects) print(show(s.length > 40 ? s.slice(0, 8) + s.length : s) + " " + kindOf(s) + chain(s) + (either(s) ? "T" : "F") + grouped(s) + (asValue(s) ? "T" : "F") + negated(s) + optional(s) + " " + show(keeps(s).slice(0, 12)));
let sum = 0; for (const s of ["a1", "a2", "a3", "a4", cat("a", "1")]) for (const t of ["b1", "b2", "b3", part("xb1", 1, 3)]) sum = sum * 3 + both(s, t) | 0;
print("both " + sum + " loop " + inLoop(subjects) + " " + inLoop([]) + " optional " + optional(undefined) + optional(null) + optional(part("xundefined", 1, 10)));
const log: string[] = []; print(between("lit", log) + " " + between("other", log) + " " + between(cat("o", "ther"), log) + " " + between("", log) + " " + log.join("|"));
function nil(which: number): any { return subjects.length > 1000 ? "lit" : which ? null : undefined; }
print(attempt(() => kindOf(nil(0))) + " " + attempt(() => kindOf(nil(1))) + " " + attempt(() => chain(nil(0))) + " " + attempt(() => either(nil(1))) + " " + attempt(() => grouped(nil(0))) + " " + attempt(() => negated(nil(1))));
(globalThis as any).kept = [kindOf, chain, either, both, grouped, asValue, negated, optional, inLoop, between, keeps]; console.log("number");
