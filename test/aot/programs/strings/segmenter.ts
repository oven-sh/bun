// `Intl.Segmenter`: iterations that finish, stop early, interleave and nest, and `containing()`.
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
const graphemes = new Intl.Segmenter(), words = new Intl.Segmenter("en", { granularity: "word" }), sentences = new Intl.Segmenter("en", { granularity: "sentence" });
function piece(d: Intl.SegmentData | undefined): string { return d === undefined ? "-" : show(d.segment) + "@" + d.index + (d.isWordLike === undefined ? "" : d.isWordLike ? "w" : "n") + (d.input.length); }
export function all(seg: Intl.Segmenter, s: string): string { let out = ""; for (const d of seg.segment(s)) out += piece(d) + " "; return out; }
export function first(seg: Intl.Segmenter, s: string, n: number): string { let out = ""; for (const d of seg.segment(s)) { if (n-- <= 0) break; out += piece(d) + " "; } return out; }
export function nested(seg: Intl.Segmenter, a: string, b: string, c: string): string { let out = ""; for (const x of seg.segment(a)) for (const y of seg.segment(b)) for (const z of seg.segment(c)) out += x.segment + y.segment + z.segment + ","; return out; }
export function interleaved(seg: Intl.Segmenter, a: string, b: string): string { const i = seg.segment(a)[Symbol.iterator](), j = seg.segment(b)[Symbol.iterator](), k = seg.segment(a)[Symbol.iterator](); let out = ""; for (let n = 0; n < 7; n++) { const x = i.next(), y = j.next(); out += (x.done ? "." : x.value.segment) + (y.done ? "." : y.value.segment); if (n & 1) { const z = k.next(); out += z.done ? "." : z.value.segment; } out += " "; } return out; }
export function sameSegments(seg: Intl.Segmenter, s: string): string { const segments = seg.segment(s); const i = segments[Symbol.iterator](), j = segments[Symbol.iterator](); let out = piece(segments.containing(1)) + " "; out += piece(i.next().value) + piece(i.next().value) + " " + piece(segments.containing(0)) + " " + piece(j.next().value) + piece(i.next().value) + " " + piece(segments.containing(s.length - 1)) + piece(segments.containing(s.length)) + piece(segments.containing(-1)); return out + " " + [...segments].length + [...segments].length; }
export function afterTheEnd(seg: Intl.Segmenter, s: string): string { const i = seg.segment(s)[Symbol.iterator](); let n = 0; while (!i.next().done) n++; const other = all(seg, "xy"); return n + String(i.next().done) + String(i.next().value) + String(i.next().done) + " " + other + String(i.next().done); }
const texts = ["", "a", "abc", "café", "éa", "日本語", "a\u{1f600}b", "\u{1f468}‍\u{1f469}‍\u{1f467}!", "\ud83d", cat("ab", "cd"), part("xx日yxx", 2, 4), "Hello, world. It is 3.5 km! Yes?"];
for (const s of texts) print(show(s) + ": " + all(graphemes, s) + "| " + first(graphemes, s, 2) + "| " + afterTheEnd(graphemes, s) + (s.length ? " | " + sameSegments(graphemes, s) : ""));
print(all(words, texts[11]!)); print(all(sentences, texts[11]!)); print(sameSegments(words, texts[11]!)); print(first(words, "one two three", 3) + "| " + all(words, "日本語の文"));
print(nested(graphemes, "ab", "日本", "xy")); print(interleaved(graphemes, "abc", "日本語文字")); print(interleaved(words, "a b", "c d e f"));
// What was given back is handed out again, for another text, when the old text is gone.
{ let sum = 0; for (let round = 0; round < 300; round++) { const s = "r" + round + (round & 1 ? "日" : "") + "x".repeat(round & 31); let n = 0; for (const d of graphemes.segment(s)) n += d.segment.length + d.index; sum = (sum * 31 + n) | 0; if (round % 50 === 0) collect(); if (round % 7 === 0) first(graphemes, s, 1); } print("sum " + sum); }
// Iterators that outlive what made them.
{ const kept: Iterator<Intl.SegmentData>[] = []; for (let i = 0; i < 20; i++) kept.push(new Intl.Segmenter().segment("k" + i + "éz")[Symbol.iterator]()); collect(); const garbage: string[] = []; for (let i = 0; i < 5000; i++) garbage.push("g" + i); collect(); print(kept.map((k) => { let out = ""; for (let r = k.next(); !r.done; r = k.next()) out += r.value.segment; return out; }).join() + " " + garbage.length); }
print([...graphemes.segment("áb")].map(piece).join() + " " + Array.from(words.segment("x y"), piece).join() + " " + attempt(() => (graphemes.segment as any).call({}, "x")) + " " + attempt(() => graphemes.segment(Symbol() as any)) + " " + [...(graphemes as any).segment(12)].map(piece).join() + [...(graphemes as any).segment(undefined)].length);
(globalThis as any).kept = [all, first, nested, interleaved, sameSegments, afterTheEnd]; console.log("number");
