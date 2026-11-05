#!/usr/bin/env python3
# generate-positions-and-lengths-of-views-in-loops.py <folder>: all 92; ../parallel/positions-and-lengths-of-views-in-loops/ holds 24 of them: those that a fault laid into the compiler on purpose has turned red.
# Loops that read and write typed arrays, one shape a program, each held to `bun <file>`.
# A compiler reads the length and the memory of a view once where it can, takes a position for an integer, and takes what a view gives for a number.
# Each program hands its one loop what makes that wrong: a position behind the end, below zero, with a fraction, NaN, a text; what a view gives behind its end used as a position of another view,
# with something lying under the name "undefined"; a buffer that is detached, resized or grown in a turn; a subclass, a length of the object's own; a view that is replaced or written in a turn.
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)

SHOW = '''const show = (value: any): string =>
  Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : String(value);
'''
SHOW_JS = SHOW.replace('(value: any): string', 'value')

programs = {}
def program(name, says, text, extension='ts'):
    assert name not in programs, name
    head = SHOW if extension == 'ts' else SHOW_JS
    programs[name] = (extension, '// ' + says + '\n' + head + text.strip('\n') + '\n')

NUMBERS = ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array']
BIG = ['BigInt64Array', 'BigUint64Array']
def lower(kind): return ''.join(('-' + c.lower()) if c.isupper() and i else c.lower() for i, c in enumerate(kind)).replace('-array', '').replace('big-int', 'bigint').replace('big-uint', 'biguint')

POSITIONS = {
    'Int8Array': '0, 3, 4, -1, 1, 127, -128, 2', 'Uint8Array': '0, 3, 4, 255, 1, 2', 'Uint8ClampedArray': '0, 3, 4, 255, 1, 2', 'Int16Array': '0, 3, 4, -1, 1, 32767, -32768, 2',
    'Uint16Array': '0, 3, 4, 65535, 1, 2', 'Int32Array': '0, 3, 4, -1, 1, 2147483647, -2147483648, 2', 'Uint32Array': '0, 3, 4, 4294967295, 1, 2147483648, 2',
    'Float32Array': '0, 3, 4, -1, 0.5, NaN, -0, Infinity, -Infinity, 1e30, 4294967296, 2', 'Float64Array': '0, 3, 4, -1, 0.5, NaN, -0, Infinity, -Infinity, 1e300, 4294967296, 9007199254740992, 2.0000000001, 2',
}

# ---- what one view gives is a position of another

def gather(outer, inner):
    elements = '10n, 20n, 30n, 40n' if outer in BIG else '10, 20, 30, 40'
    return f'''
function list(outer: {outer}, inner: {inner}, turns: number): string {{
  const found: string[] = [];
  for (let at = 0; at < turns; at++) found.push(show(outer[inner[at]!]));
  return found.join(" ");
}}
function count(outer: {outer}, inner: {inner}, turns: number): number {{
  let absent = 0;
  for (let at = 0; at < turns; at++) if (outer[inner[at]!] === undefined) absent++;
  return absent;
}}
const outer = {outer}.from([{elements}]);
const inner = {inner}.from([{POSITIONS[inner]}]);
for (let round = 0; round < 3; round++) console.log(list(outer, inner, inner.length + 2), count(outer, inner, inner.length + 2));
'''
for kind in NUMBERS + BIG:
    program(f'a-position-out-of-a-view-of-int32-in-a-view-of-{lower(kind)}', f'`outer[inner[at]]`, outer a {kind}. The loop goes two turns past the end of `inner`, where the position is undefined.', gather(kind, 'Int32Array'))
for kind in NUMBERS:
    if kind != 'Int32Array':
        program(f'a-position-out-of-a-view-of-{lower(kind)}-in-a-view-of-int32', f'`outer[inner[at]]`, inner a {kind}.', gather('Int32Array', kind))

