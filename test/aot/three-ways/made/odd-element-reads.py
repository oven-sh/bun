#!/usr/bin/env python3
"""odd-element-reads.py <folder>: Whatever is odd about a read of an element goes to one rare arm. Nine kinds of elements, five readers (a leaf, one with a frame, one under register pressure, a loop past the end, one in `try`), some forty arrays, fourteen indices: odd_<kind>.ts; the same with elements of the wrong kind: wrong_<kind>.ts. And bad_time.ts: elements inherited from Array.prototype and Object.prototype, set and taken away while the program runs."""
import os, re, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
KINDS = [  # name, type, three makers
 ('rec', 'Rec', ['new Rec(1, "a")', 'new Rec(2, "b")', 'new Rec(3, "c")']),
 ('pt', 'Pt', ['{ x: 1, y: 2 }', '{ x: 3, y: 4 }', '{ x: 5, y: 6 }']),
 ('str', 'string', ['"s" + one', '"t" + one', '"u" + one']),
 ('flag', 'boolean', ['one > 0', 'one < 0', 'one === 1']),
 ('sym', 'symbol', ['S1', 'S2', 'S3']),
 ('big', 'bigint', ['10n', '20n', '30n']),
 ('fun', '() => number', ['() => 1', '() => 2', '() => 3']),
 ('row', 'Rec[]', ['[new Rec(1, "a")]', '[]', '[new Rec(3, "c"), new Rec(4, "d")]']),
 ('either', 'Rec | Pt', ['new Rec(1, "a")', '{ x: 3, y: 4 }', 'new Rec(3, "c")']),
]
HEADLINES = ['declare const console: { log(...values: any[]): void };', 'export { };',
 'class Rec { constructor(public amount: number, public label: string) { } }', 'interface Pt { x: number; y: number }',
 'class Mine<T> extends Array<T> { }',
 'const S1 = Symbol("s1"), S2 = Symbol("s2"), S3 = Symbol("s3"); let one = 1; let notes = 0; let depth = 0; function note(): void { ++notes; }',
 'function show(v: unknown): string { return v === undefined ? "undefined" : v === null ? "null" : v instanceof Rec ? "Rec" + v.amount + v.label : typeof v === "function" ? "f" + (v as () => number)() : typeof v === "symbol" ? String(v) : typeof v === "bigint" ? v + "n" : Array.isArray(v) ? "[" + v.map(show).join() + "]" : typeof v === "object" ? JSON.stringify(v) : typeof v + ":" + String(v); }',
 'function tell(name: string, f: () => string): void { let text: string; try { text = f(); } catch (e) { text = e instanceof TypeError ? "TypeError" : "threw " + String(e); } console.log(name + ": " + text); }',
 'const INDICES: number[] = [0, 1, 2, 3, 7, 100, -1, -0, 2147483648, 4294967294, 4294967295, 4294967296, 9007199254740992, 5000];', 'const FRACTIONS: number[] = [0.5, NaN, Infinity, -1.5];']
import os, re
for f in os.listdir('.'):
    if re.match(r'^(odd|wrong)_.*\.ts$', f) or f == 'odd2.ts': os.remove(f)
