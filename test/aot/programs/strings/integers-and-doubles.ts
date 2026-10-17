// Numbers that were converted from integers are compared with integer constants.
// CALLS- countLetters uses.* fcmp
// CALLS- countJoined uses.* fcmp
// CALLS- countNested uses.* fcmp
// CALLS- countAround uses.* fcmp
// CALLS+ countFractions uses.* fcmp
// CALLS+ countParsed uses.* fcmp
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
const EOF = -1;
function codePointAt(s: string, i: number): number { return s.codePointAt(i) as number; }
function isLetter(ch: number): boolean { return ch >= 65 && ch <= 90 || ch >= 97 && ch <= 122; }
function size(ch: number): number { return ch >= 0x10000 ? 2 : ch === EOF ? 0 : 1; }
export function isLetterAt(s: string, i: number): boolean { const ch = s.codePointAt(i) as number; return ch >= 65 && ch <= 90 || ch >= 97 && ch <= 122; }
export function classify(s: string, i: number): string {
    const ch = codePointAt(s, i);
    return "" + (ch < 0) + (ch <= 0) + (ch > 0) + (ch >= 0) + (ch < 65) + (ch <= 65) + (ch > 65) + (ch >= 65) + (65 < ch) + (65 <= ch) + (65 > ch) + (65 >= ch) + (ch < -1) + (ch <= -1) + (ch > -1) + (ch >= -1) + (ch === 65) + (ch !== 65) + (ch == 65)
        + (ch < 0x110000) + (ch <= 0x10ffff) + (ch > 0x10ffff) + (ch >= 0x10ffff) + (ch < 2 ** 40) + (ch > -(2 ** 40)) + (ch >= 2 ** 53 - 1) + (ch <= -(2 ** 53 - 1)) + isLetter(ch) + size(ch);
}
export function joined(s: string, i: number, which: number): string {
    let ch: number;
    if (which === 0) ch = s.charCodeAt(i); else if (which === 1) ch = codePointAt(s, i); else if (which === 2) ch = EOF; else ch = s.length;
    return "" + (ch < 0) + (ch <= -1) + (ch < -1) + (ch > -1) + (ch >= -1) + (ch >= 0) + (ch < 65) + (ch <= 90) + (ch > 96) + (ch >= 123) + (ch === -1) + (ch === 65) + (ch !== 97) + isLetter(ch) + size(ch);
}
export function withEnd(s: string, i: number): string {
    const ch = i >= 0 && i < s.length ? codePointAt(s, i) : EOF;
    const next = i + 1 >= 0 && i + 1 < s.length ? s.charCodeAt(i + 1) : EOF;
    const either = (i & 1) === 0 ? ch : next;
    return "" + (ch < 0) + (ch >= 0) + (ch <= 64) + (next < 0) + (next > 127) + (either < 0) + (either <= -1) + (either < 48) + (either > 57) + (either >= -1) + (either === EOF) + isLetter(either) + size(either) + " " + either;
}
export function ofFraction(s: string, i: number, which: number): string {
    let ch: number;
    if (which === 0) ch = s.charCodeAt(i); else ch = i / 2;
    return "" + (ch < 1) + (ch <= 1) + (ch > 1) + (ch >= 1) + (ch === 1) + (ch < 0) + (ch >= 0);
}
export function aroundALoop(s: string): string {
    let ch = s.charCodeAt(0), out = "";
    for (let i = 1; i <= s.length + 1; i++) {
        out += (ch < 65 ? "a" : ch <= 90 ? "b" : ch >= 97 ? "c" : "d") + (ch >= 0 ? "" : "!");
        ch = i & 1 ? ch + 0.5 : s.charCodeAt(i);
    }
    return out;
}
export function scanWord(s: string, from: number): number {
    let pos = from, ch = codePointAt(s, pos);
    while (pos < s.length && (isLetter(ch = codePointAt(s, pos)) || ch >= 48 && ch <= 57 || ch === 95 || ch > 127)) pos += size(ch);
    return pos;
}
export function countLetters(s: string): number { let n = 0; for (let i = 0; i < s.length; i++) { const ch = s.codePointAt(i) as number; if (ch >= 65 && ch <= 90 || ch >= 97 && ch <= 122) n++; } return n; }
export function countJoined(s: string): number { let n = 0; for (let i = 0; i <= s.length; i++) { const ch = (i & 1) === 0 ? s.charCodeAt(i) : (i & 2) === 0 ? (s.codePointAt(i) as number) : EOF; if (ch < 0 || ch >= 65 && ch <= 90 || ch === 95) n++; } return n; }
export function countNested(s: string): number {
    let n = 0;
    for (let i = 0; i <= s.length + 1; i++) {
        const inner = (i & 1) === 0 ? s.charCodeAt(i) : s.length;
        const ch = (i & 4) === 0 ? inner : EOF;
        if (ch <= -1) n += 100; else if (ch < 48) n += 10; else if (ch > 122) n += 1000; else if (ch >= 97) n++;
    }
    return n;
}
export function countAround(s: string): number { let n = 0, ch = s.charCodeAt(0); for (let i = 1; i <= s.length + 1; i++) { if (ch >= 65 && ch < 91) n++; ch = s.charCodeAt(i); } return n; }
export function countFractions(s: string): number { let n = 0; for (let i = 0; i <= s.length; i++) { const ch = (i & 1) === 0 ? s.charCodeAt(i) : i / 2; if (ch >= 1 && ch <= 90) n++; } return n; }
export function countParsed(s: string): number { let n = 0; for (let i = 0; i <= s.length; i++) { const ch = (i & 1) === 0 ? s.charCodeAt(i) : parseInt(s, 16); if (ch >= 10 && ch <= 90) n++; } return n; }
const texts = ["", "A", "Az", "@[`{", "0129_", "café", "日本", "a😀b", "\ud83d", "\ude00\ud83d", "􏿿", cat("AB", "cd"), part("xxMNxx", 2, 4), cat("日", "Z"), "\u0000\u0001", "￿"];
for (const s of texts) {
    for (const i of [-1, 0, 1, 2, 3, 0.5, 1.9, -0, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32, -(2 ** 31) - 1]) {
        let line = show(s) + " " + show(i) + " " + isLetterAt(s, i) + " " + classify(s, i) + " " + withEnd(s, i);
        for (let which = 0; which < 4; which++)
            line += " " + joined(s, i, which);
        print(line + " " + ofFraction(s, i, 0) + ofFraction(s, i, 1));
    }
    print(show(s) + " " + aroundALoop(s) + " " + scanWord(s, 0) + " " + scanWord(s, 1) + " " + countLetters(s) + " " + countJoined(s) + " " + countNested(s) + " " + countAround(s) + " " + countFractions(s) + " " + countParsed(s));
}
function nil(): any { return texts.length > 1000 ? "" : undefined; }
print(attempt(() => classify(nil(), 0)) + " " + attempt(() => isLetterAt(nil(), 0)) + " " + attempt(() => joined(nil(), 0, 2)) + " " + attempt(() => joined(nil(), 0, 0)));
// The functions that the expectations name must stay functions: one that is inlined into all of its callers has no code of its own.
(globalThis as any).kept = [countLetters, countJoined, countNested, countAround, countFractions, countParsed]; console.log("number");
