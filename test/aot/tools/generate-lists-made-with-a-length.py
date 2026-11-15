#!/usr/bin/env python3
# generate-lists-made-with-a-length.py <folder>: all 600; ../parallel/lists-made-with-a-length/ holds 8 of them: `new Array(n)` and `Array(n)`: one way for the length to come and one thing done with the list: one program each, held to `bun <file>`.
# A list made so has holes, not elements: they are in no key list, `in` denies them, forEach passes them by, join and JSON.stringify write them in their own ways. What is no length is refused with a RangeError.
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
makers = [
 ('constructed-with-an-int32', 'function make(n) { return new Array(n | 0); }'),
 ('called-with-an-int32', 'function make(n) { return Array(n | 0); }'),
 ('constructed-with-a-uint32', 'function make(n) { return new Array(n >>> 0); }'),
 ('constructed-with-the-number-of-arguments', 'function counted() { return new Array(arguments.length); }\nfunction make(n) { return n === 0 ? counted() : n === 1 ? counted(1) : n === 2 ? counted(1, 2) : n === 3 ? counted(1, 2, 3) : counted(1, 2, 3, 4); }'),
 ('constructed-with-fewer-than-the-arguments', 'function counted() { return new Array(arguments.length - 2); }\nfunction make(n) { return n === 0 ? counted(1, 2) : n === 1 ? counted(1, 2, 3) : n < 0 ? counted(1) : counted(1, 2, 3, 4, 5); }'),
 ('constructed-with-the-length-of-a-text', 'function make(n) { return new Array("abcdefghij".slice(0, n < 0 ? 0 : n).length); }'),
 ('constructed-with-the-length-of-a-list', 'function make(n) { const model = []; for (let i = 0; i < n && i < 50; i++) model.push(i); return new Array(model.length); }'),
 ('constructed-with-a-difference', 'function make(n) { return new Array((n | 0) - 2); }'),
 ('constructed-with-a-product', 'function make(n) { return new Array((n | 0) * 2); }'),
 ('constructed-with-a-sum-past-int32', 'function make(n) { return new Array((n >>> 0) + (n >>> 0)); }'),
 ('constructed-with-a-floor', 'function make(n) { return new Array(Math.floor(n / 2)); }'),
 ('constructed-with-a-number-as-it-comes', 'function make(n) { return new Array(+n); }'),
 ('constructed-with-whatever-comes', 'function make(n) { return new Array(n); }'),
 ('constructed-with-three-written', 'function make(n) { return new Array(3); }'),
 ('constructed-with-none-written', 'function make(n) { return new Array(0); }'),
 ('constructed-with-nine-written', 'function make(n) { return Array(9); }'),
 ('constructed-below-the-class', 'class Below extends Array {}\nfunction make(n) { return new Below(n | 0); }'),
 ('constructed-by-reflection', 'function make(n) { return Reflect.construct(Array, [n | 0]); }'),
 ('constructed-for-another-class', 'class Other {}\nfunction make(n) { return Reflect.construct(Array, [n | 0], Other); }'),
 ('constructed-in-a-loop', 'function make(n) { let last; for (let i = 0; i < 3; i++) last = new Array((n | 0) + i - 2); return last; }'),
]
small = '[0, 1, 2, 3, 4, 7, 8, 9, 33, 100]'
wide = '[-1, -2147483648, 0, 1, 3, 8, 9, 1000, 5000, 99999, 100000, 100001, 2147483647, 4294967295, 4294967296, 2.5, -0, NaN, Infinity]'
uses = [
 ('its-length', wide, 'list.length'),
 ('a-hole-is-asked-for', wide, '(0 in list) + " " + list[0] + " " + Object.prototype.hasOwnProperty.call(list, 0) + " " + list.at(-1)'),
 ('stores-at-both-ends', small, '(list[0] = "a", list[list.length ? list.length - 1 : 0] = "z", list[0] + list[list.length - 1] + list.length)'),
 ('filled-with-integers', small, '(() => { for (let i = 0; i < list.length; i++) list[i] = i * 3; let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i]; return sum; })()'),
 ('filled-with-fractions', small, '(() => { for (let i = 0; i < list.length; i++) list[i] = i + 0.5; let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i]; return sum; })()'),
 ('filled-with-texts', small, '(() => { for (let i = 0; i < list.length; i++) list[i] = "t" + i; return list.join("|"); })()'),
 ('filled-with-objects', small, '(() => { for (let i = 0; i < list.length; i++) list[i] = { at: i }; let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i].at; return sum; })()'),
 ('filled-from-the-end', small, '(() => { for (let i = list.length - 1; i >= 0; i--) list[i] = i; return list.join(); })()'),
 ('every-second-filled', small, '(() => { for (let i = 0; i < list.length; i += 2) list[i] = i; return JSON.stringify(list) + Object.keys(list).join(); })()'),
 ('pushed-onto', small, '(list.push("more"), list.length + " " + list[list.length - 1] + " " + (0 in list))'),
 ('joined', small, 'list.join("-")'),
 ('written-as-json', small, 'JSON.stringify(list)'),
 ('walked-by-for-each', small, '(() => { let seen = 0; list.forEach(() => seen++); return seen; })()'),
 ('its-keys', small, 'Object.keys(list).length + " " + Object.getOwnPropertyNames(list).join()'),
 ('searched-for-undefined', small, 'list.indexOf(undefined) + " " + list.includes(undefined) + " " + list.findIndex(item => item === undefined)'),
 ('filled-by-fill', small, 'list.fill(7).reduce((sum, item) => sum + item, 0)'),
 ('stored-past-its-length', small, '(list[list.length + 3] = 1, list.length + " " + Object.keys(list).join())'),
 ('cut-to-nothing', small, '(list.length = 0, list.push(1), list.join() + list.length)'),
 ('lengthened', small, '(list.length = list.length + 2, list.length + " " + (list.length - 1 in list))'),
 ('what-it-is', wide, 'Array.isArray(list) + " " + (list.constructor === Array) + " " + (Object.getPrototypeOf(list) === Array.prototype) + " " + Object.prototype.toString.call(list)'),
 ('reversed-and-sorted', small, '(list[0] = 2, list.reverse(), list.sort(), JSON.stringify(list))'),
 ('spread', small, '(() => { const copy = [...list]; return copy.length + " " + (0 in copy) + " " + copy.every(item => item === undefined); })()'),
 ('mapped', small, '(() => { const mapped = list.map(() => 1); return mapped.length + " " + (0 in mapped); })()'),
 ('joined-to-another', small, '(() => { const both = list.concat([1], new Array(2)); return both.length + " " + Object.keys(both).join(); })()'),
 ('popped-and-shifted', small, 'list.pop() + " " + list.shift() + " " + list.length'),
 ('walked-by-for-in', small, '(() => { list[1] = 1; let names = ""; for (const name in list) names += name; return names + list.length; })()'),
 ('walked-by-for-of', small, '(() => { let seen = 0; for (const item of list) seen += item === undefined ? 1 : 100; return seen; })()'),
 ('frozen', small, '(() => { Object.freeze(list); try { "use strict"; list[0] = 1; } catch (error) { return error.name; } return (0 in list) + " " + Object.isFrozen(list); })()'),
 ('given-a-name', small, '(list.tag = "t", Object.keys(list).join() + list.length)'),
 ('two-of-them', small, '(() => { const other = make(n); other[0] = 1; return (0 in list) + " " + (list === other) + " " + other.length; })()'),
]
count = 0
for maker, text in makers:
    for use, lengths, expression in uses:
        program = f'''// Made by test/aot/tools/generate-lists-made-with-a-length.py.
{text}
function used(n) {{
  const list = make(n);
  return {expression};
}}
function safely(n) {{
  try {{
    return String(used(n));
  }} catch (error) {{
    return "thrown: " + error.name + (/^(Array length|Object prototype|Property description)/.test(error.message) ? ": " + error.message : "");
  }}
}}
const lengths = {lengths};
for (let turn = 0; turn < 2; turn++) for (let i = 0; i < lengths.length; i++) console.log(lengths[i], safely(lengths[i]));
'''
        open(f'{out}/{maker}-{use}.js', 'w').write(program); count += 1
print(count, 'programs')
