#!/usr/bin/env python3
# generate-keys-that-come-out-of-views.py <folder>: all 45; ../parallel/keys-that-come-out-of-views/ holds 23 of them: those that a fault laid into the compiler on purpose has turned red, and of each refusal one.
# A turn of a loop reads a key out of one view and reads or writes another under it. Past the end of the first view the key is undefined, which names a property.
# A compiler may ask the key for a number and leave its fast build of the loop where it is none. Each program runs with keys that are numbers, and then with a key that is undefined, negative, a fraction or too large.
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

KEYS = {
    'int32': ('Int32Array', 'new Int32Array([0, 2, 1, 3, 2])'),
    'int32-some-negative': ('Int32Array', 'new Int32Array([0, -1, 1, -2147483648, 2])'),
    'int32-some-too-large': ('Int32Array', 'new Int32Array([0, 4, 1, 2147483647, 2])'),
    'uint8': ('Uint8Array', 'new Uint8Array([0, 2, 255, 3, 1])'),
    'uint32': ('Uint32Array', 'new Uint32Array([0, 4294967295, 1, 3, 2])'),
    'float64': ('Float64Array', 'new Float64Array([0, 1.5, NaN, -0, 3])'),
}
USES = {
    'a-sum-reads-under-them': 'let s = 0; for (let i = 0; i < keys.length + over; i++) s = (s + words[keys[i]!]!) | 0; return s;',
    'a-shift-reads-under-them': 'let s = 0; for (let i = 0; i < keys.length + over; i++) s = (s ^ (words[keys[i]!]! >>> keys[i + 1]!)) | 0; return s;',
    'a-store-writes-under-them': 'for (let i = 0; i < keys.length + over; i++) words[keys[i]!] = i + 10; return words.join() + ":" + show((words as any).undefined);',
    'what-is-read-is-kept-as-it-is': 'let last: unknown = "none"; for (let i = 0; i < keys.length + over; i++) last = words[keys[i]!]; return last;',
}
for kind, (written, made) in KEYS.items():
    for how, body in USES.items():
        program(f'keys-out-of-a-view-of-{kind}-and-{how}', 'The turns end inside the view of keys, at its end, one past it and three past it.', f'''
function work(words: Int32Array, keys: {written}, over: number): unknown {{ {body} }}
const keys = hidden<{written}>({made});
for (const over of [0, -1, 1, 3]) console.log(over, attempt(() => work(hidden(new Int32Array([5, -6, 7, 8])), keys, over)));
''')

UNDER = {
    'the-view-has-a-property-of-that-name': 'const view = new Int32Array([5, -6, 7, 8]); (view as any).undefined = 70; return view;',
    'a-subclass-has-a-getter-of-that-name': 'return new (class extends Int32Array { get undefined() { asked++; return 90; } })([5, -6, 7, 8]);',
    'a-prototype-laid-under-the-view-has-it': 'const view = new Int32Array([5, -6, 7, 8]); Object.setPrototypeOf(view, Object.create(Int32Array.prototype, { undefined: { value: 30 } })); return view;',
    'what-is-handed-in-is-a-plain-object': 'return { 0: 5, 1: -6, 2: 7, 3: 8, undefined: 40 };',
    'what-is-handed-in-is-a-list': 'const list: any = [5, -6, 7, 8]; list.undefined = 50; return list;',
    'what-is-handed-in-answers-every-name': 'return new Proxy({}, { get: (_, name) => { asked++; return String(name).length; } });',
}
for what, made in UNDER.items():
    program(f'the-key-is-undefined-where-{what}', 'undefined is a name like another: what lies under it is found, and what runs at the read runs once.', f'''
let asked = 0;
function work(words: Int32Array, keys: Int32Array, over: number): unknown {{ let s = 0; for (let i = 0; i < keys.length + over; i++) s = (s + words[keys[i]!]!) | 0; return s + ":" + asked; }}
const words = hidden<Int32Array>((() => {{ {made} }})());
const keys = hidden<Int32Array>(new Int32Array([0, 2, 1, 3]));
for (const over of [0, 1, 2]) console.log(over, attempt(() => work(words, keys, over)));
''')

