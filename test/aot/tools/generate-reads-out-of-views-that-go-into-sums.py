#!/usr/bin/env python3
# generate-reads-out-of-views-that-go-into-sums.py <folder>: all 56; ../parallel/reads-out-of-views-that-go-into-sums/ holds 21 of them: of each kind of view, of each way to leave the loop and of each refusal one, most of them red under a fault laid into the compiler on purpose.
# A turn of a loop reads an element out of a view and adds it to a number. Past the end of the view the read gives undefined and the sum is no number.
# A compiler may hold the position below the length and leave its fast build of the loop where it is not. Each program reads inside the view, and then past its end: in the first turn, in the last, in every one.
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
HEAD = '''const show = (value: any): string => (Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : String(value));
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

VIEWS = {
    'int32': ('Int32Array', 'new Int32Array([1, -2, 3, 4])'),
    'uint8': ('Uint8Array', 'new Uint8Array([1, 200, 3, 4])'),
    'uint32': ('Uint32Array', 'new Uint32Array([1, 4294967295, 3, 4])'),
    'float64': ('Float64Array', 'new Float64Array([1.5, -0, NaN, 4])'),
    'float32': ('Float32Array', 'new Float32Array([1.5, 2, 3.25, 4])'),
    'bigint64': ('BigInt64Array', 'new BigInt64Array([1n, 2n, 3n, 4n])'),
}
SUMS = {
    'is-added-to-a-sum-of-integers': 'let s = 0; for (let i = 0; i < view.length + over; i++) s = (s + i + view[i]!) | 0; return s;',
    'is-added-to-a-number': 'let s = 0.5; for (let i = 0; i < view.length + over; i++) s = s + view[i]!; return s;',
    'is-taken-from-a-number': 'let s = 100; for (let i = 0; i < view.length + over; i++) s = s - view[i]!; return s;',
    'is-multiplied-with-a-number': 'let s = 1; for (let i = 0; i < view.length + over; i++) s = (i + 1) * view[i]! + s; return s;',
}
for kind, (written, made) in VIEWS.items():
    for how, body in SUMS.items():
        program(f'an-element-of-a-view-of-{kind}-{how}', 'The turns end inside the view, at its end, one past it and far past it.', f'''
function work(view: {written}, over: number): unknown {{ {body} }}
const view = hidden<{written}>({made});
const none = hidden<{written}>(new {written}(0));
for (const over of [0, -1, 1, 5, -9]) console.log(over, attempt(() => work(view, over)), attempt(() => work(none, over)));
''')

TURNS = {
    'the-first-turn-reads-in-front-of-the-view': 'let s = 0; for (let i = 0; i < view.length; i++) s = (s + view[i - 1]! + view[i]!) | 0; return s;',
    'the-last-turn-reads-past-the-end': 'let s = 0; for (let i = 0; i < view.length; i++) s = (s + view[i + 1]! + view[i]!) | 0; return s;',
    'every-turn-reads-past-the-end': 'let s = 0; for (let i = 0; i < view.length; i++) s = (s + view[i + view.length]!) | 0; return s;',
    'undefined-is-asked-for-in-the-turn': 'let s = 0; for (let i = 0; i <= view.length; i++) { const word = view[i]; s = word === undefined ? s - 1 : (s + word) | 0; } return s;',
    'what-is-missing-is-taken-for-zero': 'let s = 0; for (let i = 0; i <= view.length; i++) s = (s + (view[i] ?? 0)) | 0; return s;',
    'the-element-is-used-twice': 'let s = 0, last: unknown; for (let i = 0; i <= view.length; i++) { const word = view[i]!; s = (s + word) | 0; last = word; } return s + ":" + show(last);',
    'a-store-stands-in-front-of-the-read': 'let s = 0; for (let i = 0; i <= view.length; i++) { marks[i & 3] = i; s = (s + view[i]!) | 0; } return s + ":" + marks.join();',
    'a-store-stands-behind-the-read': 'let s = 0; for (let i = 0; i <= view.length; i++) { s = (s + view[i]!) | 0; marks[i & 3] = s; } return s + ":" + marks.join();',
    'a-store-stands-between-two-reads': 'let s = 0; for (let i = 0; i < view.length; i++) { s = (s + view[i]!) | 0; marks[i & 3] += 1; s = (s + view[i + 2]!) | 0; } return s + ":" + marks.join();',
    'a-count-outside-goes-up-in-front-of-the-read': 'let s = 0; for (let i = 0; i <= view.length; i++) { turns++; s = (s + view[i]!) | 0; } return s + ":" + turns;',
    'a-call-that-nobody-knows-stands-in-front-of-the-read': 'let s = 0; for (let i = 0; i <= view.length; i++) { hook(i); s = (s + view[i]!) | 0; } return s;',
    'the-position-is-a-fraction-in-one-turn': 'let s = 0; for (let i = 0; i < view.length; i += 0.5) s = s + view[i]!; return s;',
    'the-position-steps-down-below-zero': 'let s = 0; for (let i = view.length; i >= -2; i--) s = s + view[i]!; return s;',
    'two-views-of-two-lengths-are-read': 'let s = 0; for (let i = 0; i < view.length; i++) s = (s + view[i]! + short[i]!) | 0; return s;',
    'the-loop-is-a-while-loop': 'let s = 0, i = 0; while (i < view.length + 2) { s = (s + view[i]!) | 0; i++; } return s;',
    'the-loop-is-a-do-loop': 'let s = 0, i = 0; do { s = (s + view[i]!) | 0; i++; } while (i <= view.length); return s;',
    'the-sum-is-read-behind-a-break': 'let s = 0; for (let i = 0; i < view.length + 5; i++) { s = s + view[i]!; if (s !== s) break; } return s;',
    'the-sum-is-thrown-where-it-is-no-number': 'let s = 0; for (let i = 0; i < view.length + 5; i++) { s = s + view[i]!; if (s !== s) throw new RangeError("at " + i); } return s;',
    'a-loop-inside-reads-past-the-end': 'let s = 0; for (let i = 0; i < view.length; i++) for (let j = 0; j <= view.length; j++) s = (s + view[j]! + i) | 0; return s;',
}
for how, body in TURNS.items():
    program(f'in-a-loop-over-a-view-{how}', 'Whichever build of the loop runs, and wherever it is left.', f'''
