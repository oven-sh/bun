// A loop reads a string that it does not modify.
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
const collect: () => void = typeof (globalThis as any).gc === "function" ? (globalThis as any).gc : () => {};
export function sum(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
export function points(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + (s.codePointAt(i) as number)) | 0; return h; }
export function joined(s: string): string { let out = ""; for (let i = s.length - 1; i >= 0; i--) out += s[i] + s.charAt(i) + (s.at(-1 - i) as string); return out; }
export function beyond(s: string, n: number): string { let out = ""; for (let i = -2; i < n; i++) out += String(s.charCodeAt(i)) + "," + String(s[i]) + "," + show(s.charAt(i)) + ";"; return out; }
export function none(s: string, n: number): number { let h = 7; for (let i = 0; i < n; i++) h += s.charCodeAt(i); return h; }
export function nested(a: string, b: string): number { let n = 0; for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) if (a.charCodeAt(i) === b.charCodeAt(j)) n += i + j + 1; return n; }
export function rows(lines: string[]): number { let n = 0; for (let k = 0; k < lines.length; k++) { const line = lines[k]!; for (let i = 0; i < line.length; i++) if (line.charCodeAt(i) === 32) n += k + 1; } return n; }
export function changes(s: string): number { let n = 0; for (let i = 0; i < s.length && n < 100; i++) { n += s.charCodeAt(i) & 7; if (s.charCodeAt(i) === 97) s = s + "b"; if (s.length > 12) s = s.slice(3); } return n * 100 + s.length; }
export function leaves(s: string): number { let i = 0; while (i < s.length) { const c = s.charCodeAt(i); if (c === 33) break; if (c === 32) { i += 2; continue; } i++; } return i; }
export function asKey(s: string, o: Record<string, number>): number { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; if (i === 1) { o[s] = i; collect(); const garbage: string[] = []; for (let k = 0; k < 2000; k++) garbage.push("g" + k + s); h += garbage.length; collect(); } } return h; }
export function handled(s: string): number { let h = 0; for (let i = 0; i <= s.length; i++) { try { if (i === s.length) throw new Error("end"); h += s.charCodeAt(i); } catch { h = -h; } } return h; }
export function entered(kind: string, s: string): number { let h = 0; switch (kind) { case "up": for (let i = 0; i < s.length; i++) h += s.charCodeAt(i); break; case "down": for (let i = s.length; i--;) h = h * 3 + s.charCodeAt(i) | 0; break; case "none": break; default: for (let i = 0; i < s.length; i += 2) h -= s.charCodeAt(i); } return h; }
export function two(s: string, t: string, which: boolean): number { let h = 0; const u = which ? s : t; for (let i = 0; i < u.length; i++) h = (h + u.charCodeAt(i) * (s.length + 1) + t.length) | 0; return h; }
const strings = ["", "a", "ab", "hello world!", "café", "日本語", "a\u{1f600}b", "\ud83d", cat("hello ", "world"), cat3("a", "日", "c"), cat(cat("ab", "cd"), cat("ef", "gh")), part("xxhello worldxx", 2, 13), part("日hello日", 1, 6), part(cat("xxhel", "lo!xx"), 2, 8), flattened(cat("fl", "at")), "ab ".repeat(40), cat("ab ".repeat(40), "!")];
for (const s of strings) print(show(s.slice(0, 14)) + " " + sum(s) + " " + points(s) + " " + show(joined(s).slice(0, 24)) + " " + beyond(s, 3) + " " + none(s, 0) + " " + none(s, 2) + " " + changes(s) + " " + leaves(s) + " " + handled(s) + " " + entered("up", s) + entered("down", s) + entered("none", s) + entered("x", s));
let total = 0; for (const a of strings) for (const b of strings) total = (total * 7 + nested(a, b) + two(a, b, a.length > b.length)) | 0;
print("nested " + total + " rows " + rows(strings) + " " + rows([]));
const keyed: Record<string, number> = {}; for (const s of [cat("key", "One"), part("xxkeyTwoxx", 2, 8), flattened(cat("key", "Three")), cat3("日", "key", "4"), Array.from("keyFive").join("")]) print("asKey " + asKey(s, keyed) + " " + sum(s)); print(Object.keys(keyed).map(show).join());
function nil(which: number): any { return strings.length > 1000 ? "x" : which ? null : undefined; }
print(attempt(() => sum(nil(0))) + " " + attempt(() => none(nil(1), 0)) + " " + attempt(() => none(nil(0), 1)) + " " + attempt(() => nested("ab", nil(1))) + " " + attempt(() => nested("", nil(1))) + " " + attempt(() => entered("none", nil(0))) + " " + attempt(() => entered("up", nil(0))) + " " + attempt(() => two("a", nil(0), true)) + " " + attempt(() => leaves(nil(1))));
(globalThis as any).kept = [sum, points, joined, beyond, none, nested, rows, changes, leaves, asKey, handled, entered, two]; console.log("number");
