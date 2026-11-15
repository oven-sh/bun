#!/usr/bin/env python3
# generate-loops-over-one-of-several-kinds.py <folder>: all 64; ../parallel/loops-over-one-of-several-kinds/ holds 26 of them: those that a fault laid into the compiler on purpose has turned red, and of each way to leave, to change and to fill the loop a few.
# A loop works on a value that it does not change, and the value is one of a few kinds: a list or a view, an object of one of three classes, one of three closures.
# A compiler may tell the kinds apart once, in front of the loop, and build the loop for each. Each program hands its one loop every kind that is written, then what is not written,
# and does in some turn what makes the kind that was found in front of the loop a wrong guide to the rest of the turns.
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)

HEAD = '''const show = (value: any): string => {
  try {
    return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : typeof value === "function" ? "function" : String(value);
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
// Nobody can follow a value through a property of the global object.
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

# ---- what holds elements

HOLDERS = {
    'a-list-of-numbers': ('number[]', '[1.5, 2, 3.25, 4]'),
    'a-list-of-int32': ('number[]', '[1, 2, 3, 4]'),
    'a-view-of-float64': ('Float64Array', 'new Float64Array([1.5, 2, 3.25, 4])'),
    'a-view-of-int32': ('Int32Array', 'new Int32Array([1, -2, 3, 4])'),
    'a-view-of-uint8': ('Uint8Array', 'new Uint8Array([1, 200, 3, 4])'),
    'a-view-of-float32': ('Float32Array', 'new Float32Array([1.5, 2, 3.25, 4])'),
}
SETS = [
    ('a-list-of-numbers', 'a-view-of-float64'),
    ('a-view-of-int32', 'a-view-of-uint8'),
    ('a-list-of-int32', 'a-view-of-int32', 'a-view-of-float64'),
    ('a-list-of-numbers', 'a-view-of-float64', 'a-view-of-float32', 'a-view-of-uint8'),
]
STRANGERS = {
    'a-list-with-a-hole': '[1, , 3, 4]',
    'a-list-of-texts': '["1", "2", "3"]',
    'a-view-of-another-class': 'new Int16Array([7, 8, 9])',
    'a-view-of-big-integers': 'new BigInt64Array([7n, 8n])',
    'a-text': '"1234"',
    'a-plain-object': '{ length: 3, 0: 5, 1: 6, 2: 7 }',
    'an-object-whose-length-counts': '{ asked: 0, get length() { return ++this.asked < 4 ? 9 : 0; }, 0: 1, 1: 2, 2: 3 }',
    'a-subclass-of-a-list': 'new (class extends Array<number> { get length() { return 2; } set length(value) {} })()',
    'a-subclass-of-a-view': 'new (class extends Float64Array { get length() { return 2; } })([9, 8, 7])',
    'a-proxy-of-a-list': 'new Proxy([1, 2, 3], { get: (target, key) => (key === "1" ? 50 : Reflect.get(target, key)) })',
    'a-detached-view': '(() => { const view = new Float64Array([1, 2, 3]); view.buffer.transfer(); return view; })()',
    'a-frozen-list': 'Object.freeze([1, 2, 3])',
    'undefined': 'undefined',
    'null': 'null',
    'a-number': '7',
}
for members in SETS:
    written = ' | '.join(dict.fromkeys(HOLDERS[m][0] for m in members))
    name = '-or-'.join(members)
    made = ', '.join(HOLDERS[m][1] for m in members)
    program(f'{name}-is-summed', f'`{written}`: each kind in turn.', f'''
function sum(xs: {written}): number {{ let s = 0; for (let i = 0; i < xs.length; i++) s += xs[i]!; return s; }}
const all = hidden<({written})[]>([{made}]);
for (let round = 0; round < 3; round++) console.log(all.map(each => sum(each)).join(" "));
''')
    program(f'{name}-is-written', f'`{written}`: each turn stores.', f'''
