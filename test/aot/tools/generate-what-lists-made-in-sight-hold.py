#!/usr/bin/env python3
# generate-what-lists-made-in-sight-hold.py <folder>: one shape a program: a list is made in sight, something stands between the making and a read at a position known to lie inside, and the element read is USED as what the list was made with
# (a field by its place, the length of a text, a sum), so that an element of another kind that is taken for the old kind shows in the answer. Every program's answer is plain Bun's.
import os, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)

head = '''class P { x: number; constructor(x: number) { this.x = x; } }
class Q { y: string = "why"; z: number = 0.5; x: number; constructor(x: number) { this.x = x; } }
const hidden: any = (globalThis as any);
hidden.touch = (list: any[], at: number, value: any) => { list[at] = value; };
function show(make: () => unknown) { try { console.log(String(make())); } catch (error) { console.log((error as Error).constructor.name); } }
'''

# name: (the making, the use of an element e, values of another kind)
makers = {
    'objects-of-one-class': ('[first, new P(2), new P(3), new P(4)]', 'e.x + 1'),
    'objects-of-two-classes': ('[first, new Q(2), new P(3), new Q(4)]', 'e.x + 1'),
    'texts': ('["a", "bb", "ccc", "dddd"]', 'e.length + 1'),
    'one-object-of-another-class-at-the-end': ('[first, new P(2), new P(3), new Q(4)]', 'e.x + 1'),
    'one-number-at-the-end-of-texts-worked-out': ('["n" + a, "m" + b, "k" + a + b, a + b]', 'e.length + 1'),
    'one-text-at-the-end-of-numbers': ('[a, b, a + b, "t" + a]', 'e + 1'),
    'numbers-worked-out': ('[a, b, a + b, a - b]', 'e + 1'),
    'texts-worked-out': ('["n" + a, "m" + b, "k" + a + b, "j"]', 'e.length + 1'),
    'numbers-and-nothing': ('[a, null, b, undefined]', 'e === null ? "null" : e === undefined ? "undefined" : e + 1'),
}
others = ['new Q(9)', '"text"', '7.5', 'undefined', 'null', '{ x: "own" }', '[1, 2]']

# name: statements between the making and the reads; @@ is the value of another kind
writers = {
    'nothing-between': '',
    'stored-at-a-written-place': 't[1] = @@;',
    'stored-at-a-masked-place': 't[k & 3] = @@;',
    'stored-by-other-code': 'hidden.touch(t, 2, @@);',
    'stored-by-a-closure': 'const change = () => { t[3] = @@; }; change();',
    'stored-through-another-name': 'const same = t; same[0] = @@;',
    'filled': 't.fill(@@, 1, 3);',
    'spliced': 't.splice(1, 1, @@);',
    'turned-round': 't.reverse();',
    'copied-within': 't[0] = @@; t.copyWithin(2, 0, 1);',
    'pushed-and-shifted': 't.push(@@); t.shift();',
    'cut-and-pushed': 't.length = 2; t.push(@@, @@);',
    'assigned-by-object-assign': 'Object.assign(t, { 2: @@ });',
    'set-by-reflect': 'Reflect.set(t, 1, @@);',
    'defined-by-define-property': 'Object.defineProperty(t, 1, { value: @@, writable: true, enumerable: true, configurable: true });',
    'taken-apart-into-it': '[t[0], t[3]] = [@@, @@];',
    'stored-in-a-branch': 'if (k & 1) t[2] = @@;',
    'stored-in-finally': 'try { if (k > 90) throw new Error("no"); } finally { t[1] = @@; }',
    'stored-in-a-handler': 'try { hidden.nothingHere(); } catch { t[2] = @@; }',
    'sorted-by-a-callback-that-stores': 't.sort(() => { t[0] = @@; return 0; });',
    'deleted': 'delete t[1];',
}
# the list is left alone and an element, which a name holds too, is changed: only where the elements are objects
writersOfElements = {
    'the-element-gets-another-prototype': 'Object.setPrototypeOf(first, Q.prototype);',
    'the-element-loses-its-field': 'delete first.x;',
    'the-element-gets-a-field': 'first.more = 1;',
    'the-field-of-the-element-becomes-a-getter': 'Object.defineProperty(first, "x", { get() { return 40; }, configurable: true });',
    'the-element-is-frozen': 'Object.freeze(first);',
    'the-element-gets-many-fields': 'for (let n = 0; n < 70; n++) first["f" + n] = n;',
    'the-field-of-the-element-takes-a-text': 'first.x = "text";',
    'the-element-is-changed-by-other-code': 'hidden.touch(first, "x", @@);',
}

count = 0
for maker, (making, use) in makers.items():
    for writer, between in list(writers.items()) + (list(writersOfElements.items()) if 'object' in maker else []):
        other = others[count % len(others)]
        body = f'''function straight(a: number, b: number, k: number) {{
  const first: any = new P(1);
  const t: any[] = {making};
  {between.replace('@@', '(' + other + ')')}
  const e = t[k & 3];
  return {use};
}}
function inALoop(a: number, b: number, k: number) {{
  const first: any = new P(1);
  const t: any[] = {making};
  let all = "";
  for (let turn = 0; turn < 6; turn++) {{
    const e = t[turn & 3];
    all += ({use}) + ",";
    if (turn === k) {{ {between.replace('@@', '(' + other + ')')} }}
  }}
  return all;
}}
for (let k = 0; k < 5; k++) {{ show(() => straight(2, 0.5, k)); show(() => inALoop(2, 0.5, k)); }}
'''
        open(os.path.join(out, f'{maker}-{writer}.ts'), 'w').write(head + body)
        count += 1
print(count, 'programs')
