declare const console: { log(...values: unknown[]): void };
let depth = 0;
function sliceNumbers(text: string, start: number, end: number): string { if (depth > 0) { depth--; sliceNumbers(text, start, end); } return text.slice(start, end); }
function substringNumbers(text: string, start: number, end: number): string { if (depth > 0) { depth--; substringNumbers(text, start, end); } return text.substring(start, end); }
function sliceFrom(text: string, start: number): string { if (depth > 0) { depth--; sliceFrom(text, start); } return text.slice(start); }
function substringFrom(text: string, start: number): string { if (depth > 0) { depth--; substringFrom(text, start); } return text.substring(start); }
function sliceIntegers(text: string, start: number, end: number): string { if (depth > 0) { depth--; sliceIntegers(text, start, end); } return text.slice(start | 0, end | 0); }
function substringIntegers(text: string, start: number, end: number): string { if (depth > 0) { depth--; substringIntegers(text, start, end); } return text.substring(start | 0, end | 0); }
function substrNumbers(text: string, start: number, count: number): string { if (depth > 0) { depth--; substrNumbers(text, start, count); } return text.substr(start, count); }
function constants(text: string): string { return [text.slice(-1), text.slice(0, -1), text.slice(-3, -1), text.slice(1), text.substring(1), text.substring(2, 1), text.slice(2, 1), text.slice(0), text.substring(0, 1000), text.slice(-1000), text.slice(1, 2)].join("|"); }
function inLoop(text: string): string { let out = ""; for (let i = 0; i <= text.length; i++) out += text.slice(i, i + 2) + "." + text.substring(i - 1, i + 1) + ","; return out; }
function inTry(text: string, start: number, end: number): string { try { return text.slice(start, end) + "/" + text.substring(start, end); } catch { return "caught"; } }
const places = [0, 1, 2, 3, 5, 6, 7, 100, -1, -2, -6, -7, -100, -0, 0.5, 1.5, 2.999, -0.5, -1.5, NaN, Infinity, -Infinity, 2147483647, 2147483648, 4294967296, -2147483648, 9007199254740992, -9007199254740992, 9223372036854775807, -9223372036854775808, 1e300, -1e300, 5e-324];
const rope = (a: string, b: string) => a + b;
const texts: [string, () => string][] = [
    ["flat", () => "abcdef"],
    ["wide", () => "ab中d😀"],
    ["rope", () => rope("abc" + String(places.length).slice(0, 0), "def")],
    ["part", () => "xxabcdefyy".substring(2, 8)],
    ["empty", () => ""],
    ["one", () => "a"],
];
function nameOf(value: number): string { return Object.is(value, -0) ? "-0" : String(value); }
let sum = 0;
function note(text: string): string { for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0; sum = (sum * 31 + text.length) | 0; return text; }
for (let round = 0; round < 2; round++) {
    for (const [name, make] of texts) {
        for (const start of places) {
            const row: string[] = [note(sliceFrom(make(), start)), note(substringFrom(make(), start))];
            for (const end of places) {
                note(sliceNumbers(make(), start, end)); note(substringNumbers(make(), start, end)); note(sliceIntegers(make(), start, end)); note(substringIntegers(make(), start, end)); note(substrNumbers(make(), start, end)); note(inTry(make(), start, end));
            }
            console.log(name, nameOf(start), JSON.stringify(row), sum);
        }
        console.log(name, JSON.stringify(constants(make())), JSON.stringify(inLoop(make())));
    }
}
console.log(JSON.stringify([sliceNumbers("abcdef", 1, 4), substringNumbers("abcdef", 4, 1), sliceNumbers("abcdef", 4, 1), sliceNumbers("abcdef", -2, Infinity), substringNumbers("abcdef", NaN, 2), sliceNumbers("abcdef", 1.9, 3.9)]));