function scale(xs: {written}, by: number): string {{ for (let i = 0; i < xs.length; i++) xs[i] = xs[i]! * by + 0.5; return xs.join(" "); }}
const all = hidden<({written})[]>([{made}]);
for (let round = 0; round < 3; round++) console.log(all.map(each => scale(each, round + 1)).join(" | "));
''')
written = 'Float64Array | number[]'
for stranger, made in STRANGERS.items():
    program(f'a-list-or-a-view-is-written-and-{stranger}-arrives', 'What arrives is neither. The loop does with it what the language says.', f'''
function sum(xs: {written}): unknown {{ let s: any = 0; for (let i = 0; i < xs.length; i++) s += xs[i]!; return s; }}
const all = hidden<({written})[]>([[1.5, 2], new Float64Array([3.5, 4]), {made}, [5], new Float64Array([6])]);
for (let round = 0; round < 3; round++) console.log(all.map(each => attempt(() => sum(each))).join(" "));
''')

# ---- something happens to the value in a turn

DEEDS = {
    'the-list-is-cut-short': ('if (i === 1 && Array.isArray(xs)) xs.length = 2;', ''),
    'the-list-grows': ('if (i === 1 && Array.isArray(xs) && xs.length < 6) xs.push(10);', ''),
    'a-hole-is-made': ('if (i === 0 && Array.isArray(xs)) delete xs[2];', ''),
    'a-text-is-stored': ('if (i === 0 && Array.isArray(xs)) (xs as any)[2] = "three";', ''),
    'the-buffer-is-handed-away': ('if (i === 1 && !Array.isArray(xs)) xs.buffer.transfer();', ''),
    'the-prototype-is-replaced': ('if (i === 1) Object.setPrototypeOf(xs, { get length() { return 3; } });', ''),
    'a-length-of-its-own-is-laid-on-the-view': ('if (i === 1 && !Array.isArray(xs)) Object.defineProperty(xs, "length", { value: 2 });', ''),
    'code-that-nobody-knows-runs': ('hook(xs, i);', 'const hook = hidden<(xs: any, i: number) => void>((xs: any, i: number) => { if (i === 1) xs[3] = 100; });'),
    'it-throws': ('if (i === 2) throw new RangeError("in turn two");', ''),
}
for deed, (line, declared) in DEEDS.items():
    program(f'in-a-turn-over-a-list-or-a-view-{deed}', 'What was found in front of the loop says nothing of the turns behind the deed.', f'''
{declared}
function sum(xs: {written}): unknown {{
  let s: any = 0;
  for (let i = 0; i < xs.length; i++) {{
    {line}
    s += xs[i]!;
  }}
  return s;
}}
for (let round = 0; round < 3; round++) console.log(attempt(() => sum(hidden([1.5, 2, 3, 4]))), attempt(() => sum(hidden(new Float64Array([1.5, 2, 3, 4])))));
''')

# ---- how the loop is left, and what is read behind it

LOOPS = {
    'it-breaks': 'let s = 0, i = 0; for (; i < xs.length; i++) { if (xs[i]! > 2.5) break; s += xs[i]!; } return s + ":" + i;',
    'it-continues': 'let s = 0; for (let i = 0; i < xs.length; i++) { if (i & 1) continue; s += xs[i]!; } return s;',
    'it-returns-out-of-a-turn': 'for (let i = 0; i < xs.length; i++) if (xs[i]! > 2.5) return i + ":" + xs[i]; return "none";',
    'what-a-turn-made-is-read-behind-it': 'let last: unknown, before: unknown; for (let i = 0; i < xs.length; i++) { before = last; last = xs[i]! * 2; } return show(before) + ":" + show(last);',
    'it-is-a-while-loop': 'let s = 0, i = xs.length; while (i-- > 0) s = s * 2 + xs[i]!; return s;',
    'it-is-a-do-loop': 'let s = 0, i = 0; do { s += xs[i]! ?? -1; } while (++i < xs.length); return s;',
    'a-loop-stands-inside': 'let s = 0; for (let i = 0; i < xs.length; i++) for (let j = i; j < xs.length; j++) s += xs[i]! * xs[j]!; return s;',
    'two-loops-stand-in-a-row': 'let s = 0; for (let i = 0; i < xs.length; i++) s += xs[i]!; for (let i = 0; i < xs.length; i++) s -= xs[i]! / 2; return s;',
    'a-handler-stands-round-it': 'let s = 0; try { for (let i = 0; i <= xs.length; i++) { if (xs[i] === undefined) throw new Error("past the end"); s += xs[i]!; } } catch (error) { return s + ":" + (error as Error).message; } return s;',
    'a-handler-stands-in-it': 'let s = 0; for (let i = 0; i <= xs.length; i++) { try { if (xs[i] === undefined) throw new Error("!"); s += xs[i]!; } catch (error) { s = -s; } } return s;',
    'a-closure-takes-the-counter': 'const made: (() => number)[] = []; for (let i = 0; i < xs.length; i++) made.push(() => xs[i]! + i); return made.map(each => each()).join(" ");',
    'the-value-is-another-in-the-next-turn': 'let s = 0, ys = xs; for (let i = 0; i < ys.length; i++) { s += ys[i]!; if (i === 1) ys = other; } return s;',
}
for how, body in LOOPS.items():
    program(f'over-a-list-or-a-view-{how}', 'Whichever build of the loop runs.', f'''
