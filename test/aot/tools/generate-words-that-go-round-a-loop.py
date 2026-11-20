#!/usr/bin/env python3
# generate-words-that-go-round-a-loop.py <folder>: all 53; ../parallel/words-that-go-round-a-loop/ holds 16 of them: those that a fault laid into the compiler on purpose has turned red, of each shape of loop one.
# Variables enter a loop with what nobody has typed, and every turn hands them on out of a bit operator, by themselves or through one another.
# A compiler may ask what enters for an int32 once, in front of the loop. Each program enters its loop with int32s, and then with everything else that the language lets the operators take.
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)

HEAD = '''const show = (value: any): string => {
  try {
    return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : String(value);
  } catch (error) {
    return "cannot be shown";
  }
};
const attempt = (run: () => unknown): string => {
  try {
    return show(run());
  } catch (error) {
    return (error as Error).constructor.name;
  }
};
function hidden<T>(value: unknown): T {
  (globalThis as any).handedOn = value;
  return (globalThis as any).handedOn as T;
}
'''
count = 0
def program(name, says, text):
    global count
    open(os.path.join(out, name + '.ts'), 'w').write('// ' + says + '\n' + HEAD + text.strip('\n') + '\n')
    count += 1

ENTER = {
    'int32s': '[1, -2, 3, 2147483647, -2147483648]',
    'undefined': '[undefined, 2, undefined, 4, 5]',
    'null-and-booleans': '[null, true, false, 4, 5]',
    'fractions': '[1.5, -2.5, 0.1, 4, 5]',
    'minus-zero-and-nan': '[-0, NaN, Infinity, -Infinity, 5]',
    'numbers-beyond-int32': '[2147483648, -2147483649, 4294967296, 9007199254740993, 1e300]',
    'texts': '["7", "x", "", " 12 ", "0x10"]',
    'big-integers': '[1n, 2n, 3n, 4n, 5n]',
    'one-big-integer-among-numbers': '[1, 2n, 3, 4, 5]',
    'a-symbol': '[1, 2, Symbol.iterator, 4, 5]',
    'objects-that-convert-by-code': '[{ valueOf() { told.push("a"); return 6; } }, { valueOf() { told.push("b"); return 7.5; } }, { toString() { told.push("c"); return "8"; } }, 4, 5]',
    'an-object-that-throws': '[1, { valueOf() { throw new RangeError("no number"); } }, 3, 4, 5]',
    'lists': '[[9], [], [1, 2], 4, 5]',
}
ROUNDS = {
    'five-words-are-mixed-and-handed-on': '''
  for (let t = 0; t < turns; t++) {
    const next = (((a << 5) | (a >>> 27)) + ((b & c) | (~b & d)) + e + 0x5a827999 + t) | 0;
    e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = next;
  }''',
    'each-word-comes-round-out-of-an-operator-of-its-own': '''
  for (let t = 0; t < turns; t++) {
    a = a | t; b = b & ~t; c = c ^ t; d = ~d; e = e << 1;
  }''',
    'two-words-are-shifted-with-their-sign': '''
  for (let t = 0; t < turns; t++) {
    a = (a >> 1) ^ b; b = (b >> 2) | t; c = b; d = c; e = d;
  }''',
}
for how, loop in ROUNDS.items():
    for what, values in ENTER.items():
        program(f'{how}-and-{what}-enter', 'What enters is asked nothing by the language: each operator converts it in its turn.', f'''
const told: string[] = [];
function mix(from: any[], turns: number): string {{
  let a = from[0], b = from[1], c = from[2], d = from[3], e = from[4];{loop}
  return [a, b, c, d, e].map(show).join(" ");
}}
for (const turns of [0, 1, 2, 7]) console.log(turns, attempt(() => mix(hidden({ENTER['int32s']}), turns)), attempt(() => mix(hidden({values}), turns)), told.join(""));
''')

SHAPES = {
    'the-words-only-change-places': 'for (let t = 0; t < turns; t++) { const kept = a; a = b; b = c; c = kept; }',
    'one-way-round-brings-a-fraction': 'for (let t = 0; t < turns; t++) { a = t & 1 ? a | 1 : a / 2; b = a; c = b; }',
    'one-way-round-is-a-continue': 'for (let t = 0; t < turns; t++) { if (t & 1) { a = a ^ 5; continue; } a = a | 2; b = a & c; c = ~b; }',
    'a-shift-without-a-sign-comes-round': 'for (let t = 0; t < turns; t++) { a = a >>> 1; b = (a >>> 0) | 0; c = b; }',
    'a-sum-comes-round': 'for (let t = 0; t < turns; t++) { a = a + 1; b = (a + b) | 0; c = b; }',
    'the-loop-breaks-in-a-turn': 'for (let t = 0; t < turns; t++) { a = a | t; if (a & 4) break; b = a ^ c; c = b; }',
    'it-is-a-while-loop': 'let t = turns; while (t-- > 0) { a = (a << 1) | 1; b = a; c = b; }',
    'it-is-a-do-loop': 'let t = 0; do { a = a ^ t; b = a; c = b; } while (++t < turns);',
    'a-loop-stands-inside': 'for (let t = 0; t < turns; t++) { for (let u = 0; u < 3; u++) a = (a ^ u) | 0; b = a; c = b & t; }',
    'a-closure-takes-a-word': 'const made: (() => unknown)[] = []; for (let t = 0; t < turns; t++) { a = a | t; const kept = a; made.push(() => kept); b = a; c = b; } c = made.map(each => show(each())).join("");',
    'a-handler-stands-in-the-turn': 'for (let t = 0; t < turns; t++) { try { a = a | t; b = a & c; } catch (error) { b = -1; } c = ~b; }',
    'a-call-that-nobody-knows-stands-in-the-turn': 'for (let t = 0; t < turns; t++) { a = a | t; hook(a); b = a; c = b; }',
    'a-word-is-stored-into-a-view-in-the-turn': 'for (let t = 0; t < turns; t++) { a = (a << 3) ^ t; view[t & 3] = a; b = view[(t + 1) & 3]! | 0; c = b; }',
}
for how, loop in SHAPES.items():
    program(f'three-words-{how}', 'Whichever build of the loop runs.', f'''
const hook = hidden<(x: unknown) => void>(() => {{}});
const view = new Int32Array(4);
function mix(from: any[], turns: number): string {{
  let a = from[0], b = from[1], c = from[2];
  {loop}
  return [a, b, c].map(show).join(" ");
}}
const all = hidden<any[][]>([[1, -2, 3], [undefined, 2, 3], [1.5, "4", null], [2147483648, -0, NaN], [1n, 2n, 3n], [1, 2n, 3]]);
for (const turns of [0, 1, 2, 5]) console.log(turns, all.map(each => attempt(() => mix(each, turns))).join(" | "));
''')
program('the-words-come-out-of-a-view-that-is-too-short', 'A read past the end gives undefined, which the operators take for 0 and the sum for no number.', '''
function mix(sums: Int32Array, words: Int32Array, turns: number): string {
  let a = sums[0]!, b = sums[1]!, c = sums[2]!, d = sums[3]!, e = sums[4]!;
  for (let t = 0; t < turns; t++) {
    const next = (((a << 5) | (a >>> 27)) + (b ^ c ^ d) + e + words[t]!) | 0;
    e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = next;
  }
  return [a, b, c, d, e].map(show).join(" ");
}
for (const length of [5, 4, 1, 0]) for (const turns of [0, 1, 3, 6]) console.log(length, turns, mix(hidden(new Int32Array(length).fill(7)), hidden(new Int32Array([1, 2, 3, 4])), turns));
''')
print(count, 'programs')
