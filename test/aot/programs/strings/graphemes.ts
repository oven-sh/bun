// `Intl.Segmenter` with grapheme granularity: the fast path that avoids ICU gives the same answers as ICU.
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

const graphemes = new Intl.Segmenter();
const of = (...units: number[]): string => String.fromCharCode(...units);
export function cuts(s: string): string { let out = ""; for (const { segment, index, input } of graphemes.segment(s)) out += index + ":" + segment.length + (input === s ? "" : "?") + ","; return out; }
export function around(s: string): string { const segments = graphemes.segment(s); let out = ""; for (let i = 0; i < s.length; i++) { const found = segments.containing(i)!; out += found.index + ":" + found.segment.length + ","; } return out; }
function mixed(text: string, h: number): number { for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0; return h; }
// Every pair of ASCII; every pair about the limits; alone, between letters, and with what joins around them. Summed: a wrong cut changes the sum; the first lines are whole.
const special = [0, 9, 10, 13, 32, 65, 127, 128, 0x85, 0xa0, 0xa9, 0xad, 0xae, 0xff, 0x100, 0x2ff, 0x300, 0x301, 0x36f, 0x370, 0x483, 0x5ff, 0x600, 0x605, 0x606, 0x903, 0x915, 0x94d, 0xe01, 0xe33, 0x1100, 0x1161, 0x11a8, 0x200b, 0x200c, 0x200d, 0x2028, 0x20e3, 0x2500, 0x2764, 0x3000, 0xac00, 0xd800, 0xd83c, 0xd83d, 0xdc00, 0xdde6, 0xde00, 0xdffb, 0xfe0f, 0xfeff, 0xffff];
{ let h = 0; for (let a = 0; a < 128; a++) for (let b = 0; b < 128; b++) { const s = of(a, b); h = mixed(cuts(s) + around(s), h); } print("ASCII pairs " + h); }
{ let h = 0; for (const a of special) for (const b of special) for (const c of special) { const s = of(a, b, c); h = mixed(cuts(s) + "|" + around(s), h); } print("triples " + h); }
{ let h = 0; for (const a of special) for (const b of special) { const s = "x" + of(a) + "y" + of(b) + "z\r\n" + of(a, b) + "\n\r" + of(b); h = mixed(cuts(s) + "|" + around(s), h); } print("in texts " + h); }
for (const s of ["", "a", "ab", "\r\n", "a\r\nb", "\n\r", "\r\r\n\n", "é", "aéb", "́", "a؀b", "؀", "😀", "a😀b", "🇩🇪🇫🇷x", "👨‍👩‍👧", "❤️", "1️⃣", "©‍©", "©️", "각", "각x", "क्ष", "กำ", "\ud800", "a\ud800b", "\udc00\ud800", "café ── ok", "日本語 abc", "a‍b", "‍", "x­́y"])
    print(show(s) + " " + cuts(s) + " | " + around(s));
// 8 bits, 16 bits with the same characters, ropes, parts.
{ const narrow = "plain text, \xe9\xff\xa9\r\nnext"; const wide = (narrow + "─").slice(0, -1); print(String(cuts(narrow) === cuts(wide)) + String(around(narrow) === around(wide)) + " " + cuts(cat("ab\r", "\ncd")) + " " + cuts(part("xxéxx", 1, 5)) + " " + around(cat("e", "́")) + " " + cuts(part("a\r\nb", 1, 2)) + cuts(part("a\r\nb", 2, 4))); }
// What containing() is asked with.
{ const segments = graphemes.segment("aé\r\nz"); print([-1, -0, 0, 0.9, 1, 1.5, 2, 3, 4, 5, 6, NaN, Infinity, -Infinity, undefined, null, "2", "x", true, { valueOf() { return 3; } }].map(i => { const f = segments.containing(i as any); return f ? f.index + ":" + show(f.segment) + Object.keys(f).join("") : "undefined"; }).join(" ")); print(attempt(() => segments.containing(Symbol.iterator as any)) + " " + attempt(() => segments.containing(1n as any))); }
// One Segments, several iterators, containing() in between; iterators left half way; used up.
{ const segments = graphemes.segment("ab́c😀d\r\ne"); const a = segments[Symbol.iterator](), b = segments[Symbol.iterator](); let out = ""; for (let i = 0; i < 9; i++) { const x = a.next(); out += x.done ? "." : x.value.index; if (i & 1) { const y = b.next(); out += y.done ? "!" : "(" + y.value.segment.length + ")"; } out += segments.containing(i)?.index ?? "-"; out += " "; } print(out + JSON.stringify(a.next()) + JSON.stringify(a.next()) + show([...b].map(x => x.index).join())); }
{ const it = graphemes.segment("abc")[Symbol.iterator](); print(String(it[Symbol.iterator]() === it) + Object.prototype.toString.call(it) + JSON.stringify(it.next())); }
{ let n = 0; for (let i = 0; i < 3000; i++) { const s = "line " + i + (i % 7 ? "" : " ─é") + (i % 11 ? "" : "\r\n"); n += [...graphemes.segment(s)].length + graphemes.segment(s).containing(i % s.length)!.index; } print(String(n)); }
// The other granularities, and other locales.
{ const words = new Intl.Segmenter("en", { granularity: "word" }), sentences = new Intl.Segmenter("en", { granularity: "sentence" }); const s = "Hello, wide world. It's 3.5 ─ ok?  Yes\r\nno"; print([...words.segment(s)].map(x => x.index + (x.isWordLike ? "w" : "-")).join() + " " + [...sentences.segment(s)].map(x => x.index).join() + " " + JSON.stringify(words.segment(s).containing(8)) + " " + sentences.segment(s).containing(20)!.index + " " + [...words.segment("")].length + String(words.segment("").containing(0))); }
print(["th", "ja", "hi", "ar", "ko", "sv"].map(l => { const g = new Intl.Segmenter(l); return [...g.segment("ab\r\nกำéक्षz")].map(x => x.index).join(""); }).join());
(globalThis as any).kept = [cuts, around]; console.log("number");
