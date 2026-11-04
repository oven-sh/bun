#!/usr/bin/env python3
# generate-lone-calls-of-built-in-methods.py <folder>: one call of a method of a built-in class, alone in a function that is called by value, on a receiver whose class is WRITTEN and not proven: what comes is what is written, or lies: one program each, held to `bun <file>`.
# The compiler tests what comes and puts the code of the method in line behind the test. Whatever fails the test goes the way of any call by name: an own method, a method of a class below, another prototype, a proxy, another class, nothing at all.
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
lists = [
 ('pop', 'list.pop()'), ('shift', 'list.shift()'), ('push', 'list.push(7)'), ('push-of-a-call', 'list.push(next())'), ('unshift', 'list.unshift(7)'),
 ('splice-that-inserts', 'list.splice(1, 0, 7)'), ('splice-that-removes', 'list.splice(0, 1)'), ('splice-unread', '(list.splice(1, 0, 7), 0)'), ('slice', 'list.slice(1)'), ('index-of', 'list.indexOf(2)'),
 ('includes', 'list.includes(2)'), ('join', 'list.join("-")'), ('at', 'list.at(-1)'), ('concat', 'list.concat([9])'), ('reverse', 'list.reverse()'), ('to-reversed', 'list.toReversed()'),
]
listReceivers = [
 ('a-list', '[1, 2, 3]'), ('an-empty-list', '[]'), ('a-list-of-fractions', '[1.5, 2, 3.5]'), ('a-list-of-texts', '["a", "b"]'), ('a-list-with-a-hole', '[1, , 3]'),
 ('a-frozen-list', 'Object.freeze([1, 2, 3])'), ('a-list-with-its-own-method', 'own([1, 2, 3])'), ('a-list-below-another-prototype', 'Object.setPrototypeOf([1, 2, 3], other)'),
 ('an-instance-of-a-class-below', 'Below.from([1, 2, 3])'), ('a-proxy-of-a-list', 'new Proxy([1, 2, 3], {})'), ('an-object-like-a-list', '({ length: 2, 0: 1, 1: 2, __proto__: Array.prototype })'),
 ('an-object-with-the-methods', 'speaking'), ('a-typed-array', 'new Uint8Array([1, 2, 3])'), ('a-text', '"123"'), ('null', 'null'), ('undefined', 'undefined'), ('a-long-list', 'Array.from({ length: 200 }, (_, at) => at)'),
 ('a-list-with-a-fixed-length', 'Object.defineProperty([1, 2, 3], "length", { writable: false })'), ('a-sealed-list', 'Object.seal([1, 2, 3])'),
]
texts = [
 ('char-code-at', 'text.charCodeAt(1)'), ('char-at', 'text.charAt(1)'), ('substring', 'text.substring(1, 3)'), ('slice', 'text.slice(-2)'), ('index-of', 'text.indexOf("b")'),
 ('starts-with', 'text.startsWith("a")'), ('ends-with', 'text.endsWith("c")'), ('to-lower-case', 'text.toLowerCase()'), ('trim', 'text.trim()'), ('code-point-at', 'text.codePointAt(0)'), ('includes', 'text.includes("b")'),
]
textReceivers = [
 ('a-text', '"abc"'), ('an-empty-text', '""'), ('a-wide-text', '"\\u4f60b\\u597d"'), ('a-joined-text', '"ab".concat(String(turn), "c")'), ('a-wrapped-text', 'new String("abc")'), ('a-number', '5'),
 ('a-list', '["a", "b", "c"]'), ('an-object-with-the-methods', 'speaking'), ('null', 'null'), ('undefined', 'undefined'), ('a-wrapped-text-with-its-own-method', 'own(new String("abc"))'),
]
maps = [
 ('get', 'map.get("a")'), ('has', 'map.has("a")'), ('set', 'map.set("b", 2).size'), ('set-of-a-call', 'map.set("b", next()).size'), ('delete', 'map.delete("a")'), ('clear', '(map.clear(), map.size)'), ('values', 'typeof map.values().next'),
]
mapReceivers = [
 ('a-map', 'new Map([["a", 1]])'), ('an-empty-map', 'new Map()'), ('a-map-with-its-own-method', 'own(new Map([["a", 1]]))'), ('an-instance-of-a-class-below', 'new BelowMap([["a", 1]])'), ('a-map-below-another-prototype', 'Object.setPrototypeOf(new Map([["a", 1]]), other)'),
 ('a-weak-map', 'new WeakMap()'), ('a-set', 'new Set(["a"])'), ('an-object-with-the-methods', 'speaking'), ('a-proxy-of-a-map', 'new Proxy(new Map([["a", 1]]), {})'), ('null', 'null'), ('undefined', 'undefined'),
]
numbers = [('to-string', 'number.toString()'), ('to-string-of-a-radix', 'number.toString(16)'), ('to-fixed', 'number.toFixed(1)')]
numberReceivers = [('an-integer', '255'), ('a-fraction', '2.5'), ('not-a-number', 'NaN'), ('minus-zero', '-0'), ('a-wrapped-number', 'new Number(7)'), ('a-bigint', '255n'), ('a-text', '"255"'), ('an-object-with-the-methods', 'speaking'), ('null', 'null')]
groups = [('list', 'number[]', lists, listReceivers), ('text', 'string', texts, textReceivers), ('map', 'Map<string, number>', maps, mapReceivers), ('number', 'number', numbers, numberReceivers)]
count = 0
for parameter, written, methods, receivers in groups:
    for method, call in methods:
        name = call.split('.')[1].split('(')[0] if '.' in call else method
        name = call[call.index(parameter + '.') + len(parameter) + 1:].split('(')[0].split(')')[0].split(',')[0].split('.')[0]
        for receiver, made in receivers:
            program = f'''// Made by test/aot/tools/generate-lone-calls-of-built-in-methods.py.
let calls = 0;
let turn = 0;
function next(): number {{ calls++; return 40 + calls; }}
function own<T extends object>(value: T): T {{ (value as any).{name} = function () {{ calls++; return "own"; }}; return value; }}
const speaking: any = new Proxy({{}}, {{ get(_, key) {{ return typeof key === "symbol" ? undefined : key === "size" || key === "length" ? 1 : () => {{ calls++; return "spoken " + String(key); }}; }} }});
const other: any = {{ {name}() {{ calls++; return "other"; }} }};
class Below extends Array<number> {{ {name}(...all: any[]): any {{ calls++; return "below"; }} }}
class BelowMap extends Map<string, number> {{ {name if name != "size" else "sized"}(...all: any[]): any {{ calls++; return "below"; }} }}
const handlers = {{
  asked({parameter}: {written}) {{
    return {call};
  }},
}};
const names: ("asked")[] = ["asked"];
function shown(value: unknown): string {{
  return Array.isArray(value) ? "[" + value.join() + "]" : String(value);
}}
function safely(value: any): string {{
  try {{
    const answer = shown(handlers[names[0]](value));
    return answer + " | " + (value === null || value === undefined || typeof value !== "object" || value === speaking ? "" : Array.isArray(value) ? shown(value) + value.length : value instanceof Map ? String(value.size) : "");
  }} catch (error: any) {{
    return "thrown: " + error.name;
  }}
}}
for (turn = 0; turn < 3; turn++) console.log(safely({made}), calls);
'''
            open(f'{out}/{parameter}-{method}-on-{receiver}.ts', 'w').write(program); count += 1
print(count, 'programs')