SUM = '''
function sum(words: Int32Array, table: Int32Array, turns: number): number {
  let total = 0;
  for (let at = 0; at < turns; at++) total = (Math.imul(total, 31) + (words[table[at]!]! >>> 1)) | 0;
  return total;
}
'''
UNDER_UNDEFINED = [
    ('nothing', 'Nothing lies under the name.', ''),
    ('a-property-of-the-view', 'The view has a property of that name.', '(words as any).undefined = 77;'),
    ('a-property-of-an-object-laid-above-the-view', 'An object between the view and the prototype of its class has one.', 'Object.setPrototypeOf(words, Object.create(Int32Array.prototype, { undefined: { value: 78 } }));'),
    ('a-getter-that-counts', 'A getter above counts how often it is asked.', 'let asked = 0;\nObject.setPrototypeOf(words, Object.create(Int32Array.prototype, { undefined: { get() { return ++asked * 2; } } }));'),
    ('an-object-that-converts-by-code', 'What lies there is an object whose valueOf counts.', 'let converted = 0;\n(words as any).undefined = { valueOf() { return ++converted * 4; } };'),
    ('a-text', 'What lies there is a text that reads as a number.', '(words as any).undefined = "300";'),
]
for name, says, setup in UNDER_UNDEFINED:
    tail = 'console.log(asked);' if 'asked' in setup else 'console.log(converted);' if 'converted' in setup else ''
    program(f'under-the-name-undefined-lies-{name}', f'`words[table[at]] >>> 1` past the end of `table`: the read goes by the name "undefined". {says}', SUM + f'''
const words = new Int32Array([10, 20, 30, 40]);
const table = new Int32Array([0, 3, 1]);
console.log(sum(words, table, 3), sum(words, table, 5));
{setup}
for (let round = 0; round < 3; round++) console.log(sum(words, table, 3), sum(words, table, 5), sum(words, table, 9));
{tail}
''')
program('under-the-name-undefined-lies-a-member-of-a-subclass', 'The class below Int32Array declares it.', SUM + '''
class Words extends Int32Array {
  get undefined() { return 90; }
}
const plain = new Int32Array([10, 20, 30, 40]);
const words = new Words([10, 20, 30, 40]);
const table = new Int32Array([0, 3, 1]);
for (let round = 0; round < 3; round++) console.log(sum(plain, table, 5), sum(words, table, 3), sum(words, table, 5));
''')
program('the-name-undefined-is-laid-in-the-middle-of-the-loop', 'A turn lays the property that later turns find.', '''
function sum(words: Int32Array, table: Int32Array, turns: number, lay: (at: number) => void): number {
  let total = 0;
  for (let at = 0; at < turns; at++) {
    lay(at);
    total = (Math.imul(total, 31) + (words[table[at]!]! >>> 1)) | 0;
  }
  return total;
}
const words = new Int32Array([10, 20, 30, 40]);
const table = new Int32Array([0, 3, 1]);
console.log(sum(words, table, 8, () => {}));
console.log(sum(words, table, 8, at => { if (at === 5) (words as any).undefined = 1000; }));
console.log(sum(words, table, 8, () => {}));
''')

# ---- something was done in the turn in front of the read that finds no position

DONE_FIRST = [
    ('a-variable-of-the-module-was-stepped', 'let steps = 0;', 'steps++;', 'steps'),
    ('another-view-was-written', 'const marks = new Uint8Array(16);', 'marks[at]!++;', 'marks.join("")'),
    ('the-same-view-was-written', '', 'words[0]!++;', 'words.join(" ")'),
    ('a-list-was-appended-to', 'const seen: number[] = [];', 'seen.push(at);', 'seen.join("")'),
    ('a-field-was-stored', 'const state = { turns: 0 };', 'state.turns += 1;', 'state.turns'),
    ('a-function-that-nobody-knows-was-called', 'let calls = 0;\nconst hooks = [() => { calls++; }, () => { calls += 10; }];', 'hooks[at & 1]!();', 'calls'),
]
for name, declared, deed, result in DONE_FIRST:
    program(f'in-front-of-the-position-that-is-undefined-{name}', 'What a turn has done in front of the read is done once.', f'''
{declared}
function sum(words: Int32Array, table: Int32Array, turns: number): number {{
  let total = 0;
  for (let at = 0; at < turns; at++) {{
    {deed}
    total = (Math.imul(total, 31) + (words[table[at]!]! >>> 1)) | 0;
  }}
  return total;
}}
const words = new Int32Array([10, 20, 30, 40]);
(words as any).undefined = 2000;
const table = new Int32Array([0, 3, 1]);
for (let round = 0; round < 3; round++) console.log(sum(words, table, 3), sum(words, table, 6), {result});
''')

# ---- stores

