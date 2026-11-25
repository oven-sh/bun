#!/usr/bin/env python3
# generate-objects-made-below-whatever-comes.py <folder>: all 819; ../parallel/objects-made-below-whatever-comes/ holds 8 of them: `Object.create(above)` where the compiler knows nothing of `above`: one kind of operand, one road by which it comes and one thing done with what is made: one program each, held to `bun <file>`.
# The operand comes out of a pool with an object, null and a number, so that nothing is proven of it. Below an object and below null an object is made; everything else is refused with a TypeError. A second operand that is not undefined describes properties.
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
operands = [
 ('a-plain-object', '{ a: 1, get b() { return this.a + 1; }, set c(value) { this.stored = value; } }'),
 ('null', 'null'),
 ('undefined', 'undefined'),
 ('a-number', '5'),
 ('a-fraction', '2.5'),
 ('a-text', '"text"'),
 ('an-empty-text', '""'),
 ('true', 'true'),
 ('a-symbol', 'Symbol("s")'),
 ('a-bigint', '10n'),
 ('a-large-bigint', '123456789012345678901234567890n'),
 ('a-function', 'function named() { return 1; }'),
 ('an-arrow', '() => 1'),
 ('a-class', 'class Above { static a = 1; }'),
 ('an-instance-of-a-class', 'new (class Point { constructor() { this.a = 1; } get b() { return this.a + 1; } })()'),
 ('a-list', '[1, 2, 3]'),
 ('a-proxy', 'new Proxy({ a: 1 }, { get(target, key, receiver) { return key === "a" ? 41 : Reflect.get(target, key, receiver); } })'),
 ('a-revoked-proxy', '(() => { const made = Proxy.revocable({}, {}); made.revoke(); return made.proxy; })()'),
 ('the-prototype-of-objects', 'Object.prototype'),
 ('the-prototype-of-lists', 'Array.prototype'),
 ('the-prototype-of-maps', 'Map.prototype'),
 ('the-prototype-of-functions', 'Function.prototype'),
 ('a-frozen-object', 'Object.freeze({ a: 1 })'),
 ('an-object-below-null', 'Object.create(null)'),
 ('an-object-made-so-itself', 'Object.create(Object.create({ a: 1 }))'),
 ('a-date', 'new Date(0)'),
 ('a-map', 'new Map([[1, 2]])'),
 ('a-regular-expression', '/a/g'),
 ('a-bound-function', '(function () { return this; }).bind(7)'),
 ('an-arguments-object', '(function () { return arguments; })(1, 2)'),
 ('a-wrapped-number', 'new Number(5)'),
 ('an-error', 'new Error("e")'),
 ('a-typed-array', 'new Uint8Array(2)'),
 ('a-promise', 'Promise.resolve(1)'),
]
roads = [
 ('out-of-a-field', 'function make(holder) { return Object.create(holder.above); }', 'make({ above: operand() })'),
 ('as-a-parameter', 'function make(above) { return Object.create(above); }', 'make(operand())'),
 ('out-of-a-list', 'function make(list, at) { return Object.create(list[at]); }', 'make([0, operand()], 1)'),
 ('with-undefined-behind-it', 'function make(above) { return Object.create(above, undefined); }', 'make(operand())'),
 ('with-properties-behind-it', 'function make(above, properties) { return Object.create(above, properties); }', 'make(operand(), { own: { value: 9, enumerable: true } })'),
 ('with-null-behind-it', 'function make(above, properties) { return Object.create(above, properties); }', 'make(operand(), null)'),
]
uses = [
 ('what-stands-above', '(() => { const above = operand.last; return (Object.getPrototypeOf(made) === above) + " " + Object.keys(made).join() + " " + typeof made; })()'),
 ('reads-and-stores', '(() => { const before = String(made.a) + String(made.b); made.a = 10; made.c = 3; return before + " " + made.a + " " + String(made.b) + " " + Object.keys(made).join(); })()'),
 ('many-names', '(() => { for (let i = 0; i < 12; i++) made["n" + i] = i; let sum = 0; for (const name in made) if (Object.prototype.hasOwnProperty.call(made, name)) sum += made[name] === undefined ? 0 : 1; return sum + " " + made.n11; })()'),
 ('written', '(() => { made.own2 = 1; return JSON.stringify(made) + " " + Object.prototype.toString.call(made) + " " + ("a" in made) + " " + ("toString" in made); })()'),
]
count = 0
for name, operand in operands:
    for road, maker, call in roads:
        for use, expression in uses:
            program = f'''// Made by test/aot/tools/generate-objects-made-below-whatever-comes.py.
let at = 0;
function operand() {{
  const pool = [{operand}, {{ a: 7 }}, null, 0.5];
  return (operand.last = pool[at]);
}}
{maker}
function used() {{
  const made = {call};
  return {expression};
}}
function safely() {{
  try {{
    return String(used());
  }} catch (error) {{
    return "thrown: " + error.name + (/^(Array length|Object prototype|Property description)/.test(error.message) ? ": " + error.message : "");
  }}
}}
for (let turn = 0; turn < 8; turn++) {{
  at = turn & 3;
  console.log(safely());
}}
'''
            open(f'{out}/{name}-{road}-{use}.js', 'w').write(program); count += 1
# Several operands by turns at one place: what is kept for one must not answer for another.
turns = [('objects-by-turns', '[{ a: 1 }, { a: 2 }, { a: 3 }, null, { a: 4 }]'), ('objects-and-what-is-refused-by-turns', '[{ a: 1 }, 5, null, "t", { a: 2 }, undefined, [7]]'), ('many-objects-by-turns', 'Array.from({ length: 300 }, (_, at) => ({ a: at }))')]
for name, listed in turns:
    program = f'''// Made by test/aot/tools/generate-objects-made-below-whatever-comes.py.
const above = {listed};
function make(holder) {{ return Object.create(holder.above); }}
function safely(holder) {{
  try {{
    const made = make(holder);
    return (Object.getPrototypeOf(made) === holder.above) + " " + made.a;
  }} catch (error) {{
    return "thrown: " + error.name + (/^(Array length|Object prototype|Property description)/.test(error.message) ? ": " + error.message : "");
  }}
}}
let printed = "";
for (let turn = 0; turn < 3; turn++) for (let at = 0; at < above.length; at++) printed += safely({{ above: above[at] }}) + ";";
console.log(printed);
'''
    open(f'{out}/{name}.js', 'w').write(program); count += 1
print(count, 'programs')
