#!/usr/bin/env python3
# generate-copies-of-objects.py <folder>: all 1,372; ../parallel/copies-of-objects/ holds 4 of them: one-shape programs: a copy of the own properties of a source (spread, rest, Object.assign) in a function that a loop enters; sources of many kinds; a deed between two rounds changes the source.
# forms x sources, and forms x deeds on a plain record. Every observer is a primitive: the keys in their order, the values, the attributes, and the order in which getters ran. The reference is `bun <file>`.
import os, sys
out = sys.argv[1]
os.makedirs(out, exist_ok=True)

show = '''let log = "";
function show(o: any): string {
  if (o === null || typeof o !== "object") return String(o);
  let text = "";
  for (const key of Reflect.ownKeys(o)) { const d = Object.getOwnPropertyDescriptor(o, key)!; text += String(key) + "=" + ("value" in d ? String(d.value) : "accessor") + (d.enumerable ? "" : "!e") + (d.writable === false ? "!w" : "") + (d.configurable ? "" : "!c") + " "; }
  const all = text + "|" + Object.keys(o).join() + "|" + (Object.getPrototypeOf(o) === Object.prototype) + "|" + Object.isFrozen(o) + log; log = ""; return all;
}
function tell(s: any): string { try { let last = ""; for (let k = 0; k < 3; k++) last = show(use(s, k)); return last; } catch (error) { const text = (error as Error).name + log; log = ""; return text; } }
'''

forms = {
 'spread-alone': 'function use(s: any, k: number): any { return { ...s }; }',
 'spread-and-a-name-behind': 'function use(s: any, k: number): any { return { ...s, z: k }; }',
 'spread-and-a-name-of-the-source-behind': 'function use(s: any, k: number): any { return { ...s, b: k }; }',
 'name-in-front-of-the-spread': 'function use(s: any, k: number): any { return { z: k, ...s }; }',
 'name-of-the-source-in-front-of-the-spread': 'function use(s: any, k: number): any { return { b: k, ...s }; }',
 'two-spreads': 'function use(s: any, k: number): any { return { ...s, ...s }; }',
 'spread-of-the-source-and-of-a-literal': 'function use(s: any, k: number): any { return { ...s, ...{ b: k, y: k } }; }',
 'assign-into-a-literal': 'function use(s: any, k: number): any { return Object.assign({ z: k }, s); }',
 'assign-into-a-literal-with-a-name-of-the-source': 'function use(s: any, k: number): any { return Object.assign({ b: k }, s); }',
 'assign-into-an-empty-literal': 'function use(s: any, k: number): any { return Object.assign({}, s); }',
 'assign-two-sources': 'function use(s: any, k: number): any { return Object.assign({ z: k }, s, { y: k }); }',
 'assign-into-a-literal-with-a-setter': 'function use(s: any, k: number): any { return Object.assign({ z: k, set b(v: unknown) { log += " set " + String(v); } }, s); }',
 'rest': 'function use(s: any, k: number): any { const { a, ...rest } = s; return rest; }',
 'rest-behind-a-computed-key': 'const name: string = ["a"].join("");\nfunction use(s: any, k: number): any { const { [name]: taken, ...rest } = s; return rest; }',
 'typed-spread': 'type Source = { a: number; b: number; c?: number };\nfunction use(s: Source, k: number): any { return { ...s, z: k }; }',
 'typed-assign': 'type Source = { a: number; b: number; c?: number };\nfunction use(s: Source, k: number): any { return Object.assign({ z: k }, s); }',
}