program('a-store-under-a-position-out-of-a-view', '`outer[inner[at]] = at`: past the end of `inner` the store lays a property named "undefined".', '''
function fill(outer: Int32Array, inner: Int32Array, turns: number): void {
  for (let at = 0; at < turns; at++) outer[inner[at]!] = at + 1;
}
const outer = new Int32Array(4);
const inner = Int32Array.from([2, 0, 9, -1, 3]);
fill(outer, inner, 5);
console.log(outer.join(" "), show((outer as any).undefined), Object.keys(outer).join(","));
fill(outer, inner, 8);
console.log(outer.join(" "), show((outer as any).undefined), Object.keys(outer).join(","));
''')
program('a-store-under-a-position-out-of-a-view-that-takes-no-new-property', 'The view is not extensible: in strict code the store under "undefined" throws, in the middle of the loop.', '''
function fill(outer: Int32Array, inner: Int32Array, turns: number): string {
  let at = 0;
  try {
    for (; at < turns; at++) outer[inner[at]!] = at + 1;
  } catch (error) {
    return at + " " + (error as Error).name;
  }
  return at + " done";
}
const outer = new Int32Array(4);
const inner = Int32Array.from([2, 0, 9, -1, 3]);
Object.preventExtensions(outer);
console.log(fill(outer, inner, 5), outer.join(" "));
console.log(fill(outer, inner, 8), outer.join(" "));
''')
for kind in ['Uint8ClampedArray', 'Float32Array', 'Uint32Array', 'Int16Array']:
    program(f'stores-of-every-number-into-a-view-of-{lower(kind)}', f'What a {kind} makes of what is stored, at positions inside and outside.', f'''
function fill(view: {kind}, values: Float64Array, from: number): void {{
  for (let at = 0; at < values.length; at++) view[from + at] = values[at]!;
}}
const values = Float64Array.from([0, -0, 1.5, 2.5, -1.5, 255.5, 256, -129, 65536.75, 4294967297, -4294967297, NaN, Infinity, -Infinity, 1e300]);
for (const from of [0, -2, 3, 12]) {{
  const view = new {kind}(16);
  fill(view, values, from);
  console.log(Array.from(view, show).join(" "));
}}
''')

# ---- the memory of a view changes in a turn

