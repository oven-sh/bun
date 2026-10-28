// `a.localeCompare(b)` with one string argument, with locales or options, and with other kinds of arguments.
// CALLS+ compared operationAOTStringLocaleCompare
// CALLS- compared CallHostFunction
// CALLS+ byLocale operationAOTStringLocaleCompare
// CALLS- comparedIn operationAOTStringLocaleCompare
// CALLS- comparedWithAnything operationAOTStringLocaleCompare
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

export function compared(a: string, b: string): number { return a.localeCompare(`${b}`); }
function byLocale(a: string, b: string): number { return `${a}`.localeCompare(`${b}`); }
export function sorted(list: string[]): string[] { return list.slice().sort(byLocale); }
export function comparedIn(a: string, b: string, locale: string): number { return a.localeCompare(b, locale); }
export function comparedWith(a: string, b: string, options: Intl.CollatorOptions): number { return a.localeCompare(b, undefined, options); }
export function comparedWithAnything(a: string, b: any): number { return a.localeCompare(b); }
const words = ["", "a", "A", "b", "B", "aa", "ab", "a b", "a-b", "a_b", "Z", "z", "10", "9", "1", "ä", "Ä", "ae", "é", "e", "f", "ß", "ss", "ñ", "n", "o", "日本", "中", "😀", "─", " ", "\t", "~", "!", "\x7f", "\x00", "a\x00", "resume", "résumé", "Resume", "co-op", "coop", "é", cat("ro", "pe"), part("xxropexx", 2, 6), cat("ä", "b")];
for (const a of words) print(show(a) + ": " + words.map(b => compared(a, b)).join(""));
print(sorted(words).map(show).join(" "));
print([typeof compared("a", "b"), Object.is(compared("a", "a"), 0), compared("a", "b") + compared("b", "a"), compared("a", "b") < 0, [compared("b", "a")].includes(1), 1 / compared("x", "x")].join());
print(["de", "sv", "en", "ja", "tr"].map(l => comparedIn("ä", "z", l) + "" + comparedIn("i", "I", l) + comparedIn("a", "ä", l)).join() + " " + comparedWith("a", "A", { sensitivity: "base" }) + comparedWith("a", "ä", { sensitivity: "base" }) + comparedWith("10", "9", { numeric: true }) + comparedWith("a", "A", { caseFirst: "upper" }));
print([undefined, null, 1, "1", true, { toString() { return "b"; } }, ["a"], 1.5].map(b => comparedWithAnything("b", b)).join() + " " + attempt(() => comparedWithAnything("a", Symbol.iterator)) + " " + attempt(() => comparedIn("a", "b", "not a locale")) + " " + attempt(() => compared(undefined as any, "a")) + " " + attempt(() => compared(null as any, "a")));
{ let sum = 0; for (let i = 0; i < 3000; i++) sum += compared("item " + (i * 7919 % 1000), "item " + (i * 104729 % 1000)) * (i & 7); print(String(sum)); }
(globalThis as any).kept = [compared, sorted, comparedIn, comparedWith, comparedWithAnything]; console.log("number");
