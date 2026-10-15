// `RegExp.prototype.test` and `String.prototype.search`: `lastIndex` of every kind, the legacy static properties, ropes, 16-bit strings and errors.
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
export function tested(r: RegExp, s: string): boolean { return r.test(s); }
export function testedUntyped(r: any, s: any): any { return r.test(s); }
export function searched2(s: string, r: RegExp): number { return s.search(r); }
export function searchedUntyped(s: any, r: any): any { return s.search(r); }
const statics = (): string => [RegExp.$1, RegExp.$2, RegExp.lastMatch, RegExp.lastParen, (RegExp as any)["$`"], (RegExp as any)["$'"], (RegExp as any).input].map(show).join();
// The legacy statics after a hit, after a miss (unchanged), after the other of the two.
print(tested(/b(c)(d)?/, "abcde") + " " + statics()); print(tested(/zz/, "abcde") + " " + statics()); print(searched2("xxhello", /h(e)l/) + " " + statics()); print(searched2("xx", /h(e)l/) + " " + statics());
print(testedUntyped(/(\d+)-(\d+)/, "on 12-34.") + " " + statics() + " " + searchedUntyped("on 56-78.", /(\d+)-(\d+)/) + " " + statics());
// `lastIndex` of every kind, with neither the global nor the sticky flag: it is read (and converted to a number), has no effect, and is not written.
for (const flags of ["", "i", "m", "s", "u", "v", "d", "g", "y", "gy", "gi"]) {
    let out = flags + ":";
    for (const index of [0, 1, 2, 5, 99, -1, 1.5, -0, NaN, Infinity, 4294967295, 4294967296, "1", "x", null, undefined, true, { valueOf() { log.push("valueOf"); return 1; } }, { toString() { log.push("toString"); return "2"; } }]) {
        const r = new RegExp("b", flags); (r as any).lastIndex = index;
        out += " " + tested(r, "abcb") + "/" + (typeof r.lastIndex === "object" ? "o" : String(r.lastIndex)); (r as any).lastIndex = index; out += "," + searched2("abcb", r) + "/" + (typeof r.lastIndex === "object" ? "o" : String(r.lastIndex));
    }
    print(out + " " + log.splice(0).length);
}
print(attempt(() => { const r = /b/; (r as any).lastIndex = { valueOf() { throw new RangeError("mine"); } }; return tested(r, "abc"); }) + " " + attempt(() => { const r = /b/; (r as any).lastIndex = Symbol.iterator; return tested(r, "abc"); }) + " " + attempt(() => { const r = /b/; (r as any).lastIndex = 1n; return tested(r, "abc"); }));
{ const frozen = Object.freeze(/b/); const frozenGlobal = Object.freeze(/b/g); print(tested(frozen, "abc") + " " + searched2("abc", frozen) + " " + attempt(() => tested(frozenGlobal, "abc")) + " " + attempt(() => searched2("abc", frozenGlobal))); }
// Subjects: ropes, substrings, 16 bits, empty, long; shorter than the least a match needs.
{ const left = "left of the rope ", right = "and its right " + String(Date.length); const rope = left + right; print(tested(/rope and/, rope) + " " + searched2(left + right + left, /right 7left/) + " " + tested(/^$/, "") + " " + tested(/abc/, "ab") + " " + searched2("", /x?/) + " " + tested(/日本/, "in 日本語") + " " + searched2("café 😀!", /\p{Emoji_Presentation}/u) + " " + searched2("a😀", /\ude00/) + " " + searched2("a😀", /\ude00/u) + " " + tested(/x$/, "y".repeat(5000) + "x") + " " + searched2("abcdef".slice(2), /e/)); }
// The receiver is something else, or has own properties.
{ class Mine extends RegExp { exec(s: string): RegExpExecArray | null { log.push("exec of mine"); return super.exec(s); } } print(testedUntyped(new Mine("b"), "abc") + " " + searchedUntyped("abc", new Mine("c")) + " " + log.splice(0).join()); const own: any = /b/; own.exec = () => { log.push("own exec"); return null; }; print(testedUntyped(own, "abc") + " " + searchedUntyped("abc", own) + " " + log.splice(0).join()); print(testedUntyped({ test: () => "no RegExp" }, "") + " " + attempt(() => RegExp.prototype.test.call({}, "a")) + " " + attempt(() => testedUntyped(/a/, Symbol.iterator)) + " " + testedUntyped(/null/, null) + testedUntyped(/undefined/, undefined) + testedUntyped(/12/, 3127) + " " + searchedUntyped("a1b", 1) + searchedUntyped("a.b", ".") + searchedUntyped("abc", undefined) + " " + searchedUntyped("abc", { [Symbol.search]: () => "mine" })); }
{ const r = /a/; r.compile("c"); print(tested(r, "abc") + " " + searched2("abc", r) + " " + attempt(() => tested(new RegExp("("), "a"))); }
// Backtracking that gives up on the stack or runs long enough to matter; many groups (more than the short way's 32 words hold).
{ const many = new RegExp("(a)".repeat(20) + "(b)?"); print(tested(many, "a".repeat(20)) + " " + statics() + " " + searched2("x" + "a".repeat(20), many) + " " + tested(/^(a+)+$/, "a".repeat(18) + "b") + " " + tested(/(?<year>\d{4})-(?<month>\d\d)/, "2026-10") + show(RegExp.$2) + " " + tested(/(?<=\$)\d+/, "cost $42") + show(RegExp.lastMatch) + " " + tested(/\bfoo\b/i, "a FOO b") + " " + tested(/^(?:one|two|three)$/, "two") + tested(/^(?:one|two|three)$/, "twos")); }
{ let n = 0; const printable = /^[ -~]*$/; for (let i = 0; i < 20000; i++) { if (tested(printable, "line " + i + (i % 7 ? "" : "─"))) n++; n += searched2("line " + i, /\d$/); } print(String(n) + " " + statics()); }
(globalThis as any).kept = [tested, testedUntyped, searched2, searchedUntyped]; console.log("number");
