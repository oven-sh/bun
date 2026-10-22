// What is read of a match that is taken apart: index, input, groups that are compared, measured, parsed, kept or never read. Every line prints what plain Bun prints.
declare const console: { log(...values: unknown[]): void };
function opaque<T>(value: T): T { return [value][Number(String(0))]; }

function indexAndLength(s: string): number { const m = /b+/.exec(s); return m ? m.index + m[0].length : -1; }
function inputOf(s: string): string { const m = /b+/.exec(s); return m ? m.input + "|" + m.index : "none"; }
function inputIsTheConvertedOperand(n: number): string { const m = /2/.exec(n as any); return m ? typeof m.input + m.input + m.index : "none"; }
function comparedGroup(s: string): number { const m = /(\w+)=(\w*)/.exec(s); if (!m) return 0; return m[1] === "key" ? 1 : m[2] === "" ? 2 : 3; }
function measuredGroups(s: string): number { const m = /(\w+)=(\w*)/.exec(s); return m ? m[1].length * 100 + m[2].length : -1; }
function parsedGroups(s: string): number { const m = /(\d+)-(\d+)/.exec(s); return m ? parseInt(m[1], 10) * 1000 + Number(m[2]) : NaN; }
function keptGroup(s: string, kept: string[]): number { const m = /<(\w+)>/.exec(s); if (m) kept.push(m[1]); return kept.length; }
function groupThatTookNoPart(s: string): string { const m = /(a)|(b)/.exec(s); return m ? String(m[1]) + "," + String(m[2]) + "," + (m[1] === undefined) + "," + (m[2] === undefined) : "none"; }
function groupPastTheLast(s: string): string { const m = /(a)/.exec(s); return m ? String(m[2]) + m.length : "none"; }
function emptyGroup(s: string): string { const m = /a(x*)b/.exec(s); return m ? JSON.stringify(m[1]) + (m[1] === "") + (m[1] === undefined) + m[1].length : "none"; }
function defaulted(s: string): string { const m = /(a)?(b)?/.exec(s)!; return (m[1] ?? "no a") + "/" + (m[2] || "no b"); }
function destructured(s: string): string { const [, first, second = "none"] = /(\w)(\d)?/.exec(s) ?? []; return first + second; }
function everyMatch(s: string): string {
    const word = /(\w+)/g;
    let out = "";
    for (let m = word.exec(s); m; m = word.exec(s)) out += m.index + ":" + m[1].length + ":" + word.lastIndex + " ";
    return out;
}
function sticky(s: string, from: number): string { const r = /b(c)?/y; r.lastIndex = from; const m = r.exec(s); return m ? m.index + String(m[1]) + r.lastIndex : "none" + r.lastIndex; }
function matchIsExec(s: string): string { const m = s.match(/(\d+)(px)?/); return m ? m.index + "," + m.input + "," + m[1] + "," + String(m[2]) + "," + m.length : "none"; }
function globalMatch(s: string): string { const m = s.match(/\d/g); return m ? m.length + m[0] + String((m as any).index) + String(m[5]) : "none"; }
function matchOfEither(s: string, global: boolean): string { const r = global ? /\d/g : /\d/; const m = s.match(r); return m ? m.length + m[0] + String(m.index) : "none"; }
function namedGroups(s: string): string { const m = /(?<year>\d{4})-(?<month>\d\d)/.exec(s); return m ? m.groups!.year + m.groups!.month + m.index + m[2] : "none"; }
function indices(s: string): string { const m = /a(b)/d.exec(s); return m ? JSON.stringify((m as any).indices) + m.index : "none"; }
function changedIndex(s: string): number { const m = /b/.exec(s); if (!m) return -1; m.index = 40; return m.index + 2; }
function escapes(s: string): RegExpExecArray | null { const m = /(b)(c)?/.exec(s); if (m && m.index > 100) return null; return m; }
function ofARange(s: string): string { const m = /(\d+)/.exec(s.slice(2)); return m ? m.index + ":" + m[1] + ":" + m.input : "none"; }
function sixteenBit(s: string): string { const m = /(β+)(x)?/.exec(s); return m ? m.index + m[1] + m[1].length + String(m[2]) : "none"; }
function legacyStatics(s: string): string { const m = /(b)(c)/.exec(s); return m ? (RegExp as any).$1 + (RegExp as any).$2 + (RegExp as any).lastMatch + m.index : "none"; }

const kept: string[] = [];
const out: unknown[] = [];
for (const s of ["aabbbc", "", "b", "xyz"]) out.push(indexAndLength(opaque(s)), inputOf(opaque(s)));
out.push(inputIsTheConvertedOperand(opaque(123)), inputIsTheConvertedOperand(opaque(5)));
for (const s of ["key=1", "k=", "k=v", "none"]) out.push(comparedGroup(opaque(s)), measuredGroups(opaque(s)));
for (const s of ["12-34", "x 007-9 y", "1-"]) out.push(parsedGroups(opaque(s)));
for (const s of ["<a>", "none", "x<bcd>"]) out.push(keptGroup(opaque(s), kept));
out.push(kept.join());
for (const s of ["a", "b", "c"]) out.push(groupThatTookNoPart(opaque(s)), groupPastTheLast(opaque(s)));
for (const s of ["ab", "axxb", "a"]) out.push(emptyGroup(opaque(s)));
for (const s of ["ab", "a", "b", ""]) out.push(defaulted(opaque(s)));
for (const s of ["a1", "a", "-"]) out.push(destructured(opaque(s)));
out.push(everyMatch(opaque("ab cde  f")), everyMatch(opaque("")), sticky(opaque("abc"), 1), sticky(opaque("abc"), 0), sticky(opaque("ab"), 1), sticky(opaque("ab"), 9));
for (const s of ["w 12px", "7", "none"]) out.push(matchIsExec(opaque(s)), globalMatch(opaque(s)), matchOfEither(opaque(s), opaque(true)), matchOfEither(opaque(s), opaque(false)));
out.push(namedGroups(opaque("on 2026-10-19")), namedGroups(opaque("x")), indices(opaque("xab")), changedIndex(opaque("ab")), changedIndex(opaque("a")));
out.push(JSON.stringify(escapes(opaque("abc"))), escapes(opaque("ab"))?.index, escapes(opaque("ab"))?.input, escapes(opaque("x")));
out.push(ofARange(opaque("12ab345")), ofARange(opaque("12")), sixteenBit(opaque("αββx")), sixteenBit(opaque("α")), legacyStatics(opaque("abc")));
console.log(out.map(String).join("\n"));