sources = {
 'a-record': '{ a: 1, b: 2 }',
 'a-record-in-another-order': '{ b: 2, a: 1 }',
 'a-record-with-one-name-more': '{ a: 1, b: 2, c: 3 }',
 'an-empty-object': '{}',
 'an-instance-of-a-class': 'new (class Pair { a = 1; b = 2; get c() { return 3; } })()',
 'a-getter-of-its-own': '{ a: 1, get b() { log += " get b"; return 2; } }',
 'a-getter-that-changes-the-source': '{ a: 1, get b() { log += " get b"; (this as any).c = 9; delete (this as any).a; return 2; }, c: 3 }',
 'a-getter-that-throws': '{ a: 1, get b(): number { log += " get b"; throw new RangeError("b"); }, c: 3 }',
 'a-setter-alone': '{ a: 1, set b(v: number) { log += " set"; } }',
 'a-symbol-key': '{ a: 1, [Symbol.for("s")]: 5, b: 2 }',
 'keys-that-are-numbers': '{ b: 2, 1: "one", a: 1, 0: "zero" }',
 'a-name-that-is-not-listed': 'Object.defineProperty({ a: 1, b: 2 }, "h", { value: 7, enumerable: false })',
 'a-field-that-is-not-listed': 'Object.defineProperty({ a: 1, b: 2 }, "b", { enumerable: false })',
 'a-field-that-is-read-only': 'Object.defineProperty({ a: 1, b: 2 }, "b", { writable: false })',
 'a-frozen-record': 'Object.freeze({ a: 1, b: 2 })',
 'a-sealed-record': 'Object.seal({ a: 1, b: 2 })',
 'names-that-are-inherited': 'Object.create({ a: 1 }, { b: { value: 2, enumerable: true } })',
 'a-record-below-null': 'Object.assign(Object.create(null), { a: 1, b: 2 })',
 'a-record-below-another-prototype': 'Object.setPrototypeOf({ a: 1, b: 2 }, { c: 3 })',
 'proto-as-a-name-of-its-own': 'JSON.parse(\'{"a":1,"__proto__":{"x":1},"b":2}\')',
 'out-of-json': 'JSON.parse(\'{"a":1,"b":2}\')',
 'a-proxy': 'new Proxy({ a: 1, b: 2 }, { ownKeys(t) { log += " keys"; return Reflect.ownKeys(t); }, get(t, key) { log += " get " + String(key); return Reflect.get(t, key); } })',
 'a-list': '[7, 8]',
 'a-text': '"ab"',
 'a-number': '5',
 'null': 'null',
 'undefined': 'undefined',
 'a-function-with-names': 'Object.assign(function () {}, { a: 1, b: 2 })',
 'a-map': 'new Map([["a", 1]])',
 'undefined-in-a-field': '{ a: undefined, b: 2 }',
 'a-closure-in-a-field': '{ a: 1, b: () => 2 }',
 'a-field-deleted-and-laid-again': '(() => { const o: any = { a: 1, b: 2 }; delete o.a; o.a = 1; return o; })()',
 'a-field-deleted': '(() => { const o: any = { a: 1, b: 2 }; delete o.a; return o; })()',
 'a-name-stored-behind-the-literal': '(() => { const o: any = { a: 1, b: 2 }; o.c = 3; return o; })()',
 'many-names': '{ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10, k: 11, l: 12, m: 13, n: 14, o: 15, p: 16, q: 17, r: 18 }',
}

deeds = {
 'gains-a-name': 'kept.c = 3;',
 'unseen-code-gives-it-a-name': '(0, eval)("kept.c = 3");',
 'loses-a-field': 'delete kept.a;',
 'unseen-code-takes-a-field': '(0, eval)("delete kept.a");',
 'loses-a-field-and-gets-it-again': 'delete kept.a; kept.a = 1;',
 'a-field-becomes-a-getter': 'Object.defineProperty(kept, "b", { get() { log += " get b"; return 20; }, enumerable: true, configurable: true });',
 'unseen-code-makes-a-field-a-getter': '(globalThis as any).note = () => { log += " get b"; }; (0, eval)("Object.defineProperty(kept, \'b\', { get() { note(); return 20; }, enumerable: true, configurable: true })");',
 'a-field-is-listed-no-more': 'Object.defineProperty(kept, "b", { enumerable: false });',
 'is-frozen': 'Object.freeze(kept);',
 'is-relinked': 'Object.setPrototypeOf(kept, { c: 3 });',
 'gains-a-symbol': 'kept[Symbol.for("s")] = 5;',
 'gains-a-number': 'kept[0] = "zero";',
 'a-field-gets-another-kind-of-value': 'kept.b = "text";',
 'a-field-gets-undefined': 'kept.b = undefined;',
}

# Each form again with the source's type written: the walk plans a copy by the layout that is expected of the source, and most sources here are not what is written.
for name, text in list(forms.items()):
    if 's: any' in text:
        forms['typed.' + name] = 'type Source = { a: number; b: number; c?: number };\n' + text.replace('s: any', 's: Source')
del forms['typed-spread'], forms['typed-assign']

count = 0
def write(name, form, source, deed):
    global count
    program = f'''{show}{form}
function make(): any {{ return {source}; }}
const kept: any = make();
(globalThis as any).kept = kept;
console.log(tell(kept));
console.log(tell(make()));
{deed}
console.log(tell(kept));
console.log(tell(make()));
'''
    open(os.path.join(out, name + '.ts'), 'w').write(program)
    count += 1
for f, form in forms.items():
    for s, source in sources.items():
        write(f'{f}.of.{s}', form, source, '')
    for d, deed in deeds.items():
        write(f'{f}.the-record.{d}', form, '{ a: 1, b: 2 }', deed)
print(count, 'programs')
