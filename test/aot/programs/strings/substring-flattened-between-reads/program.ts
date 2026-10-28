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

declare function gc(): void;
const collect: () => void = typeof gc === "function" ? gc : () => {};
// Makes it flat: as a key of an object JavaScriptCore wants an atom.
declare function isRope(s: string): boolean;
const isPart: (s: string) => boolean = typeof isRope === "function" ? isRope : () => true;
const isFlat: (s: string) => boolean = typeof isRope === "function" ? s => !isRope(s) : () => true;
// The test tests nothing unless the string is a part before and flat after.
function flatten(s: string): void { if (!isPart(s)) throw new Error("no part"); Symbol.for(s); if (!isFlat(s)) throw new Error("not flat"); }
// Fills the memory that the collector has freed.
let litter: string[] = [];
function fill(): void { litter = []; for (let i = 0; i < 20000; i++) litter.push(("#".repeat(40) + i).slice(1, 30 + (i & 7))); }
const unseen = (f: any): any => new Function("f", "return (...a) => f(...a)")(f);
export function lengthThenSlice(t: string): string { const n = t.length; flatten(t); collect(); fill(); collect(); return n + ":" + t.slice(2, 12); }
export function codeThenSlice(t: string): string { const n = t.charCodeAt(1); flatten(t); collect(); fill(); collect(); return n + ":" + t.slice(2, 12); }
export function sliceThenSlice(t: string): string { const a = t.slice(1, 5); flatten(t); collect(); fill(); collect(); return a + ":" + t.slice(2, 12); }
export function lengthThenSubstring(t: string): string { const n = t.length; flatten(t); collect(); fill(); collect(); return n + ":" + t.substring(3, 14); }
export function lengthThenCode(t: string): string { const n = t.length; flatten(t); collect(); fill(); collect(); return n + ":" + t.charCodeAt(4); }
export function lengthThenIndex(t: string): string { const n = t.length; flatten(t); collect(); fill(); collect(); return n + ":" + t[5]; }
export function lengthThenText(t: string): string { const n = t.length; flatten(t); collect(); fill(); collect(); return n + ":" + (t === "cdefghijklmnopqrstuvwxyz0123") + (t === "cdefghijklmnopqrstuvwxyz012?"); }
export function lengthThenStarts(t: string): string { const n = t.length; flatten(t); collect(); fill(); collect(); return n + ":" + t.startsWith("cdef") + t.endsWith("0123") + t.startsWith("cdeg"); }
export function lengthThenTrim(t: string): string { const n = t.length; flatten(t); collect(); fill(); collect(); return n + ":" + t.trim(); }
export function lengthThenEqual(t: string, u: string): string { const n = t.length; flatten(t); collect(); fill(); collect(); return n + ":" + (t === u); }
export function lengthThenSearch(t: string): string { const n = t.length; flatten(t); collect(); fill(); collect(); return n + ":" + t.indexOf("xyz") + t.includes("0") + t.lastIndexOf("d"); }
const all: [string, any][] = [["lengthThenSlice", lengthThenSlice], ["codeThenSlice", codeThenSlice], ["sliceThenSlice", sliceThenSlice], ["lengthThenSubstring", lengthThenSubstring], ["lengthThenCode", lengthThenCode], ["lengthThenIndex", lengthThenIndex], ["lengthThenText", lengthThenText], ["lengthThenStarts", lengthThenStarts], ["lengthThenTrim", lengthThenTrim], ["lengthThenEqual", lengthThenEqual], ["lengthThenSearch", lengthThenSearch]];
// Nothing but the part holds its base: the parts are made beforehand, deep in the stack, so that no register or slot of a frame that is still there has a base.
const fresh = (x: string): string => String.fromCharCode(...[...x].map(c => c.charCodeAt(0)));
const narrow = (i: number): string => fresh("abcdefghijklmnopqrstuvwxyz0123456789" + i).slice(2, 30);
const wider = (i: number): string => fresh("\u65e5bcdefghijklmnopqrstuvwxyz0123456789" + i).slice(2, 30);
function prepare(depth: number, into: string[], make: (i: number) => string, from: number): void { if (depth) { prepare(depth - 1, into, make, from); return; } for (let i = 0; i < 400; i++) into.push(make(from + i)); }
function overwrite(depth: number): number { return depth ? overwrite(depth - 1) + depth : 0; }
const narrowParts: string[] = []; const widerParts: string[] = [];
unseen(prepare)(40, narrowParts, narrow, 0); unseen(prepare)(40, widerParts, wider, 0); unseen(overwrite)(200);
let next = 0;
for (const [name, f] of all) {
    const g = unseen(f);
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) { seen.add(g(narrowParts[next], narrowParts[next + 1])); seen.add(g(widerParts[next], widerParts[next + 1])); next += 2; }
    print(name + ": " + [...seen].join(" | "));
}
(globalThis as any).kept = all; console.log("number");