WALK = '''
function walk(view: KIND, turns: number, change: (at: number) => void): string {
  const found: string[] = [];
  for (let at = 0; at < turns; at++) {
    change(at);
    found.push(show(view[at]) + "/" + show(view[at + 1]) + "/" + view.length);
  }
  return found.join(" ");
}
'''
CHANGES = [
    ('the-buffer-is-detached', 'const buffer = new ArrayBuffer(24);\nconst view = new Int32Array(buffer);', 'if (at === 2) buffer.transfer();'),
    ('a-buffer-under-a-view-of-a-fixed-length-shrinks-and-grows', 'const buffer = new ArrayBuffer(24, { maxByteLength: 64 });\nconst view = new Int32Array(buffer, 0, 6);', 'if (at === 2) buffer.resize(8);\n  if (at === 4) buffer.resize(40);'),
    ('a-buffer-under-a-view-that-follows-it-grows', 'const buffer = new ArrayBuffer(8, { maxByteLength: 64 });\nconst view = new Int32Array(buffer);', 'if (at === 1) buffer.resize(16);\n  if (at === 3) buffer.resize(32);'),
    ('a-buffer-under-a-view-that-follows-it-shrinks', 'const buffer = new ArrayBuffer(32, { maxByteLength: 64 });\nconst view = new Int32Array(buffer);', 'if (at === 2) buffer.resize(12);\n  if (at === 4) buffer.resize(0);'),
    ('a-view-that-follows-its-buffer-from-an-offset', 'const buffer = new ArrayBuffer(32, { maxByteLength: 64 });\nconst view = new Int32Array(buffer, 8);', 'if (at === 2) buffer.resize(4);\n  if (at === 4) buffer.resize(48);'),
    ('shared-memory-under-a-view-that-follows-it-grows', 'const buffer = new SharedArrayBuffer(8, { maxByteLength: 64 });\nconst view = new Int32Array(buffer);', 'if (at === 1) buffer.grow(16);\n  if (at === 3) buffer.grow(32);'),
    ('shared-memory-under-a-view-of-a-fixed-length-grows', 'const buffer = new SharedArrayBuffer(16, { maxByteLength: 64 });\nconst view = new Int32Array(buffer, 0, 3);', 'if (at === 1) buffer.grow(32);'),
    ('the-buffer-of-a-small-view-is-asked-for', 'const view = new Int32Array(6);\nlet other: Int32Array | undefined;', 'if (at === 2) other = new Int32Array(view.buffer);\n  if (other) other[at + 1] = 1000 + at;'),
]
for name, made, change in CHANGES:
    fill = 'for (let at = 0; at < view.length; at++) view[at] = 10 * (at + 1);'
    program(f'in-a-turn-{name}', 'Reads and the length behind the change see it.', WALK.replace('KIND', 'Int32Array') + f'''
{made}
{fill}
console.log(walk(view, 7, () => {{}}));
console.log(walk(view, 7, at => {{
  {change}
}}));
console.log(walk(view, 7, () => {{}}));
''')
    program(f'in-a-turn-written-in-the-loop-{name}', 'The same with the change written in the loop itself.', f'''
{made}
{fill}
const found: string[] = [];
for (let at = 0; at < 7; at++) {{
  {change}
  found.push(show(view[at]) + "/" + show(view[at + 1]) + "/" + view.length);
}}
console.log(found.join(" "));
''')
program('in-a-turn-the-memory-of-a-webassembly-module-grows', 'The buffer that the memory has handed out is detached: the view holds nothing from then on. No code but the engine\'s own runs between the two reads.', '''
function sum(view: Int32Array, memory: WebAssembly.Memory, turns: number, when: number): number {
  let total = 0;
  for (let at = 0; at < turns; at++) {
    total = (Math.imul(total, 31) + view[at]!) | 0;
    if (at === when) memory.grow(1);
    total = (Math.imul(total, 31) + view[at + 1]! + view.length) | 0;
  }
  return total;
}
function fill(view: Int32Array, memory: WebAssembly.Memory, turns: number, when: number): number {
  for (let at = 0; at < turns; at++) {
    view[at] = at + 1;
    if (at === when) memory.grow(1);
    view[at + 1] = -at;
  }
  return view.length;
}
for (const when of [9, 0, 2]) {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 });
  const view = new Int32Array(memory.buffer);
  for (let at = 0; at < 8; at++) view[at] = 3 * at + 1;
  console.log(sum(view, memory, 5, when), view.length, new Int32Array(memory.buffer).slice(0, 8).join(" "));
}
for (const when of [9, 0, 2]) {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 });
  console.log(fill(new Int32Array(memory.buffer), memory, 5, when), new Int32Array(memory.buffer).slice(0, 8).join(" "));
}
const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 });
const view = new Int32Array(memory.buffer);
for (let at = 0; at < 8; at++) view[at] = 3 * at + 1;
let total = 0;
for (let at = 0; at < 5; at++) {
  total = (Math.imul(total, 31) + view[at]!) | 0;
  if (at === 2) memory.grow(1);
  total = (Math.imul(total, 31) + view[at + 1]! + view.length) | 0;
}
console.log(total);
''')
program('in-a-turn-a-part-of-a-small-view-is-taken', 'subarray() and `buffer` give a small view other bytes. Stores behind them land where the part sees them.', '''
function fill(view: Int32Array, when: number): string {
  let part: Int32Array | undefined;
  for (let at = 0; at < 5; at++) {
    view[at] = at + 1;
    if (at === when) part = view.subarray(0, 6);
    view[at + 1] = -at - 1;
  }
  return view.join(" ") + " | " + (part ? part.join(" ") : "none");
}
function fillBesideBuffer(view: Int32Array, when: number): string {
  let bytes: ArrayBufferLike | undefined;
  for (let at = 0; at < 5; at++) {
    view[at] = at + 1;
    if (at === when) bytes = view.buffer;
    view[at + 1] = -at - 1;
  }
  return view.join(" ") + " | " + (bytes ? new Int32Array(bytes).join(" ") : "none");
}
for (const when of [9, 0, 2, 4]) console.log(fill(new Int32Array(6), when), "&", fillBesideBuffer(new Int32Array(6), when));
''')
program('the-length-was-read-in-front-of-the-change', '`const n = view.length` holds what it held. The reads ask the view as it is.', '''
function total(view: Int32Array, buffer: ArrayBuffer, bytes: number): string {
  const n = view.length;
  buffer.resize(bytes);
  let sum = 0, absent = 0;
  for (let at = 0; at < n; at++) {
    const element = view[at];
    if (element === undefined) absent++;
    else sum += element;
  }
  return n + " " + sum + " " + absent + " " + view.length;
}
for (const bytes of [24, 8, 0, 40]) {
  const buffer = new ArrayBuffer(24, { maxByteLength: 64 });
  const view = new Int32Array(buffer);
  view.fill(3);
  console.log(total(view, buffer, bytes));
}
''')
program('a-loop-waits-for-a-view-to-grow', 'Each turn asks anew whether there is an element, and a turn makes one.', '''
function wait(view: Int32Array, grow: (turn: number) => void): number {
  let turns = 0;
  while (view[4] === undefined) grow(++turns);
  return turns;
}
function waitForLength(view: Int32Array, grow: (turn: number) => void): number {
  let turns = 0;
  while (view.length < 5) grow(++turns);
  return turns;
}
for (const wanted of [wait, waitForLength]) {
  const buffer = new ArrayBuffer(8, { maxByteLength: 64 });
  console.log(wanted(new Int32Array(buffer), turn => { if (turn === 6) buffer.resize(24); }));
  const shared = new SharedArrayBuffer(8, { maxByteLength: 64 });
  console.log(wanted(new Int32Array(shared), turn => { if (turn === 9) shared.grow(24); }));
}
''')

