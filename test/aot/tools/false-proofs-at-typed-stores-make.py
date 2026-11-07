#!/usr/bin/env python3
"""false-proofs-at-typed-stores-make.py <folder>: one-shape programs (TypeScript): A VALUE OF WHICH Link PROVES TOO MUCH COMES TO A TYPED STORE. THE LIE: --aot-testing=UnseenCodeAnswersUndefined: what unseen code gives counts as undefined, so it "fits" every slot that admits undefined,
and the walk stores it typed with no test, while an object of another class, a text, a fraction .. arrives. Then compiled code reads the slot as what it is held to.
the road from the false proof to the store x what the slot is held to x what arrives. WITHOUT THE LIE EVERY PROGRAM IS RIGHT. Made-up names.
FOUR ROADS BITE: behind a test of the type (there the whole test makes the program right), through a result, through a variable of the module, through a slot of another object. ON SIX THE LIE CHANGES NOTHING: straight from the call, through a local, a join, a loop,
listed by an allocation, in a literal: there the walk sees the call itself, knows nothing of what it gives, and the store tests. TWO ARE STOPPED AT AN ENTRY: through a capture, through a parameter.
They stay in the family: a road that begins to bite shows here first. Run by ./false-proofs-at-typed-stores.sh."""
import os, sys, itertools
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
SLOTS = {   # the written type, a value that fits, how a typed reader uses it
 'a-leaf': ('Leaf | undefined', 'new Leaf()', 'h.held === undefined ? "none" : String(h.held.kind + 1) + h.held.name.length'),
 'a-number': ('number | undefined', '4.5', 'h.held === undefined ? "none" : String(h.held * 2)'),
 'a-text': ('string | undefined', '"fits"', 'h.held === undefined ? "none" : String(h.held.length) + h.held'),
 'a-list': ('number[] | undefined', '[1, 2]', 'h.held === undefined ? "none" : String(h.held.length)'),
}
TESTS = { 'a-leaf': 'v instanceof Leaf', 'a-number': 'typeof v === "number"', 'a-text': 'typeof v === "string"', 'a-list': 'Array.isArray(v)' }
ARRIVES = { 'an-object-of-another-class': 'new Other()', 'a-text': '"smuggled"', 'a-fraction': '0.25', 'an-integer': '7', 'a-plain-object': '{ z: 1 }', 'a-list': '["a"]', 'null': 'null', 'a-boolean': 'true' }
ROADS = {
 'straight-from-the-call': 'function deed(h: Holder, i: number): void { h.held = pass(given[i]); }',
 'through-a-local': 'function deed(h: Holder, i: number): void { const v = pass(given[i]); sink(i); h.held = v; }',
 'through-a-variable-of-the-module': 'let kept: any; function fill(i: number): void { kept = pass(given[i]); }\nfunction deed(h: Holder, i: number): void { fill(i); h.held = kept; }',
 'through-a-capture': 'function maker(i: number): (h: Holder) => void { const v = pass(given[i]); return (h: Holder) => { h.held = v; }; }\nfunction deed(h: Holder, i: number): void { maker(i)(h); }',
 'through-a-parameter': 'function put(h: Holder, v: any): void { for (let k = 0; k < 1; k++) h.held = v; }\nfunction deed(h: Holder, i: number): void { put(h, pass(given[i])); }',
 'through-a-result': 'function get(i: number): any { for (let k = 0; k < 1; k++) sink(k); return pass(given[i]); }\nfunction deed(h: Holder, i: number): void { h.held = get(i); }',
 'through-a-join': 'function deed(h: Holder, i: number): void { let v: any; if (i % 2) v = pass(given[i]); else v = pass(given[i]); h.held = v; }',
 'through-a-loop': 'function deed(h: Holder, i: number): void { let v: any = undefined; for (let k = 0; k < 2; k++) v = pass(given[i]); h.held = v; }',
 'through-a-slot-of-another-object': 'class Carrier { load: any = undefined; }\nfunction deed(h: Holder, i: number): void { const c = new Carrier(); c.load = pass(given[i]); sink(c); h.held = c.load; }',
 'behind-a-test-of-the-type': 'function get(i: number): any { for (let k = 0; k < 1; k++) sink(k); if (i === 0) return %(fits)s; return pass(given[i]); }\nfunction deed(h: Holder, i: number): void { const v = get(i); if (%(test)s) h.held = v; }',
 'listed-by-an-allocation': 'function deed(h: Holder, i: number): void { const made: Holder = new Holder(pass(given[i])); h.held = made.held; }',
 'in-a-literal': 'interface Bag { held: %(written)s; more: number }\nfunction readBag(b: Bag): string { const h = b; let s = ""; for (let k = 0; k < 2; k++) s += %(use)s; return s; }\nfunction deed(h: Holder, i: number): void { const b: Bag = { held: pass(given[i]), more: 1 }; said.push(readBag(keep(b))); }',
}
n = 0
for (sn, (written, fits, use)), (an, arrives), (rn, road) in itertools.product(SLOTS.items(), ARRIVES.items(), ROADS.items()):
    if (sn, an) in (('a-text', 'a-text'), ('a-number', 'a-fraction'), ('a-number', 'an-integer'), ('a-list', 'a-list')): continue
    program = '''const pass = (0, eval)("(x) => x") as (x: any) => any;
const keep = <T,>(x: T): T => [x][JSON.parse("0")];
const sunk: unknown[] = []; function sink(x: unknown): void { if (sunk.length < 2) sunk.push(x); }
class Leaf { kind = 1; name = "leaf"; }
class Other { a = "text"; b = 2.5; c = [1]; }
class Holder { held: %(written)s; constructor(first?: any) { this.held = first; } }
const said: string[] = [];
const given: any[] = [%(fits)s, %(arrives)s, undefined];
function read(h: Holder): string { let s = ""; for (let k = 0; k < 2; k++) s += %(use)s; return s; }
%(road)s
for (let turn = 0; turn < 60; turn++) { const h = keep(new Holder()); let s: string; try { deed(h, turn %% 3); s = read(h); } catch (e: any) { s = "threw " + e.constructor.name; } if (!said.includes(s)) said.push(s); }
console.log(said.join(" | "));
''' % { 'written': written, 'fits': fits, 'arrives': arrives, 'use': use, 'road': road % { 'written': written, 'use': use, 'fits': fits, 'test': TESTS[sn] } if '%(' in road else road }
    open(os.path.join(out, '%s--%s--%s.ts' % (rn, sn, an)), 'w').write(program); n += 1
print(n, 'programs')
