// `for..of` over the result of `segmenter.segment(text)` skips the iterator protocol as long as the program cannot observe that.
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

const log: string[] = [];
const graphemes = new Intl.Segmenter(), words = new Intl.Segmenter("en", { granularity: "word" });
export function typed(s: string): string { let out = ""; for (const { segment, index } of graphemes.segment(s)) out += index + show(segment); return out; }
export function untyped(g: any, s: any): any { let out = ""; for (const { segment } of g.segment(s)) out += "[" + segment + "]"; return out; }
export function whole(s: string): string { let out = ""; for (const data of graphemes.segment(s)) out += Object.keys(data).join() + (data.input === s) + ";"; return out; }
export function held(segments: any): any { let out = ""; for (const { index } of segments) out += index; return out; }
export function leaving(s: string, at: number): string { let out = ""; for (const { segment, index } of graphemes.segment(s)) { if (index === at) break; if (index === at - 1) continue; if (index === at + 2) return "R" + out; out += segment; } return out; }
export function throwing(s: string): string { let out = ""; try { for (const { segment, index } of graphemes.segment(s)) { try { if (index === 1) throw new Error("inner"); out += segment; } catch (e) { out += "!"; } if (index === 2) throw new Error("outer"); } } catch (e) { out += (e as Error).message; } finally { out += "."; } return out; }
export function nested(a: string, b: string): string { let out = ""; for (const x of graphemes.segment(a)) for (const y of graphemes.segment(b)) for (const z of words.segment(a)) out += x.index + "" + y.index + z.index + ","; return out; }
export async function awaiting(s: string): Promise<string> { let out = ""; for (const { segment } of graphemes.segment(s)) { await null; out += segment + "."; } return out; }
export function* yielding(s: string): Generator<string> { for (const { segment } of graphemes.segment(s)) yield segment; }
export function spread(s: string): string { return [...graphemes.segment(s)].map(x => x.index).join() + "|" + Array.from(graphemes.segment(s), x => x.segment.length).join(); }
print(typed("ab") + " " + typed("") + "|" + typed("éx\r\n😀─") + " " + untyped(graphemes, "a日b") + " " + untyped(words, "two words") + " " + untyped(new Intl.Segmenter("ja", { granularity: "sentence" }), "One. Two.") + " " + whole("ab") + " " + spread("aéb"));
// One Segments object, iterated twice, and while another iteration of it is under way; its own iterator, held.
{ const segments = graphemes.segment("abc"); print(held(segments) + held(segments)); let out = ""; for (const a of segments) for (const b of segments) out += a.index + "" + b.index + ","; print(out); const it = segments[Symbol.iterator](); it.next(); print(held(it) + "|" + held(it) + JSON.stringify(it.next())); }
// Somebody can tell.
{ const segments: any = graphemes.segment("ab"); segments[Symbol.iterator] = function () { log.push("own iterator"); return [{ index: "x" }][Symbol.iterator](); }; print(held(segments) + log.splice(0).join()); }
{ const segments: any = graphemes.segment("ab"); segments.extra = 1; print(held(segments) + segments.extra); }
{ const segments: any = graphemes.segment("ab"); Object.setPrototypeOf(segments, { [Symbol.iterator]() { log.push("other prototype"); return [{ index: "y" }][Symbol.iterator](); } }); print(held(segments) + log.splice(0).join()); }
{ const segments: any = graphemes.segment("ab"); Object.setPrototypeOf(segments, null); print(attempt(() => held(segments))); }
{ const giving = { segment() { log.push("own segment"); return [{ segment: "s" }]; } }; print(untyped(giving, "ab") + log.splice(0).join() + " " + attempt(() => untyped({ segment: () => 5 }, "")) + " " + attempt(() => untyped(graphemes, Symbol.iterator)) + " " + untyped(graphemes, 12) + untyped(graphemes, null) + untyped(graphemes, { toString() { log.push("toString"); return "o"; } }) + log.splice(0).join()); }
for (let at = 0; at < 5; at++) print(leaving("abcde", at));
print(throwing("abcd") + " " + nested("ab", "x") + " " + [...yielding("aé")].map(show).join());
{ let n = 0; for (let i = 0; i < 2000; i++) for (const { segment } of graphemes.segment("line " + i + (i % 5 ? "" : " ─日é😀"))) n += segment.length; print(String(n)); }
(async () => { print(await awaiting("ab─")); print((await Promise.all([awaiting("x"), awaiting("yz")])).join()); })();
(globalThis as any).kept = [typed, untyped, whole, held, leaving, throwing, nested, awaiting, yielding, spread]; console.log("number");