# ---- subclasses, and a length of the object's own

LENGTHS = [
    ('a-subclass', 'class Words extends Int32Array {}', 'Words.from([1, 2, 3, 4])'),
    ('a-subclass-with-a-length-of-its-own', 'class Words extends Int32Array {\n  get length() { return 2; }\n}', 'new Words([1, 2, 3, 4])'),
    ('a-subclass-whose-length-counts', 'let asked = 0;\nclass Words extends Int32Array {\n  get length() { asked++; return 6; }\n}', 'new Words([1, 2, 3, 4])'),
    ('a-view-with-a-property-named-length', '', 'Object.defineProperty(Int32Array.from([1, 2, 3, 4]), "length", { value: 3 })'),
    ('a-view-whose-length-is-a-text', '', 'Object.defineProperty(Int32Array.from([1, 2, 3, 4]), "length", { value: "2" })'),
    ('a-view-below-another-prototype', '', 'Object.setPrototypeOf(Int32Array.from([1, 2, 3, 4]), { length: 5 })'),
    ('a-view-below-no-prototype', '', 'Object.setPrototypeOf(Int32Array.from([1, 2, 3, 4]), null)'),
]
for name, declared, made in LENGTHS:
    program(f'the-loop-is-handed-{name}', '`at < words.length` asks the object, and the reads ask the view.', f'''
{declared}
function total(words: Int32Array): string {{
  let sum = 0, turns = 0;
  for (let at = 0; at < words.length; at++) {{
    sum = (sum + (words[at]! | 0)) | 0;
    turns++;
  }}
  return sum + " " + turns;
}}
const plain = Int32Array.from([5, 6, 7]);
const other = {made} as Int32Array;
for (let round = 0; round < 3; round++) console.log(total(plain), total(other));
{'console.log(asked);' if 'asked' in declared else ''}
''')
# ---- the view is another in the next turn

program('the-view-is-replaced-in-a-turn', 'From the fourth turn on the variable holds a shorter view.', '''
function total(first: Int32Array, second: Int32Array): string {
  let words = first, absent = 0, sum = 0;
  for (let at = 0; at < 8; at++) {
    if (at === 3) words = second;
    const element = words[at];
    if (element === undefined) absent++;
    else sum += element;
  }
  return sum + " " + absent;
}
console.log(total(Int32Array.from([1, 2, 3, 4, 5, 6, 7, 8]), Int32Array.from([10, 20, 30, 40, 50])));
console.log(total(Int32Array.from([1, 2]), Int32Array.from([10, 20, 30, 40, 50, 60, 70, 80, 90])));
''')
program('two-views-take-turns', 'Of two lengths.', '''
function total(first: Int32Array, second: Int32Array): string {
  let absent = 0, sum = 0;
  for (let at = 0; at < 8; at++) {
    const words = at & 1 ? first : second;
    const element = words[at], next = words[at + 1];
    if (element === undefined) absent++;
    else sum += element;
    if (next === undefined) absent += 10;
    else sum += next;
  }
  return sum + " " + absent;
}
console.log(total(Int32Array.from([1, 2, 3, 4, 5, 6, 7, 8]), Int32Array.from([10, 20, 30, 40, 50])));
''')
program('views-of-two-classes-take-turns', 'What is declared is a union.', '''
function total(first: Int32Array | Float64Array, second: Int32Array | Float64Array): string {
  let text = "";
  for (let at = 0; at < 5; at++) {
    const words = at & 1 ? first : second;
    text += show(words[at]) + " ";
  }
  return text;
}
console.log(total(Int32Array.from([1, 2, 3, 4]), Float64Array.from([0.5, 1.5, -0, NaN, 4.5])));
console.log(total(Float64Array.from([0.5, 1.5, -0, NaN, 4.5]), Int32Array.from([1, 2, 3, 4])));
''')

# ---- shifts