const hook = hidden<(i: number) => void>(() => {{}});
const marks = new Int32Array(4);
let turns = 0;
const short = hidden<Int32Array>(new Int32Array([10, 20]));
function work(view: Int32Array): unknown {{ {body} }}
for (const made of [[1, -2, 3, 4], [7], [], [5, 6, 7, 8, 9, 10]]) console.log(attempt(() => work(hidden(new Int32Array(made)))));
''')

WORDS = {
    'two-words-go-round': 'for (let i = 0; i < to; i++) { const next = (a + view[i]!) | 0; a = b; b = next; } return a + ":" + b;',
    'a-word-is-turned-and-added': 'for (let i = 0; i < to; i++) { a = (((a << 5) | (a >>> 27)) + view[i]! + b) | 0; b = a ^ i; } return a + ":" + b;',
    'the-position-is-masked': 'for (let i = 0; i < to; i++) { a = (a + view[i & 7]!) | 0; b = (b ^ a) | 0; } return a + ":" + b;',
    'two-positions-are-read': 'for (let i = 0; i < to; i++) { a = (a + view[i]! + view[i + 3]!) | 0; b = (b + a) | 0; } return a + ":" + b;',
}
for how, body in WORDS.items():
    program(f'words-come-round-beside-a-read-and-{how}', 'The words are asked for in front of the loop, so there is a second build of it to leave for.', f'''
function work(view: Int32Array, a: number, b: number, to: number): unknown {{ {body} }}
const view = hidden<Int32Array>(new Int32Array([1, -2, 3, 4]));
for (const to of [0, 1, 4, 5, 12]) console.log(to, attempt(() => work(view, hidden(7), hidden(-9), to)), attempt(() => work(view, hidden(0.5), hidden(2 ** 40), to)));
''')

TABLES = {
    'a-sum-of-integers': 'let s = 0; for (let i = 0; i < to; i++) s = (s + table[i]!) | 0; return s;',
    'a-number': 'let s = 0.25; for (let i = 0; i < to; i++) s = s + table[i]!; return s;',
    'a-product': 'let s = 1; for (let i = 0; i < to; i++) s = s * table[i]!; return s;',
}
for how, body in TABLES.items():
    program(f'a-table-of-the-file-is-read-into-{how}', 'Nobody has written what the table is: it is what a call gave.', f'''
const table = Int32Array.from([3, 1, -4, 1, 5]);
function work(to: number): unknown {{ {body} }}
for (const to of [0, 3, 5, 6, 40]) console.log(to, attempt(() => work(hidden(to))));
''')

DEEDS = {
    'the-buffer-was-handed-away': 'const view = new Int32Array([1, 2, 3, 4]); view.buffer.transfer(); return view;',
    'the-view-follows-a-buffer-that-has-shrunk': 'const buffer = new ArrayBuffer(16, { maxByteLength: 32 }); const view = new Int32Array(buffer); view.set([1, 2, 3, 4]); buffer.resize(8); return view;',
    'the-view-follows-a-buffer-that-has-grown': 'const buffer = new ArrayBuffer(8, { maxByteLength: 32 }); const view = new Int32Array(buffer); view.set([1, 2]); buffer.resize(24); return view;',
    'the-view-is-of-a-subclass-with-elements-of-its-own': 'return new (class extends Int32Array { get 9() { return 90; } })([1, 2, 3, 4]);',
    'the-view-is-of-a-subclass-whose-length-lies': 'return new (class extends Int32Array { get length() { return 2; } })([1, 2, 3, 4]);',
    'the-view-begins-in-the-middle-of-its-buffer': 'return new Int32Array(new Int32Array([9, 9, 1, 2, 3, 9, 9, 9]).buffer, 8, 3);',
}
for what, made in DEEDS.items():
    program(f'the-sum-runs-past-the-end-where-{what}', 'A position outside a view finds nothing, whatever lies behind the view in memory.', f'''
function work(view: Int32Array, over: number): unknown {{ let s = 0; for (let i = 0; i < view.length + over; i++) s = s + view[i]!; return s; }}
const view = hidden<Int32Array>((() => {{ {made} }})());
for (const over of [0, -1, 1, 2, 10]) console.log(over, attempt(() => work(view, over)));
''')
print(count, 'programs')
