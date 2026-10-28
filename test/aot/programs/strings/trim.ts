// `trim`, `trimStart`, `trimEnd`, `trimLeft` and `trimRight`.
// CALLS+ trim_ operationAOTSubstring|StringTrim(;|$)
// CALLS+ trimStart_ operationAOTSubstring|StringTrim(Start)?(;|$)
// CALLS+ trimEnd_ operationAOTSubstring|StringTrim(End)?(;|$)
// CALLS- trim_ CallValue|OperationValueWithInstance
// CALLS+ trimOfAnything CallHostFunction|CallValue|Call0|CallMethod0
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
export function trim_(s: string): string { return s.trim(); }
export function trimStart_(s: string): string { return s.trimStart(); }
export function trimEnd_(s: string): string { return s.trimEnd(); }
export function trimLeft_(s: string): string { return (s as any).trimLeft(); }
export function trimRight_(s: string): string { return (s as any).trimRight(); }
export function trimOfAnything(s: any): unknown { return s.trim(); }
function all(s: () => string): string { return show(trim_(s())) + show(trimStart_(s())) + show(trimEnd_(s())) + show(trimLeft_(s())) + show(trimRight_(s())) + show(trimOfAnything(s())) + trim_(s()).length; }
// Every code unit below 0x300, every other white space character, and their neighbors, on both sides of a letter, alone, and twice.
let white = "";
for (const range of [[0, 0x300], [0x1680, 0x1681], [0x180e, 0x180f], [0x1fff, 0x2010], [0x2027, 0x2030], [0x205e, 0x2061], [0x2fff, 0x3002], [0xd800, 0xd801], [0xfefe, 0xff00], [0xfffe, 0x10000]]) {
    for (let c = range[0]; c < range[1]; c++) {
        const u = String.fromCharCode(c);
        const a = trim_(u + "a" + u), b = trimStart_(u + "a" + u), e = trimEnd_(u + "a" + u);
        if (a.length !== 3 || b.length !== 3 || e.length !== 3 || trim_(u).length !== 1 || trim_(u + u).length !== 2)
            white += " " + c.toString(16) + ":" + a.length + b.length + e.length + trim_(u).length + trimStart_(u + u).length + trimEnd_(u + u).length;
    }
}
print(white);
for (const s of [
    () => "", () => " ", () => "  ", () => "a", () => " a", () => "a ", () => " a ", () => "  padded  ", () => "no space", () => "in the middle", () => "\t\n\v\f\r \u00a0x y\u00a0 \r\f\v\n\t", () => "\u0085x\u0085", () => "\u200bx\u200b",
    () => "\ufeff\u2028\u2029\u3000x\u3000\u2029\u2028\ufeff", () => " \u65e5\u672c ", () => "\u3000 ", () => " \u00e9 ", () => "\u00a0\u00a0", () => "                                                                  ",
    () => cat("  left", "right  "), () => cat("   ", "   "), () => cat("  ", "x"), () => cat(" \u3000", "x\u3000 "), () => cat3(" ", " a ", " "),
    () => part("xx  padded  xx", 2, 12), () => part("xx    xx", 2, 6), () => part("x padded x", 1, 9), () => part(part("xx  padded  xx", 1, 13), 1, 11), () => part("\u65e5  x  \u65e5", 1, 6), () => flattened(cat("  a", "b  ")),
])
    print(all(s));
// What comes of it is used as any string.
const t = trim_("  key = value  ");
print(show(t.slice(0, 3)) + show(t.charCodeAt(0)) + show(t + "!") + show(t.indexOf("=")) + show(trim_(t) === t) + show(trim_(t.slice(3, 7))) + show(t.toUpperCase()));
for (const nil of [undefined, null]) {
    const s = nil as unknown as string;
    print(attempt(() => trim_(s)) + attempt(() => trimStart_(s)) + attempt(() => trimEnd_(s)) + attempt(() => trimOfAnything(nil)));
}
class Loud extends String { trim(): string { return "overridden"; } }
for (const other of [new String("  boxed  "), new Loud("  x  "), { trim() { return "mine"; } }, 12, true])
    print(attempt(() => trimOfAnything(other)));
print(attempt(() => String.prototype.trim.call(12)) + attempt(() => String.prototype.trim.call({ toString() { return "  object  "; } })) + attempt(() => String.prototype.trimEnd.call(null)) + attempt(() => String.prototype.trimStart.call(Symbol())));
// The functions that the expectations name must stay functions: one that is inlined into all of its callers has no code of its own.
(globalThis as any).kept = [trim_, trimStart_, trimEnd_, trimOfAnything]; console.log("number");