program('shifts-without-a-sign-above-the-int32', '`>>>` gives up to 2 ** 32 - 1, and the sum of such is no int32.', '''
function total(words: Int32Array, counts: Int32Array): string {
  let sum = 0, mixed = 0;
  for (let at = 0; at < words.length + 2; at++) {
    sum += words[at]! >>> counts[at]!;
    mixed = (mixed ^ (words[at]! >>> counts[at]!)) >>> 0;
  }
  return sum + " " + mixed;
}
console.log(total(Int32Array.from([-1, -2147483648, 2147483647, -5, 7, -9]), Int32Array.from([0, 0, 0, 1, 31, 32])));
console.log(total(Int32Array.from([-1, -1, -1, -1, -1, -1]), Int32Array.from([-1, 33, 64, -32, 5])));
''')

# ---- the table is written in the loop, and two views share their bytes

program('the-table-is-written-in-the-loop', 'A turn writes the position that the next turn reads.', '''
function chase(words: Int32Array, table: Int32Array): string {
  const found: number[] = [];
  for (let at = 0; at + 1 < table.length; at++) {
    const element = words[table[at]!]! | 0;
    table[at + 1] = element;
    found.push(element);
  }
  return found.join(" ");
}
console.log(chase(Int32Array.from([3, 0, 9, 1]), new Int32Array(8)));
''')
program('one-view-is-table-and-words', 'The positions are read out of the view that they lead into, which the loop writes.', '''
function chase(words: Int32Array): string {
  let at = 0;
  const found: number[] = [];
  for (let turn = 0; turn < 8; turn++) {
    at = words[words[at]!]! | 0;
    words[at] = (words[at]! + 1) & 3;
    found.push(at);
  }
  return found.join(" ") + " | " + words.join(" ");
}
console.log(chase(Int32Array.from([1, 2, 3, 0])));
''')
program('two-views-share-their-bytes', 'What is written through the one is read through the other in the same turn.', '''
function mix(words: Int32Array, bytes: Uint8Array): number {
  let sum = 0;
  for (let at = 0; at < words.length; at++) {
    const before = words[at]!;
    bytes[at * 4 + 1] = at + 1;
    sum = (Math.imul(sum, 31) + before + words[at]!) | 0;
  }
  return sum;
}
const buffer = new ArrayBuffer(16);
console.log(mix(new Int32Array(buffer), new Uint8Array(buffer)), new Int32Array(buffer).join(" "));
''')

# ---- positions that are counted

