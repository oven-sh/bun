// Loops that read nothing of a string but its length.
// CALLS- counted Flatten
// CALLS- greater Flatten
// CALLS- nested Flatten
// CALLS- lengthAndCharacters Flatten
// CALLS+ lengthAndCharacters RopeCharacters
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

export function counted(s: string): number { let n = 0; for (let i = 0; i < s.length; i++) n += i; return n; }
export function greater(s: string, t: string): number { let c = 0; for (let i = 0; i < Math.max(s.length, t.length); i++) c += i; return c; }
export function nested(s: string, t: string): number { let c = 0; for (let i = 0; i < s.length; i++) for (let j = 0; j < t.length; j++) c += i * j; return c; }
export function downwards(s: string): number { let n = 0; for (let i = s.length; i > 0; i--) n += s.length - i; return n; }
export function whileLoop(s: string): number { let i = 0; while (i * i < s.length) i++; return i; }
export function optional(s?: string): number { let n = 0; for (let i = 0; i < (s?.length ?? 3); i++) n += i; return n; }
export function nilThrows(s: string): number { let n = 0; for (let i = 0; i < s.length; i++) n++; return n; }
export function neverEntered(s: string, limit: number): number { let n = 0; for (let i = 0; i < limit && i < s.length; i++) n++; return n; }
export function lengthAndCharacters(s: string): number { let n = 0; for (let i = 0; i < s.length; i++) n += s.charCodeAt(i); return n; }
export function lengthOfOneCharactersOfOther(s: string, t: string): number { let n = 0; for (let i = 0; i < s.length; i++) n += t.charCodeAt(i % t.length); return n; }
export function lengthFirstCharactersInInner(s: string): number { let n = 0; for (let i = 0; i < s.length; i++) for (let j = 0; j < 2; j++) n += s.charCodeAt(i) + j; return n; }
export function lengthInInnerOnly(s: string, t: string): number { let n = 0; for (let i = 0; i < 3; i++) { n += t.charCodeAt(i); for (let j = 0; j < s.length; j++) n += j; } return n; }
export function changesInLoop(s: string): number { let n = 0; for (let i = 0; i < s.length; i++) { n += s.length; if (i === 1) s = s + "xy"; if (i > 8) break; } return n; }
export function untypedLength(s: any): number { let n = 0; for (let i = 0; i < s.length; i++) n += i; return n; }
const wide = (s: string): string => ("日" + s).slice(1);
const rope = (s: string): string => s.length < 2 ? s : s.slice(0, s.length >> 1) + s.slice(s.length >> 1);
const cutOut = (s: string): string => ("<<" + s + ">>").substring(2, 2 + s.length);
const kinds: [string, (s: string) => string][] = [["same", s => s], ["wide", wide], ["rope", rope], ["part", cutOut], ["longRope", s => s + "0123456789".repeat(30) + s]];
for (const [name, make] of kinds) print(name + ": " + ["", "a", "abc", "abcdefghij"].map(t => [counted(make(t)), greater(make(t), make("abc")), greater("abcd", make(t)), nested(make(t), make("xy")), downwards(make(t)), whileLoop(make(t)), optional(make(t)), neverEntered(make(t), 0), neverEntered(make(t), 2), lengthAndCharacters(make(t)), lengthOfOneCharactersOfOther(make(t), make("pq")), lengthFirstCharactersInInner(make(t)), lengthInInnerOnly(make(t), make("pqr")), changesInLoop(make(t)), untypedLength(make(t))].join()).join(" | "));
// A rope whose length was read is still a rope: only the time shows it. What is observable: null or undefined.
print([() => nilThrows(undefined as any), () => nilThrows(null as any), () => counted(undefined as any), () => greater("a", null as any), () => optional(), () => optional(undefined), () => neverEntered(null as any, 0), () => neverEntered(null as any, 1), () => untypedLength([1, 2, 3]), () => untypedLength({ length: 4 }), () => untypedLength(7), () => untypedLength(null)].map(attempt).join());
(globalThis as any).kept = [counted, greater, nested, downwards, whileLoop, optional, nilThrows, neverEntered, lengthAndCharacters, lengthOfOneCharactersOfOther, lengthFirstCharactersInInner, lengthInInnerOnly, changesInLoop, untypedLength]; console.log("number");
