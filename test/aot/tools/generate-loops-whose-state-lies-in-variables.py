# generate-loops-whose-state-lies-in-variables.py <folder>: writes all 824 programs; ../parallel/loops-whose-state-lies-in-variables/ holds 6 of them.
# The state of a loop is in variables that closures share, and the values contradict the declared types.
# Each program is a file of its own that combines one entry of `shapes` with one entry of `lies`.
# Each program runs the loop with well-typed values (so that whatever learns has learned), then with the mistyped values, then with well-typed values again.
# It prints the results, what was thrown and what ran in between.
import sys, os
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
for f in os.listdir(out): os.remove(out + '/' + f)

# `text`, `at` and `limit` are the variables. LOOP is the body of step(). Every shape returns `at`.
shapes = {
 'while-with-the-test-in-its-head': 'while (at < limit && text.charCodeAt(at) === 32) at++;',
 'while-true-with-breaks': 'while (true) { if (at >= limit) break; const unit = text.charCodeAt(at); if (unit !== 32) break; at++; }',
 'for-with-the-step-in-its-head': 'for (; at < limit; at++) { if (text.charCodeAt(at) !== 32) break; }',
 'do-while': 'do { if (text.charCodeAt(at) !== 32) break; at++; } while (at < limit);',
 'steps-of-two': 'while (at < limit && text.charCodeAt(at) === 32) at += 2;',
 'backwards': 'while (at > limit && text.charCodeAt(at) === 32) at--;',
 'the-limit-is-written-in-an-arm': 'while (at < limit) { const unit = text.charCodeAt(at); if (unit === 120) limit = at; else at++; }',
 'the-text-is-written-in-an-arm': 'while (at < limit && text.charCodeAt(at) === 32) { at++; if (at === 3) text = text + ""; }',
 'a-closure-is-called-behind-the-read': 'while (at < limit && text.charCodeAt(at) === 32) { at++; note(); }',
 'a-closure-is-called-in-front-of-the-read': 'while (at < limit) { note(); if (text.charCodeAt(at) !== 32) break; at++; }',
 'by-index': 'while (at < limit && text[at] === " ") at++;',
 'the-length-is-read-each-turn': 'while (at < text.length && text.charCodeAt(at) === 32) at++;',
 'under-a-handler': 'try { while (at < limit && text.charCodeAt(at) === 32) at++; } catch (error) { said.push("caught " + (error as Error).constructor.name); }',
 'through-a-small-callee': 'while (at < limit && unitAt(at) === 32) at++;',
 'through-two-callees': 'while (at < limit && isBlank(unitAt(at))) at++;',
 'a-mark-from-in-front': 'const mark = unitAt(at); while (at < limit && unitAt(at) === mark) at++;',
 'a-sum-goes-round-beside': 'let sum = 0; while (at < limit && text.charCodeAt(at) === 32) { sum += at; at++; } said.push(String(sum));',
}
lies = {
 'nothing': 'set("   x", 0, 4)',
 'at-undefined': 'set("   x", undefined, 4)', 'at-null': 'set("   x", null, 4)', 'at-nan': 'set("   x", NaN, 4)', 'at-a-fraction': 'set("   x", 0.5, 4)', 'at-minus-one': 'set("   x", -1, 4)',
 'at-minus-zero': 'set("   x", -0, 4)', 'at-a-text': 'set("   x", "1", 4)', 'at-a-big-integer': 'set("   x", 1n, 4)', 'at-true': 'set("   x", true, 4)', 'at-a-symbol': 'set("   x", Symbol("s"), 4)',
 'at-an-object-that-answers': 'set("   x", { valueOf() { said.push("asked"); return 1; } }, 4)', 'at-an-object-that-throws': 'set("   x", { valueOf() { throw new RangeError("no"); } }, 4)',
 'at-near-the-end-of-int32': 'set("   x", 2147483646, 2147483650)', 'at-past-int32': 'set("   x", 4294967296, 4294967300)', 'at-infinity': 'set("   x", Infinity, 4)',
 'limit-undefined': 'set("   x", 0, undefined)', 'limit-nan': 'set("   x", 0, NaN)', 'limit-a-fraction': 'set("   x", 0, 2.5)', 'limit-infinity': 'set("   x", 0, Infinity)', 'limit-a-text': 'set("   x", 0, "2")',
 'limit-an-object-that-answers': 'set("   x", 0, { valueOf() { said.push("asked"); return 2; } })', 'limit-an-object-that-moves-at': 'set("   x", 0, { valueOf() { said.push("asked"); poke(2); return 3; } })', 'limit-past-the-text': 'set("   ", 0, 9)',
 'text-undefined': 'set(undefined, 0, 4)', 'text-null': 'set(null, 0, 4)', 'text-a-number': 'set(42, 0, 4)', 'text-a-text-object': 'set(new String("   x"), 0, 4)', 'text-empty': 'set("", 0, 4)',
 'text-a-rope': 'set("  ".concat(" ", String(said.length ? "x" : "y")), 0, 4)', 'text-of-wide-units': 'set("  \\u3000 x", 0, 5)', 'text-a-list': 'set([" ", " ", "x"], 0, 3)',
 'text-an-object-that-answers': 'set({ length: 4, 0: " ", 1: " ", charCodeAt(i: number) { said.push("unit " + i); return i < 2 ? 32 : 120; } }, 0, 4)',
 'text-an-object-that-moves-at': 'set({ length: 9, 0: " ", 1: " ", 2: " ", 3: " ", 4: " ", charCodeAt(i: number) { said.push("unit " + i); if (i === 1) poke(3); return i < 5 ? 32 : 120; } }, 0, 9)',
 'text-an-object-that-swaps-the-text': 'set({ length: 9, 0: " ", charCodeAt(i: number) { said.push("unit " + i); swap("  x"); return 32; } }, 0, 9)',
 'text-an-object-that-cuts-the-limit': 'set({ length: 9, 0: " ", 1: " ", 2: " ", charCodeAt(i: number) { said.push("unit " + i); cut(2); return 32; } }, 0, 9)',
}
homes = {
 'an-environment': ('''function make(first?: string) {
  let text = first!;
  let at: number;
  let limit: number;
  let notes = 0;
  function note() { notes++; }
  function unitAt(i: number) { return text.charCodeAt(i); }
  function isBlank(unit: number) { return unit === 32; }
  function step() { LOOP return at; }
  function set(a: any, b: any, c: any) { text = a; at = b; limit = c; }
  return { step, set, poke(to: any) { at = to; }, swap(to: any) { text = to; }, cut(to: any) { limit = to; }, notes: () => notes };
}
const { step, set, poke, swap, cut } = make();
(globalThis as any).made = make;
'''),
 'a-module': ('''let text: string;
let at: number;
let limit: number;
let notes = 0;
function note() { notes++; }
function unitAt(i: number) { return text.charCodeAt(i); }
function isBlank(unit: number) { return unit === 32; }
function step() { LOOP return at; }
function set(a: any, b: any, c: any) { text = a; at = b; limit = c; }
function poke(to: any) { at = to; }
function swap(to: any) { text = to; }
function cut(to: any) { limit = to; }
(globalThis as any).made = [step, set, poke, swap, cut];
'''),
}
tail = '''function show(value: unknown) { return typeof value === "bigint" ? value + "n" : typeof value === "symbol" ? "symbol" : Object.is(value, -0) ? "-0" : typeof value === "object" && value ? "object" : String(value); }
function go() { try { said.push(show(step())); } catch (error) { said.push("thrown " + (error as Error).constructor.name); } }
for (let round = 0; round < 30; round++) { set("     x".slice(round % 3), 0, 6 - round % 3); step(); }
set("   x", 0, 4); go();
LIE; go(); go();
set("  x", 0, 3); go();
console.log(said.join(" | "));
'''
n = 0
for h, home in homes.items():
    for s, loop in shapes.items():
        for l, lie in lies.items():
            if s == 'while-true-with-breaks' and l in ('at-nan', 'at-undefined'): continue      # they never end, under plain Bun either
            if h == 'a-module' and s not in ('while-with-the-test-in-its-head', 'while-true-with-breaks', 'the-limit-is-written-in-an-arm', 'a-closure-is-called-behind-the-read', 'through-a-small-callee', 'a-sum-goes-round-beside'): continue
            open('%s/%s-%s-%s.ts' % (out, h, s, l), 'w').write('const said: string[] = [];\n' + home.replace('LOOP', loop) + tail.replace('LIE', lie)); n += 1
print(n, 'programs')