STARTS = ['0', '-0', '-3', '0.5', '-0.5', 'NaN', 'Infinity', '-Infinity', '2 ** 31 - 2', '2 ** 32 - 2', '2 ** 53 - 2', '-(2 ** 31) - 2', '1e300', '3.0000000001']
def counted(step, offsets):
    reads = ' + " " + '.join(f'show(view[at{offset}])' for offset in offsets)
    return f'''
function walk(view: Int32Array, from: number): string {{
  const found: string[] = [];
  let turns = 0;
  for (let at = from; turns < 4; at += {step}, turns++) found.push({reads});
  return found.join(" | ");
}}
function sum(view: Int32Array, from: number): number {{
  let total = 0, turns = 0;
  for (let at = from; turns < 4; at += {step}, turns++) total = (Math.imul(total, 31) + ({' ^ '.join(f'view[at{offset}]!' for offset in offsets)})) | 0;
  return total;
}}
const view = Int32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
for (const from of [{', '.join(STARTS)}]) console.log(show(from), walk(view, from), sum(view, from));
'''
program('a-counter-steps-by-one', 'Whatever number it starts from.', counted('1', ['', ' + 1', ' - 1']))
program('a-counter-steps-by-three', 'And the reads lie beside it.', counted('3', ['', ' + 1', ' + 2']))
program('a-counter-steps-by-a-half', 'Every other turn it is no position.', counted('0.5', ['', ' + 0.5', ' + 1']))
program('a-counter-steps-down', 'Below zero nothing is found.', counted('-2', ['', ' + 4', ' - 4']))
program('what-is-added-to-a-counter-is-large', 'The sum leaves the int32, and the exact integers.', counted('1', [' + 2147483647', ' - 2147483648', ' + 4294967296', ' + 9007199254740992', ' - 4294967295']))
def whole(text): return text.replace('let at = from;', 'let at = Math.trunc(from);')
program('a-counter-without-a-fraction-steps-by-one', 'It starts from a number that was cut to a whole one: NaN, the infinities and -0 are among them.', whole(counted('1', ['', ' + 1', ' - 1'])))
program('a-counter-without-a-fraction-steps-by-three', 'And the reads lie beside it, on either side.', whole(counted('3', ['', ' + 2', ' - 2', ' + 5', ' - 7'])))
program('a-counter-without-a-fraction-steps-down', 'Below zero nothing is found.', whole(counted('-2', ['', ' + 4', ' - 4'])))
program('what-is-added-to-a-counter-without-a-fraction-is-large', 'The sum leaves the int32, and the exact integers.', whole(counted('1', [' + 2147483647', ' - 2147483647', ' + 2147483648', ' - 2147483648', ' + 4294967296', ' + 9007199254740992', ' - 4294967295'])))
program('a-counter-without-a-fraction-is-doubled', 'It leaves every range within some turns.', whole(counted('at', ['', ' + 1', ' - 1'])))
program('stores-beside-a-counter-without-a-fraction', 'A store outside the view does nothing.', '''
function fill(view: Int32Array, from: number): string {
  let turns = 0;
  for (let at = Math.trunc(from); turns < 3; at += 2, turns++) {
    view[at] = 100 + turns;
    view[at + 1] = 200 + turns;
    view[at - 3] = 300 + turns;
  }
  return view.join(" ");
}
for (const from of [''' + ', '.join(STARTS) + ''', 4, 7, 11, 12]) console.log(show(from), fill(new Int32Array(12), from));
''')
program('a-counter-steps-by-five-below-a-bound-of-which-nothing-is-known', 'Nothing cuts the counter, so it is a number. It has no fraction.', '''
function sum(view: Int32Array, bound: unknown): number {
  let total = 0;
  for (let at = 0; at < (bound as number); at += 5) total = (Math.imul(total, 31) + (view[at]! ^ view[at + 2]! ^ view[at - 1]! ^ view[at - 4]!)) | 0;
  return total;
}
function down(view: Int32Array, bound: unknown): number {
  let total = 0;
  for (let at = 14; at > (bound as number); at -= 3) total = (Math.imul(total, 31) + (view[at]! ^ view[at + 2]! ^ view[at - 1]!)) | 0;
  return total;
}
function far(view: Int32Array, bound: unknown): string {
  let found = "";
  for (let at = 1; at < (bound as number); at *= 4096) found += show(view[at]) + show(view[at - 1]) + show(view[at + 1]) + " ";
  return found;
}
const view = new Int32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
for (const bound of [0, 1, 12, 13, 40, 12.5, -7, "12", NaN, undefined, null, { valueOf: () => 11 }]) console.log(sum(view, bound), down(view, bound));
for (const bound of [0, 2, 1e9, 1e18, 1e40, Infinity]) console.log(far(view, bound).length, far(view, bound).slice(0, 60));
''')
program('a-counter-from-zero-steps-by-five-below-the-length', 'Five reads a turn, four of them past what the test of the loop has shown.', '''
function sum(view: Int32Array): number {
  let total = 0;
  for (let at = 0; at < view.length; at += 5) total = (Math.imul(total, 31) + (view[at]! ^ view[at + 1]! ^ view[at + 2]! ^ view[at + 3]! ^ view[at + 4]!)) | 0;
  return total;
}
function absent(view: Int32Array): number {
  let count = 0;
  for (let at = 0; at < view.length; at += 5) for (let k = 0; k < 5; k++) if (view[at + k] === undefined) count++;
  return count;
}
for (const length of [0, 1, 4, 5, 6, 9, 10, 11, 23]) {
  const view = Int32Array.from({ length }, (_, k) => k * 7 + 1);
  console.log(length, sum(view), absent(view));
}
''')
program('positions-of-every-kind', 'As they arrive, with nothing declared.', '''
function read(view, position) {
  let found = "";
  for (let turn = 0; turn < 2; turn++) found += show(view[position]) + " ";
  return found;
}
const view = Int32Array.from([1, 2, 3]);
view.extra = "an extra";
Object.setPrototypeOf(view, Object.create(Int32Array.prototype, {
  "1.5": { value: "never found" },
  "-1": { value: "never found" },
  "1e3": { value: "found: no number is written so" },
}));
for (const position of [0, 2, 3, -1, 1.5, NaN, -0, "0", "2", "3", "-0", "1.5", "-1", "1e3", "1000", "Infinity", "NaN", "extra", "length", "", " 1", "01", null, undefined, true, [1], { toString: () => "2" }, 1n])
  console.log(show(typeof position === "object" && position ? "an object" : position), read(view, position));
''', 'js')

# ---- outside of loops, in a loop inside a loop, in a function that is copied to where it is called

