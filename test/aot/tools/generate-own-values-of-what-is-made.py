# generate-own-values-of-what-is-made.py <outdir>: THE RULE BEHIND born-with-names.py: whatever native code makes is born with own properties, and each of them comes out by every road that reads own values or own keys.
# maker x position among the own values x road x use. ONE DEED A PROGRAM. No use prints a value that differs from run to run. Every program prints what plain Bun prints.
import sys, os
out = sys.argv[1]
os.makedirs(out, exist_ok=True)

# name: (the object that is made, how many of its own values are looked at)
makers = {
 'group-by':                 ('Object.groupBy([V, V], (x, i) => (i ? "a" : "b"))', 2),
 'from-entries':             ('Object.fromEntries([["a", V], ["b", 1]])', 2),
 'pair-of-entries':          ('Object.entries({ a: V })[0]', 2),
 'pair-of-entries-of-text':  ('Object.entries("ab")[1]', 2),
 'descriptor-of-data':       ('Object.getOwnPropertyDescriptor({ a: V }, "a")', 4),
 'descriptor-of-accessor':   ('Object.getOwnPropertyDescriptor({ get a() { return V; } }, "a")', 4),
 'descriptor-by-reflect':    ('Reflect.getOwnPropertyDescriptor({ a: V }, "a")', 4),
 'descriptors':              ('Object.getOwnPropertyDescriptors({ a: V, b: 1 })', 2),
 'step-of-entries':          ('[V].entries().next()', 2),
 'step-of-values':           ('[V].values().next()', 2),
 'step-of-keys':             ('[V].keys().next()', 2),
 'step-at-the-end':          ('[].values().next()', 2),
 'pair-of-a-list':           ('[V].entries().next().value', 2),
 'pair-of-a-map':            ('new Map([["k", V]]).entries().next().value', 2),
 'pair-of-a-set':            ('new Set([V]).entries().next().value', 2),
 'step-of-a-map':            ('new Map([["k", V]]).values().next()', 2),
 'step-of-a-generator':      ('(function* () { yield V; })().next()', 2),
 'step-of-a-helper':         ('Iterator.from([V]).take(1).next()', 2),
 'step-of-a-text':           ('"ab"[Symbol.iterator]().next()', 2),
 'step-of-match-all':        ('"xa".matchAll(/(a)/g).next()', 2),
 'match-of-match-all':       ('"xa".matchAll(/(a)/g).next().value', 5),
 'match':                    ('/(a)/.exec("xa")', 5),
 'indices-of-a-match':       ('/(?<n>a)/d.exec("xa").indices', 3),
 'settled-fulfilled':        ('(await Promise.allSettled([Promise.resolve(V)]))[0]', 2),
 'settled-rejected':         ('(await Promise.allSettled([Promise.reject(V)]))[0]', 2),
 'with-resolvers':           ('Promise.withResolvers()', 3),
 'revocable':                ('Proxy.revocable({}, {})', 2),
 'part-of-a-date':           ('new Intl.DateTimeFormat("en").formatToParts(0)[0]', 2),
 'part-of-a-number':         ('new Intl.NumberFormat("en").formatToParts(1.5)[0]', 2),
 'part-of-a-list':           ('new Intl.ListFormat("en").formatToParts(["a", "b"])[0]', 2),
 'options-of-a-format':      ('new Intl.NumberFormat("en").resolvedOptions()', 6),
 'options-of-a-collator':    ('new Intl.Collator("en").resolvedOptions()', 5),
 'segment':                  ('[...new Intl.Segmenter("en").segment("ab")][0]', 3),
 'clone':                    ('structuredClone({ a: { x: 1 }, b: [1], c: "s", d: 1 })', 4),
 'clone-of-a-list':          ('structuredClone([{ x: 1 }, "s", 1, null])', 4),
 'parsed':                   ('JSON.parse(\'{"a":1,"b":"x","c":[1],"d":{"e":null},"f":null,"g":true}\')', 6),
 'parsed-list':              ('JSON.parse(\'[1,"x",null,{"a":1},[2],false]\')', 6),
 'parsed-with-a-reviver':    ('JSON.parse(\'{"a":1,"b":"x"}\', (k, v) => (k === "a" ? V : v))', 2),
 'assigned-below-null':      ('Object.assign(Object.create(null), { a: V, b: 1 })', 2),
 'split-with-captures':      ('"a1b".split(/(\\d)|(x)/)', 4),
 'from-array-like':          ('Array.from({ length: 2, 0: V })', 2),
 'array-of':                 ('Array.of(V, 1)', 2),
 'wait-async':               ('Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(8)), 0, 1)', 2),
 'error-with-a-cause':       ('new Error("m", { cause: V })', 4),
 'type-error':               ('new TypeError("m")', 3),
 'aggregate-error':          ('new AggregateError([V], "m")', 4),
 'suppressed-error':         ('new SuppressedError(V, 1, "m")', 4),
 'caught-error':             ('caught(() => null.x)', 3),
 'arguments':                ('(function () { return arguments; })(V, 1)', 3),
 'strict-arguments':         ('(function () { "use strict"; return arguments; })(V, 1)', 3),
 'template':                 ('(s => s)`a${1}b`', 4),
 'boxed-text':               ('new String("ab")', 3),
 'object-of-a-text':         ('Object("ab")', 3),
 'bytes':                    ('new Uint8Array([1, 2])', 2),
 'regexp':                   ('/a/g', 1),
 'function':                 ('function named(a, b) {}', 3),
 'arrow':                    ('(a) => a', 2),
 'class':                    ('class Named { static s = V; }', 4),
 'bound':                    ('(function named(a) {}).bind(null)', 2),
 'pair-of-search-params':    ('new URLSearchParams("a=1").entries().next().value', 2),
 'step-of-search-params':    ('new URLSearchParams("a=1").entries().next()', 2),
 'spread-search-params':     ('[...new URLSearchParams("a=1&b=2")][1]', 2),
 'pair-of-headers':          ('new Headers({ a: "1" }).entries().next().value', 2),
 'json-of-headers':          ('new Headers({ a: "1" }).toJSON()', 1),
 'pair-of-form-data':        ('formData().entries().next().value', 2),
 'json-of-a-buffer':         ('Buffer.from("ab").toJSON()', 2),
 'encoded-into':             ('new TextEncoder().encodeInto("a", new Uint8Array(2))', 2),
 'parsed-path':              ('path.parse("/a/b.c")', 5),
 'parsed-query':             ('querystring.parse("a=1&b=2&b=3")', 2),
 'parsed-args':              ('util.parseArgs({ args: ["-a"], options: { a: { type: "boolean", short: "a" } } })', 2),
 'memory-usage':             ('process.memoryUsage()', 5),
 'hrtime':                   ('process.hrtime()', 2),
 'cpu-usage':                ('process.cpuUsage()', 2),
 'versions':                 ('process.versions', 3),
 'stats':                    ('fs.statSync(".")', 6),
 'directory-entry':          ('fs.readdirSync("/", { withFileTypes: true })[0]', 2),
 'cpu':                      ('os.cpus()[0]', 3),
 'user-info':                ('os.userInfo()', 5),
 'mark':                     ('performance.mark("a").toJSON()', 4),
 'event':                    ('new Event("e")', 1),
 'emitter':                  ('new EventEmitter()', 3),
 'inspected-options':        ('util.inspect.defaultOptions', 4),
 'spawned':                  ('child.spawnSync("true")', 5),
}
roads = {
 'values':         'Object.values(m)',
 'entries':        'Object.entries(m).map(p => p[1])',
 'assign':         'Object.values(Object.assign({}, m))',
 'spread':         'Object.values({ ...m })',
 'for-in':         'listByForIn(m)',
 'keys':           'Object.keys(m).map(k => m[k])',
 'own-names':      'Object.getOwnPropertyNames(m).map(k => m[k])',
 'own-keys':       'Reflect.ownKeys(m).map(k => m[k])',
 'descriptors':    'Object.values(Object.getOwnPropertyDescriptors(m)).map(d => d.value)',
 'from-entries':   'Object.values(Object.fromEntries(Object.entries(m)))',
 'map-of-entries': '[...new Map(Object.entries(m)).values()]',
}
uses = [
 'typeof e',
 'e == null',
 'Array.isArray(e)',
 'e === undefined ? "u" : e === null ? "n" : typeof e === "number" ? e + 1 > e || e !== e : typeof e === "string" ? e.length >= 0 : typeof e === "boolean" ? !e !== e : typeof e === "function" ? typeof e.name : typeof Object.keys(e).length',
 'e instanceof Object',
]
head = '''import path from "node:path";
import url from "node:url";
import querystring from "node:querystring";
import util from "node:util";
import fs from "node:fs";
import os from "node:os";
import child from "node:child_process";
import { EventEmitter } from "node:events";
class P { x = 1; }
const V = new P();
function caught(deed) { try { deed(); } catch (error) { return error; } }
function formData() { const data = new FormData(); data.append("a", "1"); return data; }
function listByForIn(o) { const list = []; for (const k in o) list.push(o[k]); return list; }
'''
imports = { 'path.': 'import path from "node:path";', 'url.': 'import url from "node:url";', 'querystring.': 'import querystring from "node:querystring";', 'util.': 'import util from "node:util";', 'fs.': 'import fs from "node:fs";',
            'os.': 'import os from "node:os";', 'child.': 'import child from "node:child_process";', 'EventEmitter': 'import { EventEmitter } from "node:events";' }
count = 0
for maker, (made, positions) in makers.items():
    for road, way in roads.items():
        for position in range(positions):
            for number, use in enumerate(uses):
                lines = ['// Own value %d of what is made (%s) comes out by %s.' % (position, maker.replace('-', ' '), road.replace('-', ' '))]
                lines += [line for word, line in imports.items() if word in made]
                if 'V' in made.replace('URLSearchParams', '').replace('Event', ''): lines += ['class P { x = 1; }', 'const V = new P();']
                if 'caught(' in made: lines.append('function caught(deed) { try { deed(); } catch (error) { return error; } }')
                if 'formData(' in made: lines.append('function formData() { const data = new FormData(); data.append("a", "1"); return data; }')
                if road == 'for-in': lines.append('function listByForIn(o) { const list = []; for (const k in o) list.push(o[k]); return list; }')
                lines += ['function use(e) { return %s; }' % use, 'const m = %s;' % made, 'try { console.log(use(%s[%d])); } catch (error) { console.log(error.constructor.name); }' % (way, position)]
                with open(os.path.join(out, '%s-%s-%d-%d.mjs' % (maker, road, position, number)), 'w') as f:
                    f.write('\n'.join(lines) + '\n')
                count += 1
print(count, 'programs')