for k, t, m in KINDS:
  for wrong in (False, True):
    out = list(HEADLINES)
    G = 'if (depth > 0) { depth--; %s; } '
    out.append('function use_%s(v: %s): string { %sreturn show(v); }' % (k, t, G % ('use_%s(v)' % k)))
    out.append('function leaf_%s(a: (%s)[], i: number): %s { %sreturn a[i]; }' % (k, t, t, G % ('leaf_%s(a, i)' % k)))
    out.append('function framed_%s(a: (%s)[], i: number): %s { %snote(); const v = a[i]; note(); return v; }' % (k, t, t, G % ('framed_%s(a, i)' % k)))
    out.append('function pressed_%s(a: (%s)[], i: number, x: number): string { %sconst d0 = x + 0.5, d1 = x * 1.5, d2 = x - 2.5, d3 = x / 3, d4 = x + 4.25, d5 = x * 5.5, d6 = x - 6.5, d7 = x / 7, d8 = x + 8.125, d9 = x * 9.5; const n0 = i + 1, n1 = i + 2, n2 = i + 3, n3 = i + 4, n4 = i + 5, n5 = i + 6, n6 = i + 7, n7 = i + 8; const v: %s = a[i]; const w: %s = a[n0]; return use_%s(v) + use_%s(w) + (d0 + d1 + d2 + d3 + d4 + d5 + d6 + d7 + d8 + d9).toFixed(3) + (n0 + n1 + n2 + n3 + n4 + n5 + n6 + n7); }' % (k, t, G % ('pressed_%s(a, i, x)' % k), t, t, k, k))
    out.append('function loop_%s(a: (%s)[]): string { let s = ""; const n = a.length < 12 ? a.length + 2 : 4; for (let i = 0; i < n; ++i) { const v: %s = a[i]; s += use_%s(v) + ","; } return s; }' % (k, t, t, k))
    out.append('function within_%s(a: (%s)[]): string { let s = ""; for (let i = 0; i < a.length && i < 12; ++i) { const v: %s = a[i]; s += use_%s(v) + ","; } return s; }' % (k, t, t, k))
    out.append('function of_%s(a: (%s)[]): string { let s = "", n = 0; for (const v of a) { if (++n > 12) break; s += use_%s(v) + ","; } return s; }' % (k, t, k))
    out.append('function tried_%s(a: (%s)[], i: number): string { %stry { const v: %s = a[i]; return use_%s(v); } catch (e) { return "caught"; } }' % (k, t, G % ('tried_%s(a, i)' % k), t, k))
    out.append('function nilly_%s(a: ((%s) | undefined | null)[], i: number): string { %sconst v = a[i]; return v === undefined ? "U" : v === null ? "N" : use_%s(v); }' % (k, t, G % ('nilly_%s(a, i)' % k), k))
    v0, v1, v2 = m
    T = '(%s)[]' % t
    arrays = [
     ('plain', '[%s, %s, %s]' % (v0, v1, v2)), ('deleted', '(() => { const a: %s = [%s, %s, %s]; delete (a as unknown[])[1]; return a; })()' % (T, v0, v1, v2)),
     ('a literal hole', '[%s, , %s] as %s' % (v0, v2, T)), ('new Array(3)', 'new Array<%s>(3)' % t), ('empty', '[] as %s' % T),
     ('lengthened', '(() => { const a: %s = [%s]; a.length = 3; return a; })()' % (T, v0)), ('truncated', '(() => { const a: %s = [%s, %s, %s]; a.length = 1; return a; })()' % (T, v0, v1, v2)),
     ('sparse', '(() => { const a: %s = [%s]; a[5000] = %s; return a; })()' % (T, v0, v1)), ('very sparse', '(() => { const a: %s = [%s]; a[300000] = %s; return a; })()' % (T, v0, v1)),
     ('frozen', 'Object.freeze([%s, %s]) as %s' % (v0, v1, T)), ('sealed', 'Object.seal([%s, %s])' % (v0, v1)),
     ('nils', '[%s, undefined, null, %s] as unknown as %s' % (v0, v2, T)), ('all undefined', '[undefined, undefined] as unknown as %s' % T),
     ('of a subclass', 'Mine.from([%s, %s]) as %s' % (v0, v1, T)), ('of a subclass with a hole', '(() => { const a = new Mine<%s>(3); a[0] = %s; return a as %s; })()' % (t, v0, T)),
     ('an heir', '(() => { const a = [%s, , %s] as %s; Object.setPrototypeOf(a, { __proto__: Array.prototype, 1: %s, 7: %s }); return a; })()' % (v0, v2, T, v1, v1)),
     ('a getter', '(() => { const a: %s = [%s, %s]; Object.defineProperty(a, "1", { get() { return %s; }, configurable: true, enumerable: true }); return a; })()' % (T, v0, v1, v2)),
     ('shifted', '(() => { const a: %s = [%s, %s, %s]; a.shift(); return a; })()' % (T, v0, v1, v2)), ('unshifted', '(() => { const a: %s = [%s]; a.unshift(%s, %s); return a; })()' % (T, v0, v1, v2)),
     ('spliced', '(() => { const a: %s = [%s, %s, %s]; a.splice(1, 1); return a; })()' % (T, v0, v1, v2)), ('reversed', '([%s, %s, %s] as %s).reverse()' % (v0, v1, v2, T)),
     ('mapped', '([%s, %s] as %s).map(v => v)' % (v0, v1, T)), ('filtered', '([%s, %s, %s] as %s).filter((_, i) => i !== 1)' % (v0, v1, v2, T)), ('sliced', '([%s, %s, %s] as %s).slice(1)' % (v0, v1, v2, T)),
     ('concatenated', '([%s] as %s).concat([%s])' % (v0, T, v1)), ('Array.from', 'Array.from([%s, %s] as %s)' % (v0, v1, T)), ('Array.of', 'Array.of<%s>(%s, %s)' % (t, v0, v1)), ('spread', '[...([%s, %s] as %s)]' % (v0, v1, T)),
     ('filled', 'new Array<%s>(3).fill(%s)' % (t, v0)), ('pushed', '(() => { const a: %s = []; for (let i = 0; i < 9; ++i) a.push(i %% 2 ? %s : %s); return a; })()' % (T, v0, v1)), ('popped', '(() => { const a: %s = [%s, %s]; a.pop(); return a; })()' % (T, v0, v1)),
     ('named', '(() => { const a: %s = [%s]; const r = a as unknown as Record<string, unknown>; r["-1"] = %s; r["4294967295"] = %s; r["9007199254740992"] = %s; r["0.5"] = %s; r["NaN"] = %s; return a; })()' % (T, v0, v1, v2, v1, v2, v1)),
     ('integers in it', '[1, 2, 3] as unknown as %s' % T), ('fractions in it', '[1.5, 2.5] as unknown as %s' % T), ('a mix in it', '[1, "x", %s, true, 2.5, null] as unknown as %s' % (v0, T)),
     ('a plain object in it', '[{ amount: 9, label: "p" }, { x: 9, y: 9 }, { other: 1 }] as unknown as %s' % T),
     ('stored beyond', '(() => { const a: %s = [%s]; a[3] = %s; return a; })()' % (T, v0, v1)),
    ]
    WRONG = ('integers in it', 'fractions in it', 'a mix in it', 'a plain object in it')
    arrays = [(n, mk) for n, mk in arrays if (n in WRONG) == wrong or (wrong and n == 'plain')]
    out.append('{')
    for name, make in arrays:
        out.append('  { const label = "%s %s"; let a: %s; try { a = %s; } catch (e) { a = []; console.log(label + ": not made"); }' % (k, name, T, make))
        out.append('    tell(label + " leaf", () => INDICES.map(i => show(leaf_%s(a, i))).join(" ")); tell(label + " framed", () => INDICES.map(i => show(framed_%s(a, i))).join(" ")); tell(label + " pressed", () => [0, 1, 2, 3, -1, 4294967294].map(i => pressed_%s(a, i, i + 0.25)).join(" "));' % (k, k, k))
        out.append('    tell(label + " loop", () => loop_%s(a) + "|" + within_%s(a) + "|" + of_%s(a)); tell(label + " tried", () => INDICES.map(i => tried_%s(a, i)).join(" ")); tell(label + " nilly", () => INDICES.map(i => nilly_%s(a, i)).join(" ")); tell(label + " fractions", () => FRACTIONS.map(i => show(leaf_%s(a, i))).join(" ")); tell(label + " again", () => INDICES.map(i => show(leaf_%s(a, i))).join(" ") + a.length); }' % (k, k, k, k, k, k, k))
    out.append('}')
    out.append('console.log("notes", notes);')
    open(('wrong_' if wrong else 'odd_') + k + '.ts', 'w').write('\n'.join(out) + '\n')