TURNS = {
    'a-store-stands-in-front-of-the-key': 'let s = 0; for (let i = 0; i <= keys.length; i++) { marks[i & 3] += 1; s = (s + words[keys[i]!]!) | 0; } return s + ":" + marks.join();',
    'a-store-stands-between-the-key-and-the-read': 'let s = 0; for (let i = 0; i <= keys.length; i++) { const key = keys[i]!; marks[i & 3] += 1; s = (s + words[key]!) | 0; } return s + ":" + marks.join();',
    'a-count-outside-goes-up-in-front-of-the-key': 'let s = 0; for (let i = 0; i <= keys.length; i++) { turns++; s = (s + words[keys[i]!]!) | 0; } return s + ":" + turns;',
    'a-call-that-nobody-knows-stands-in-front-of-the-key': 'let s = 0; for (let i = 0; i <= keys.length; i++) { hook(i); s = (s + words[keys[i]!]!) | 0; } return s;',
    'the-key-is-used-twice': 'let s = 0; for (let i = 0; i <= keys.length; i++) { const key = keys[i]!; s = (s + words[key]! + marks[key]!) | 0; } return s;',
    'the-key-is-a-key-of-a-key': 'let s = 0; for (let i = 0; i <= keys.length; i++) s = (s + words[keys[keys[i]!]!]!) | 0; return s;',
    'the-key-is-asked-for-undefined': 'let s = 0; for (let i = 0; i <= keys.length; i++) { const key = keys[i]; s = key === undefined ? s - 1 : (s + words[key]!) | 0; } return s;',
    'the-loop-ends-early-on-what-it-read': 'let s = -1; for (let i = 0; i < keys.length + 2 && s !== 0; i++) s &= ~(words[keys[i]!]! & 5); return s;',
    'the-loop-is-a-while-loop': 'let s = 0, i = 0; while (i <= keys.length) { s = (s + words[keys[i]!]!) | 0; i++; } return s;',
    'a-loop-inside-reads-the-keys': 'let s = 0; for (let j = 0; j < 3; j++) for (let i = 0; i <= keys.length; i++) s = (s + words[keys[i]!]! + j) | 0; return s;',
}
for how, body in TURNS.items():
    program(f'in-a-loop-over-keys-{how}', 'Whichever build of the loop runs, and wherever it is left.', f'''
const hook = hidden<(i: number) => void>(() => {{}});
const marks = new Int32Array(4);
let turns = 0;
function work(words: Int32Array, keys: Int32Array): unknown {{ {body} }}
for (const made of [[0, 2, 1, 3], [1], [], [3, 3, 0, 9, -1, 2]]) console.log(attempt(() => work(hidden(new Int32Array([5, -6, 7, 8])), hidden(new Int32Array(made)))));
''')

TABLES = {
    'five-keys-a-row-pick-bits-of-words': '''let mask = -1;
  for (let row = 0, at = 0; at < packed.length && mask !== 0; row += 1, at += 5) {
    const isBroken = (((words[packed[at]!]! >>> packed[at + 1]!) ^ (words[packed[at + 2]!]! >>> packed[at + 3]!)) & 1) ^ packed[at + 4]!;
    mask &= ~(MASKS[row]! & -isBroken);
  }
  return mask;''',
    'the-rows-are-cut-short': '''let mask = -1;
  for (let row = 0, at = 0; at < packed.length - 3 && mask !== 0; row += 1, at += 4) {
    const isBroken = ((words[packed[at]!]! >>> packed[at + 1]!) & 1) ^ packed[at + 7]!;
    mask &= ~(MASKS[row]! & -isBroken);
  }
  return mask;''',
}
for how, body in TABLES.items():
    program(f'tables-of-the-file-hold-the-keys-and-{how}', 'Nobody has written what the tables are: they are what a call gave.', f'''
const ROWS = Array.from({{ length: 12 }}, (_, k) => ({{ i: k % 8, a: k % 31, j: (k * 7) % 8, b: (k * 3) % 31, c: k & 1 }}));
const MASKS = Int32Array.from(ROWS.map((_, k) => (k % 5 === 0 ? 1 << (k % 31) : 0)));
const PACKED = Int32Array.from(ROWS.flatMap(({{ i, a, j, b, c }}) => [i, a, j, b, c]));
function work(words: Int32Array): unknown {{
  const packed = PACKED;
  {body}
}}
for (const made of [[1, 2, 3, 4, 5, 6, 7, 8], [-1, -1, -1, -1, -1, -1, -1, -1], [9, 8], []]) console.log(attempt(() => work(hidden(new Int32Array(made)))));
''')

LISTS = {
    'a-list-of-numbers': '[0, 2, 1, 3]',
    'a-list-with-a-hole': '[0, , 1, 3]',
    'a-list-with-a-text-in-it': '[0, "2", 1, "length"]',
}
for what, made in LISTS.items():
    program(f'the-keys-come-out-of-{what}', 'A list gives undefined at a hole and past its end, and whatever else was put into it.', f'''
function work(words: Int32Array, keys: number[], over: number): unknown {{ let s = 0; for (let i = 0; i < keys.length + over; i++) s = (s + words[keys[i]!]!) | 0; return s; }}
const keys = hidden<number[]>({made});
for (const over of [0, 1, 2]) console.log(over, attempt(() => work(hidden(new Int32Array([5, -6, 7, 8])), keys, over)));
''')
print(count, 'programs')
