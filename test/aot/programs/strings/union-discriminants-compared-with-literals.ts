// The discriminant of a union is compared with string literals: in a `switch`, in `if` chains, as a value, and after it was changed through `any`.
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
type E = { kind: "text"; n: number } | { kind: "tool"; name: string } | { kind: "end" } | { kind: "stop"; why: string };
type F = { tag: "a"; x: number } | { tag: "b"; x: number } | { tag: "cc"; y: string };
export function bySwitch(e: E): string { switch (e.kind) { case "text": return "t" + e.n; case "tool": return "x" + e.name; case "end": return "e"; case "stop": return "s" + e.why; } }
export function withDefault(e: E): string { switch (e.kind) { case "text": return "t"; case "end": return "e"; default: return "d" + e.kind.length; } }
export function fallsThrough(e: E): string { let out = ""; switch (e.kind) { case "text": out += "t"; case "tool": out += "x"; break; case "end": out += "e"; case "stop": out += "s"; } return out; }
export function byChain(e: E): string { if (e.kind === "text") return "t" + e.n; else if (e.kind === "tool") return "x" + e.name; else if (e.kind === "end") return "e"; return "s" + e.why; }
export function asValue(e: E): string { const a = e.kind === "text", b = "tool" === e.kind, c = e.kind !== "end"; return a + "," + b + "," + c; }
export function alsoUsed(e: E): string { const k = e.kind; switch (k) { case "text": return k + "!"; case "tool": return `${k}?`; default: return k.startsWith("e") ? "E" : k; } }
export function oneLetter(f: F): string { switch (f.tag) { case "a": return "A" + f.x; case "b": return "B" + f.x; case "cc": return "C" + f.y; } }
export function twice(e: E, f: F): string { let out = ""; switch (e.kind) { case "text": switch (f.tag) { case "a": out += "ta"; break; case "b": out += "tb"; break; default: out += "t?"; } break; case "end": out += f.tag === "cc" ? "ec" : "e-"; break; default: out += "-"; } return out; }
export function orNil(e: E | undefined | null): string { switch (e?.kind) { case "text": return "t"; case "tool": return "x"; case undefined: return "u"; default: return "d"; } }
export function inLoop(list: E[]): number { let n = 0; for (const e of list) { switch (e.kind) { case "text": n += e.n; continue; case "end": break; case "stop": return -n; default: n += 100; } n *= 2; } return n; }
export function caught(e: E): string { try { switch (e.kind) { case "text": throw new Error("T"); case "tool": return "x"; default: return "d"; } } catch (x) { return e.kind === "text" ? "caught " + (x as Error).message : "?"; } }
export async function awaited(e: E): Promise<string> { switch (e.kind) { case "text": await null; return "t" + e.n; case "tool": return "x" + (await Promise.resolve(e.name)); default: await null; return e.kind === "end" ? "e" : "s"; } }
function alter(o: any, kind: any): void { o.kind = kind; }
const list: E[] = [{ kind: "text", n: 1 }, { kind: "tool", name: "ls" }, { kind: "end" }, { kind: "stop", why: "w" }];
const others: F[] = [{ tag: "a", x: 1 }, { tag: "b", x: 2 }, { tag: "cc", y: "z" }];
for (const e of list) print(bySwitch(e) + " " + withDefault(e) + " " + fallsThrough(e) + " " + byChain(e) + " " + asValue(e) + " " + alsoUsed(e) + " " + orNil(e) + " " + caught(e) + " " + others.map((f) => twice(e, f)).join());
print(others.map(oneLetter).join() + " " + orNil(undefined) + orNil(null) + " " + inLoop(list) + " " + inLoop(list.slice(0, 3)) + " " + inLoop([]) + " " + list.map(bySwitch).join());
// Members that did not come about by a literal of the program.
const parsed = JSON.parse('[{"kind":"text","n":7},{"kind":"tool","name":"cat"},{"kind":"end"},{"kind":"stop","why":"y"}]') as E[];
for (const e of parsed) print(bySwitch(e) + " " + withDefault(e) + " " + byChain(e) + " " + asValue(e) + " " + alsoUsed(e));
const made: E[] = ["te" + "xt", cat("to", "ol"), part("xendx", 1, 4)].map((kind, i) => ({ kind, n: i, name: "n" + i }) as any);
for (const e of made) print(bySwitch(e) + " " + fallsThrough(e) + " " + byChain(e) + " " + asValue(e));
// Untyped code stores to the tag. Every such store succeeds; here it stores an equal string that was created differently, so the typed reads that follow find a member of the union.
for (const [from, to] of [[0, cat("te", "xt")], [1, "tool"], [2, "end"]] as [number, string][]) { const e = { ...list[from]! }; print(attempt(() => { alter(e, to); return bySwitch(e) + withDefault(e) + asValue(e); })); }
(async () => { for (const e of [...list, ...parsed]) print(await awaited(e)); })();
(globalThis as any).kept = [bySwitch, withDefault, fallsThrough, byChain, asValue, alsoUsed, oneLetter, twice, orNil, inLoop, caught, awaited]; console.log("number");