const other = hidden<{written}>(new Float64Array([10, 20, 30, 40, 50]));
function work(xs: {written}): unknown {{ {body} }}
const all = hidden<({written})[]>([[1.5, 2, 3, 4], new Float64Array([1.5, 2, 3, 4]), [], new Float64Array(0), [9]]);
for (let round = 0; round < 3; round++) console.log(all.map(each => attempt(() => work(each))).join(" | "));
''')
program('the-loop-over-a-list-or-a-view-suspends', 'A generator and an async function.', f'''
function* each(xs: {written}) {{ for (let i = 0; i < xs.length; i++) yield xs[i]! * 2; }}
async function later(xs: {written}) {{ let s = 0; for (let i = 0; i < xs.length; i++) s += await xs[i]!; return s; }}
const all = hidden<({written})[]>([[1.5, 2], new Float64Array([3.5, 4])]);
for (const one of all) console.log([...each(one)].join(" "), await later(one));
''')
program('two-values-of-several-kinds-in-one-loop', 'Each is one of two kinds, in every pairing.', f'''
function dot(xs: {written}, ys: {written}): number {{ let s = 0; for (let i = 0; i < xs.length && i < ys.length; i++) s += xs[i]! * ys[i]!; return s; }}
const all = hidden<({written})[]>([[1.5, 2, 3], new Float64Array([4, 5.5, 6])]);
for (let round = 0; round < 3; round++) for (const xs of all) for (const ys of all) console.log(dot(xs, ys));
''')

# ---- objects of a few classes

CLASSES = '''
abstract class Shape { abstract area(): number; twice(): number { return this.area() * 2; } }
class Square extends Shape { constructor(public side: number) { super(); } area(): number { return this.side * this.side; } }
class Rect extends Shape { constructor(public w: number, public h: number) { super(); } area(): number { return this.w * this.h; } }
class Disk extends Shape { constructor(public r: number) { super(); } area(): number { return 3 * this.r * this.r; } twice(): number { return super.twice() + 1; } }
function sum(shape: Shape, turns: number): unknown { let total: any = 0; for (let i = 0; i < turns; i++) total += shape.area(); return total; }
function both(shape: Shape, turns: number): unknown { let total: any = 0; for (let i = 0; i < turns; i++) total += shape.twice() - shape.area(); return total; }
'''
SHAPES = {
    'each-class-in-turn': 'new Square(2), new Rect(2, 3), new Disk(1)',
    'a-class-below-one-of-them': 'new Square(2), new (class extends Square { area() { return -1; } })(5), new Rect(1, 1)',
    'an-object-with-a-method-of-its-own': 'new Square(2), Object.assign(new Rect(2, 3), { area() { return 1000; } }), new Disk(1)',
    'an-object-below-another-prototype': 'new Square(2), Object.setPrototypeOf(new Rect(2, 3), { area() { return 77; }, twice() { return 78; } }), new Disk(1)',
    'a-plain-object': 'new Square(2), { area: () => 5, twice: () => 11 }, new Disk(1)',
    'an-object-without-the-method': 'new Square(2), {}, new Disk(1)',
    'undefined-and-null': 'new Square(2), undefined, null, new Disk(1)',
    'a-field-that-holds-a-text': 'new Square(2), new Rect("2" as any, 3), new Disk(1)',
}
for what, made in SHAPES.items():
    program(f'a-method-is-called-on-one-receiver-all-through-a-loop-{what}', 'The receiver is found in front of the loop.', CLASSES + f'''
