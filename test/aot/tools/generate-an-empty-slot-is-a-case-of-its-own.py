#!/usr/bin/env python3
# all 1,960; ../parallel/an-empty-slot-is-a-case-of-its-own/ holds 3 of them.
"""generate-an-empty-slot-is-a-case-of-its-own.py <folder>: one-shape programs for the third arm of a guess: `if ((kind as Whole).part)` of a field that the type behind a cast requires, that a store by name appends and that most objects leave out.
A maker x a use x a deed. Each program is built alone. The function `use` is handed to unseen code, so its parameter is only expected to be what is written."""
import sys, os
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
makers = {
  'function': '''interface Part { id: number }
interface Kind { flags: number }
interface Whole extends Kind { part: Part; label: string }
const Kind = function (this: Kind, flags: number) { this.flags = flags; } as unknown as { new (flags: number): Kind; prototype: any };''',
  'class': '''interface Part { id: number }
class Kind { flags: number; constructor(flags: number) { this.flags = flags; } }
interface Whole extends Kind { part: Part; label: string }''',
}
uses = {
  'if': 'if ((kind as Whole).part) return "has " + (kind as Whole).part.id; return "none";',
  'if-not': 'if (!(kind as Whole).part) return "none"; return "has " + (kind as Whole).part.id;',
  'behind-a-flag': 'if (kind.flags & 4 && (kind as Whole).part) return "has " + (kind as Whole).part.id; return "none";',
  'choice': 'return (kind as Whole).part ? "has " + (kind as Whole).part.id : "none";',
  'and': 'const found = (kind as Whole).part && (kind as Whole).part.id; return "found " + found;',
  'or': 'const found = (kind as Whole).part || other; return "found " + found.id;',
  'or-else': 'const found = (kind as Whole).part ?? other; return "found " + (found as any)?.id;',
  'chain': 'return "found " + (kind as Whole).part?.id;',
  'is-undefined': 'if ((kind as Whole).part === undefined) return "none"; return "has " + ((kind as Whole).part as any)?.id;',
  'is-not-undefined': 'if ((kind as Whole).part !== undefined) return "has " + ((kind as Whole).part as any)?.id; return "none";',
  'is-nothing': 'if ((kind as Whole).part == null) return "none"; return "has " + (kind as Whole).part.id;',
  'typeof': 'if (typeof (kind as Whole).part === "undefined") return "none"; return "has " + ((kind as Whole).part as any)?.id;',
  'while': 'let turns = 0; while ((kind as Whole).part && turns < 2) turns++; return "turns " + turns;',
  'made-if-missing': 'if (!(kind as Whole).part) (kind as Whole).part = { id: 9 }; return "has " + (kind as Whole).part.id;',
}
# what happens to `bare`, an object without the field, or to what stands above it
deeds = {
  'nothing': '',
  'the-class-gains-the-name': 'Kind.prototype.part = part;',
  'the-class-gains-a-getter': 'Object.defineProperty(Kind.prototype, "part", { get() { return part; }, configurable: true });',
  'the-class-gains-a-getter-that-counts': 'Object.defineProperty(Kind.prototype, "part", { get() { tell("asked"); return undefined; }, configurable: true });',
  'the-class-is-relinked': 'Object.setPrototypeOf(Kind.prototype, { part });',
  'relinked-to-an-object-with-the-name': 'Object.setPrototypeOf(bare, { part });',
  'relinked-to-an-object-without-the-name': 'Object.setPrototypeOf(bare, { size: 1 });',
  'relinked-to-null': 'Object.setPrototypeOf(bare, null);',
  'relinked-to-a-proxy': 'Object.setPrototypeOf(bare, new Proxy({}, { get(target, name) { return name === "part" ? part : undefined; } }));',
  'made-an-accessor': 'Object.defineProperty(bare, "part", { get() { return part; }, configurable: true, enumerable: true });',
  'made-read-only': 'Object.defineProperty(bare, "part", { value: part, writable: false, configurable: true, enumerable: true });',
  'made-hidden': 'Object.defineProperty(bare, "part", { value: part, writable: true, configurable: true, enumerable: false });',
  'filled': '(bare as Whole).part = part;',
  'filled-then-deleted': '(bare as Whole).part = part; delete (bare as any).part;',
  'undefined-stored': '(bare as any).part = undefined;',
  'null-stored': '(bare as any).part = null;',
  'zero-stored': '(bare as any).part = 0;',
  'empty-text-stored': '(bare as any).part = "";',
  'a-number-stored': '(bare as any).part = 7;',
  'a-text-stored': '(bare as any).part = "text";',
  'frozen': 'Object.freeze(bare);',
  'sealed': 'Object.seal(bare);',
  'closed-to-more': 'Object.preventExtensions(bare);',
  'gains-another-name': '(bare as any).more = 1;',
  'gains-the-other-field': '(bare as Whole).label = "label";',
  'gains-an-index': '(bare as any)[0] = part;',
  'gains-a-symbol': '(bare as any)[Symbol.for("part")] = part;',
  'assigned': 'Object.assign(bare, { part });',
  'reflected': 'Reflect.set(bare, "part", part);',
  'stored-by-a-key': 'const key: string = ["pa", "rt"].join(""); (bare as any)[key] = part;',
}
# what is handed to `use` in place of `bare`
strangers = {
  'a-plain-object': '{ flags: 4 }', 'a-plain-object-with-the-name': '{ flags: 4, part }', 'a-parsed-object': 'JSON.parse(\'{"flags":4,"part":{"id":5}}\')',
  'a-proxy': 'new Proxy(new Kind(4), { get(target: any, name) { return name === "part" ? part : target[name]; } })',
  'an-object-below': 'Object.create(new Kind(4))', 'an-object-below-one-with-the-name': 'Object.create(full)',
  'an-object-of-a-class-below': 'new (class extends (Kind as any) { get part() { return part; } })(4)',
  'a-function': 'Object.assign(function () {}, { flags: 4 })', 'an-array': 'Object.assign([], { flags: 4, part })', 'a-number': '4', 'a-text': '"text"',
}
head = '''// STATISTIC: EmptySlotCasesEmitted >= 1
%s
const lines: string[] = [];
function tell(line: string) { lines.push(line); }
const part: Part = { id: 3 };
const other: Part = { id: 8 };
function use(kind: Kind): string { %s }
(globalThis as any).handed = [use];
const asked: (kind: Kind) => string = (globalThis as any).handed[0];
function ask(kind: any) { try { tell(asked(kind)); } catch (error) { tell("threw " + (error as Error).name); } }
const bare = new Kind(4);
const full = new Kind(4);
(full as Whole).part = part;
'''
tail = '''console.log(lines.join("\\n"));
export {};
'''
n = 0
for maker, text in makers.items():
    for use, body in uses.items():
        for deed, does in deeds.items():
            for when in ('first', 'between'):
                if deed == 'nothing' and when == 'first':
                    continue
                s = head % (text, body)
                if when == 'between':
                    s += 'for (let turn = 0; turn < 3; turn++) { ask(bare); ask(full); ask(new Kind(turn)); }\n'
                s += 'try { %s } catch (error) { tell("the deed threw " + (error as Error).name); }\n' % does if does else ''
                s += 'for (let turn = 0; turn < 3; turn++) { ask(bare); ask(full); ask(new Kind(4)); }\n'
                s += tail
                open('%s/%s.%s.%s.%s.ts' % (out, maker, use, deed, when), 'w').write(s); n += 1
        for stranger, made in strangers.items():
            s = head % (text, body) + 'const stranger: any = %s;\nfor (let turn = 0; turn < 3; turn++) { ask(bare); ask(stranger); ask(full); }\n' % made + tail
            open('%s/%s.%s.%s.ts' % (out, maker, use, stranger), 'w').write(s); n += 1
print(n, 'programs')