bad = ['declare const console: { log(...values: any[]): void };', 'export { };', 'class Rec { constructor(public amount: number, public label: string) { } }',
 'function show(v: unknown): string { return v === undefined ? "undefined" : v === null ? "null" : v instanceof Rec ? "Rec" + v.amount + v.label : typeof v + ":" + String(v); }',
 'function leaf(a: Rec[], i: number): Rec { return a[i]; }', 'let notes = 0; function framed(a: Rec[], i: number): Rec { ++notes; const v = a[i]; ++notes; return v; }',
 'function text(a: string[], i: number): string { return a[i]; }', 'function loop(a: Rec[]): string { let s = ""; for (let i = 0; i < a.length + 3; ++i) s += show(a[i]) + ","; return s; }',
 'const before: Rec[] = [new Rec(1, "a"), , new Rec(3, "c")] as Rec[]; const full: Rec[] = [new Rec(1, "a"), new Rec(2, "b")]; const words: string[] = ["x", , "z"] as string[]; const none: Rec[] = [];',
 'function all(when: string): void { const fresh: Rec[] = [new Rec(7, "f"), , new Rec(9, "h")] as Rec[]; for (const [n, a] of [["before", before], ["full", full], ["none", none], ["fresh", fresh]] as [string, Rec[]][]) console.log(when, n, [0, 1, 2, 3, 4, 5].map(i => show(leaf(a, i)) + "|" + show(framed(a, i))).join(" "), loop(a)); console.log(when, "words", [0, 1, 2, 3, 4].map(i => show(text(words, i))).join(" ")); }',
 'all("at first");', '(Array.prototype as any)[1] = new Rec(100, "AP1"); (Array.prototype as any)[4] = new Rec(400, "AP4"); all("Array.prototype has 1 and 4");',
 '(Object.prototype as any)[3] = new Rec(300, "OP3"); all("Object.prototype has 3 too");', 'delete (Array.prototype as any)[1]; delete (Array.prototype as any)[4]; all("Array.prototype has none again");', 'delete (Object.prototype as any)[3]; all("nobody has any");',
 'Object.defineProperty(Array.prototype, "5", { get() { return new Rec(500, "getter"); }, configurable: true }); all("a getter at 5"); delete (Array.prototype as any)[5]; all("at last");']
open('bad_time.ts', 'w').write('\n'.join(bad) + '\n')
print(len(KINDS), 'kinds')