const all = hidden<Shape[]>([{made}]);
for (let round = 0; round < 3; round++) console.log(all.map(each => attempt(() => sum(each, 4)) + "," + attempt(() => both(each, 3))).join(" "));
''')
program('the-method-is-replaced-in-a-turn', 'On the class, and on the object.', CLASSES + '''
function sumAndChange(shape: Shape, turns: number, change: (i: number) => void): unknown { let total: any = 0; for (let i = 0; i < turns; i++) { change(i); total += shape.area(); } return total; }
const square = hidden<Shape>(new Square(2)), rect = hidden<Shape>(new Rect(2, 3));
console.log(sumAndChange(square, 4, () => {}), sumAndChange(rect, 4, () => {}));
console.log(sumAndChange(square, 4, i => { if (i === 2) (square as any).area = () => 100; }));
console.log(sumAndChange(rect, 4, i => { if (i === 2) Rect.prototype.area = function () { return -1; }; }));
console.log(sumAndChange(square, 4, () => {}), sumAndChange(rect, 4, () => {}), sum(new Rect(1, 1), 2));
''')

# ---- one of a few closures

STEPS = {
    'each-closure-in-turn': '(x: number) => x + 3, (x: number) => x * 5 + 1, (x: number) => x ^ (x >>> 3)',
    'two-closures-of-one-function': 'adder(3), adder(4), (x: number) => x * 2',
    'a-bound-function': '(x: number) => x + 3, ((a: number, x: number) => a * x).bind(null, 7), (x: number) => x - 1',
    'a-built-in': '(x: number) => x + 3, Math.abs, Math.sqrt',
    'a-class': '(x: number) => x + 3, class {} as any, (x: number) => x - 1',
    'what-is-no-function': '(x: number) => x + 3, 5 as any, undefined as any, (x: number) => x - 1',
    'a-closure-that-gives-a-text': '(x: number) => x + 3, ((x: number) => "t" + x) as any, (x: number) => x - 1',
    'a-closure-that-throws': '(x: number) => x + 3, (x: number) => { if (x > 2) throw new RangeError("too far"); return x + 1; }, (x: number) => x - 1',
    'five-closures': '(x: number) => x + 1, (x: number) => x + 2, (x: number) => x + 3, (x: number) => x + 4, (x: number) => x + 5',
}
for what, made in STEPS.items():
    program(f'a-function-from-outside-is-called-all-through-a-loop-{what}', 'The callee is found in front of the loop.', f'''
const adder = (by: number) => (x: number) => x + by;
function repeat(step: (x: number) => number, turns: number): unknown {{ let s: any = 1; for (let i = 0; i < turns; i++) s = step(s) | 0; return s; }}
const steps = hidden<((x: number) => number)[]>([{made}]);
for (let round = 0; round < 3; round++) console.log(steps.map(each => attempt(() => repeat(each, 5))).join(" "));
''')
print(count, 'programs')
