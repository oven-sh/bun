// `try .. catch` inside loops over strings, and `await` and `yield` in such loops.
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
function fail(c: string): void { if (c === "b" || c === "\u{1f600}") throw new Error("no " + c.length); }
export function caughtInside(s: string): string { let out = ""; for (const c of s) { try { fail(c); out += c; } catch (e) { out += "!" + (e as Error).message; } } return out; }
export function caughtInsideAny(s: any): string { let out = ""; for (const c of s) { try { fail(c); out += c; } catch (e) { out += "!" + (e as Error).message; } } return out; }
export function caughtOutside(s: string): string { let out = ""; try { for (const c of s) { fail(c); out += c; } } catch (e) { out += "!" + (e as Error).message; } return out; }
export function finallyInside(s: string): string { let out = ""; for (const c of s) { try { if (c === "c") continue; if (c === "e") break; out += c; } finally { out += "."; } } return out; }
export function nestedCaught(s: string, t: string): string { let out = ""; for (const c of s) { for (const d of t) { try { fail(d); out += c + d; } catch { out += "-"; } } try { fail(c); } catch { out += "|"; } } return out; }
export function indexCaught(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) { try { fail(s[i]!); h = (h * 31 + s.charCodeAt(i)) | 0; } catch { h = -h; } } return h; }
export async function awaited(s: string): Promise<string> { let out = ""; for (const c of s) { await null; out += c; await Promise.resolve(c); out += s.length; } return out; }
export async function awaitedIndex(s: string): Promise<number> { let h = 0; for (let i = 0; i < s.length; i++) { await null; h = (h * 31 + s.charCodeAt(i)) | 0; } return h; }
export async function awaitedAny(s: any): Promise<string> { let out = ""; for (const c of s) { await null; out += c; } return out; }
export function* yielded(s: string): Generator<string> { for (const c of s) { yield c; yield c + s.length; } }
export function* yieldedIndex(s: string): Generator<number> { for (let i = 0; i < s.length; i++) { yield s.charCodeAt(i); yield s.codePointAt(i)!; } }
export async function awaitedCaught(s: string): Promise<string> { let out = ""; for (const c of s) { try { await null; fail(c); out += c; } catch { out += "!"; await null; } } return out; }
const strings = ["", "a", "b", "abc", "abcbd", "a\u{1f600}b\u{1f600}c", "日b本", cat("ab", "cb"), part("xxabcbxx", 2, 6), cat3("\u{1f600}", "b", "z"), "cde", "abcdefg"];
for (const s of strings) print(show(s) + " " + show(caughtInside(s)) + " " + show(caughtInsideAny(s)) + " " + show(caughtOutside(s)) + " " + show(finallyInside(s)) + " " + show(nestedCaught(s, "ab")) + " " + show(nestedCaught("ab", s).slice(0, 40)) + " " + indexCaught(s) + " " + show([...yielded(s)].join()) + " " + [...yieldedIndex(s)].join());
print(show(caughtInsideAny(["a", "b", "c"])) + " " + show(caughtInsideAny(new Set(["b", "x"]))) + " " + attempt(() => caughtInsideAny(5)) + " " + attempt(() => caughtInside(undefined as any)));
(async () => { for (const s of strings) print(show(await awaited(s)) + " " + (await awaitedIndex(s)) + " " + show(await awaitedAny(s)) + " " + show(await awaitedCaught(s))); const all = await Promise.all(strings.map((s) => awaited(s))); print(show(all.join("/"))); })();
(globalThis as any).kept = [caughtInside, caughtInsideAny, caughtOutside, finallyInside, nestedCaught, indexCaught, awaited, awaitedIndex, awaitedAny, yielded, yieldedIndex, awaitedCaught]; console.log("number");
