// RegExp literals that are only used in place (`test`, `exec`, `replace`, `split`) next to literals that are returned, stored or passed on: each evaluation still behaves like a new object.
// CALLS+ tested operationAOTSharedRegExpLiteral
// CALLS- tested operationAOTNewRegExpLiteral
// CALLS+ testedUntyped operationAOTSharedRegExpLiteral
// CALLS+ testedOfProperty operationAOTSharedRegExpLiteral
// CALLS+ executed operationAOTSharedRegExpLiteral
// CALLS+ replacedAll operationAOTSharedRegExpLiteral
// CALLS+ cutUp operationAOTSharedRegExpLiteral
// CALLS+ heldInConstant operationAOTSharedRegExpLiteral
// CALLS- returned operationAOTSharedRegExpLiteral
// CALLS- stored operationAOTSharedRegExpLiteral
// CALLS- passedOn operationAOTSharedRegExpLiteral
// CALLS- globalTested operationAOTSharedRegExpLiteral
// CALLS- globalLoop operationAOTSharedRegExpLiteral
// CALLS- sticky operationAOTSharedRegExpLiteral
// CALLS- givenProperty operationAOTSharedRegExpLiteral
// CALLS- lastIndexRead operationAOTSharedRegExpLiteral
// CALLS- replacedUntyped operationAOTSharedRegExpLiteral
// CALLS- otherMethod operationAOTSharedRegExpLiteral
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
export function tested(s: string): boolean { return /^[a-z]+ /.test(s); }
export function testedUntyped(s: any): any { return /^[a-z]+ /.test(s); }
export function testedOfProperty(o: any): any { return /^[a-z]+ /.test(o.text); }
export function executed(s: string): string { const m = /(\d+)-(\d+)/.exec(s); return m ? m[1] + "|" + m[2] + "@" + m.index : "none"; }
export function replacedAll(s: string): string { return s.replace(/a/g, "[a]").replace(/b/, "[b]").replaceAll(/c/g, "[c]"); }
export function cutUp(s: string): string { return s.split(/,\s*/).join("|") + " " + String(s.match(/\w+/g)) + " " + String(s.match(/(\w)(\w)/)) + " " + s.search(/,/); }
export function heldInConstant(list: string[]): number { const word = /^\w+$/; let n = 0; for (const s of list) if (word.test(s)) n++; return n; }
export function returned(): RegExp { return /a/; }
export function stored(into: RegExp[]): void { into.push(/a/); }
export function passedOn(f: (r: RegExp) => string): string { return f(/a/); }
export function globalTested(s: string): boolean { return /a/g.test(s); }
export function globalLoop(s: string, depth: number): string { const r = /a/g; let out = ""; let m: RegExpExecArray | null; while ((m = r.exec(s))) { out += m.index; if (depth) out += "(" + globalLoop(s, depth - 1) + ")"; } return out; }
export function sticky(s: string): string { return String(/a/y.test(s)) + s.replace(/a/y, "_") + String(s.match(/a/gy)); }
export function givenProperty(): string { const r: any = /a/; const had = r.mine; r.mine = 1; return String(had); }
export function lastIndexRead(s: string): number { const r = /a/; r.test(s); return r.lastIndex; }
export function replacedUntyped(s: any): any { return s.replace(/a/g, "_"); }
export function otherMethod(): string { return /a/i.toString() + /b/.source + /c/g.flags + String(/d/.global); }
export function replacing(s: string, depth: number): string { return s.replace(/a/g, m => depth ? "<" + replacing("xax", depth - 1) + ">" : m.toUpperCase()); }
export function throwingReplacer(s: string): string { try { return s.replace(/a/g, () => { throw new RangeError("mine"); }); } catch (e) { return (e as Error).message + s.replace(/a/g, "!"); } }
export function reentering(depth: number): any { return /^1/.test({ toString() { log.push("toString " + depth); return depth ? String(Number(reentering(depth - 1))) : "1"; } } as any); }
export async function awaited(s: string): Promise<string> { const first = /a/.test(s); await null; return String(first) + /a/.test(s) + s.replace(/a/g, "_"); }
export function* yielded(s: string): Generator<any> { const word = /\w/; for (const c of s) yield word.test(c); }
print([tested("plain text"), tested("9 lives"), tested("plain text"), testedUntyped("abc d"), testedUntyped(12), testedUntyped(null), testedUntyped({ toString: () => "ok then" }), testedOfProperty({ text: "ab c" }), testedOfProperty({})].join());
print([executed("on 12-34"), executed("none"), executed("5-6 7-8"), replacedAll("abcabc"), replacedAll(""), cutUp("one, two,three"), cutUp(""), heldInConstant(["a", "b c", "d"]), heldInConstant([])].join(" ; "));
// Code that can observe the difference.
{ const a = returned(), b = returned(); const kept: RegExp[] = []; stored(kept); stored(kept); let seen: RegExp | undefined; const same = passedOn(r => { const was = seen === r; seen = r; return String(was); }) + passedOn(r => String(seen === r)); print([a === b, kept[0] === kept[1], same, givenProperty(), givenProperty(), lastIndexRead("a"), otherMethod()].join()); }
// `lastIndex` starts at 0 at every evaluation.
print([globalTested("a"), globalTested("a"), globalTested("a"), globalLoop("aa", 0), globalLoop("aa", 1), globalLoop("aba", 2), sticky("aab"), sticky("aab"), sticky("baa")].join(" "));
print([replacedUntyped("banana"), replacedUntyped({ replace: (r: RegExp, w: string) => { (r as any).seen = ((r as any).seen || 0) + 1; return r.source + w + (r as any).seen; } }), replacedUntyped({ replace: (r: RegExp, w: string) => r.source + w + String((r as any).seen) })].join());
// While one of them runs the same literal is come to again.
print([replacing("aba", 0), replacing("aba", 1), replacing("aa", 2), throwingReplacer("banana"), throwingReplacer("banana"), reentering(0), reentering(2), log.splice(0).join()].join(" "));
// The legacy statics name the expression, not the object.
print([tested("abc def"), RegExp.lastMatch, executed("1-2"), RegExp.$1, RegExp.$2, cutUp("x,y"), show(RegExp.lastMatch)].join());
{ let n = 0; for (let i = 0; i < 30000; i++) { if (tested(i % 3 ? "word " + i : String(i))) n++; n += replacedAll("abc" + i).length + executed(i + "-" + i).length; } print(String(n)); }
print([...yielded("a b")].join());
(async () => { print(await awaited("banana")); print((await Promise.all([awaited("a"), awaited("b")])).join()); })();
(globalThis as any).kept = [tested, testedUntyped, testedOfProperty, executed, replacedAll, cutUp, heldInConstant, returned, stored, passedOn, globalTested, globalLoop, sticky, givenProperty, lastIndexRead, replacedUntyped, otherMethod, replacing, throwingReplacer, reentering, awaited, yielded]; console.log("number");