program('outside-of-loops', 'One read under what another gives.', '''
function pick(words: Int32Array, table: Int32Array, at: number): string {
  return show(words[table[at]!]) + " " + show(words[table[at + 1]!]! >>> 0);
}
const words = Int32Array.from([10, -20, 30]);
const table = Int32Array.from([2, 1, 5, -1]);
for (const at of [0, 1, 2, 3, 4, -1]) console.log(pick(words, table, at));
(words as any).undefined = 5;
for (const at of [0, 3, 4]) console.log(pick(words, table, at));
''')
program('a-loop-inside-a-loop', 'The loop inside runs past the end of its row.', '''
function sum(words: Int32Array, table: Int32Array, rows: number, width: number): number {
  let total = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column <= width; column++) total = (Math.imul(total, 31) + (words[table[row * width + column]!]! >>> 1)) | 0;
    total ^= row;
  }
  return total;
}
const words = Int32Array.from([10, 20, 30, 40]);
const table = Int32Array.from([0, 1, 2, 3, 3, 2, 1, 0, 9]);
for (const [rows, width] of [[3, 3], [4, 3], [2, 5], [0, 3]]) console.log(sum(words, table, rows!, width!));
(words as any).undefined = 6;
for (const [rows, width] of [[3, 3], [4, 3], [2, 5], [0, 3]]) console.log(sum(words, table, rows!, width!));
''')
program('the-read-stands-in-a-small-function', 'Which a loop calls.', '''
const at = (words: Int32Array, position: number | undefined): number => words[position!]! | 0;
function sum(words: Int32Array, table: Int32Array, turns: number): number {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) total = (Math.imul(total, 31) + at(words, table[turn])) | 0;
  return total;
}
const words = Int32Array.from([10, 20, 30, 40]);
const table = Int32Array.from([0, 3, 1]);
console.log(sum(words, table, 3), sum(words, table, 6));
(words as any).undefined = 9;
console.log(sum(words, table, 3), sum(words, table, 6));
''')
program('a-table-of-rows-packed-into-a-view', 'Two views of a module, a third that is handed over, eight reads a turn.', '''
const ROWS = Array.from({ length: 30 }, (_, k) => ({ i: k % 8, a: k % 31, j: (k * 7) % 8, b: (k * 3) % 31, c: k & 1 }));
const MASKS = Int32Array.from(ROWS.map((_, k) => (k % 9 === 0 ? 1 << (k % 31) : 0)));
const PACKED = Int32Array.from(ROWS.flatMap(({ i, a, j, b, c }) => [i, a, j, b, c]));
function find(words: Int32Array): number {
  const packed = PACKED;
  let mask = -1;
  for (let row = 0, at = 0; at < packed.length && mask !== 0; row += 1, at += 5) {
    const isBroken = (((words[packed[at]!]! >>> packed[at + 1]!) ^ (words[packed[at + 2]!]! >>> packed[at + 3]!)) & 1) ^ packed[at + 4]!;
    mask &= ~(MASKS[row]! & -isBroken);
  }
  return mask;
}
const words = new Int32Array(8).map((_, k) => Math.imul(k + 1, 2654435761));
let sum = 0;
for (let n = 0; n < 200; n++) {
  words[n % 8]! ^= n;
  sum = (Math.imul(sum, 31) + find(words)) | 0;
}
console.log(sum, find(new Int32Array(3)), find(new Int32Array(0)));
PACKED[7] = 100;
PACKED[12] = -1;
console.log(find(words));
''')

# ---- another thread

program('another-thread-grows-shared-memory-under-a-view', 'No turn of either loop does anything to the view: another thread lengthens the memory that it follows, and the loop ends when it sees that.', '''
function wait(view: Int32Array): number {
  let turns = 0;
  while (view[4] === undefined) turns++;
  return turns >= 0 ? view[4]! : -1;
}
function waitForLength(view: Int32Array): number {
  let turns = 0;
  while (view.length < 9) turns++;
  return turns >= 0 ? view.length : -1;
}
if (Bun.isMainThread) {
  const shared = new SharedArrayBuffer(8, { maxByteLength: 64 });
  const view = new Int32Array(shared);
  const worker = new Worker(import.meta.url);
  worker.postMessage(shared);
  console.log(wait(view));
  Atomics.store(view, 0, 1);
  console.log(waitForLength(view));
  worker.terminate();
} else {
  onmessage = (event: MessageEvent) => {
    const shared = event.data as SharedArrayBuffer;
    shared.grow(24);
    const view = new Int32Array(shared);
    while (Atomics.load(view, 0) === 0);
    shared.grow(40);
  };
}
''')

for name, (extension, text) in programs.items():
    open(os.path.join(out, name + '.' + extension), 'w').write(text)
print(len(programs), 'programs')
