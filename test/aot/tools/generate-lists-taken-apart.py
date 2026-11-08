# generate-lists-taken-apart.py <outdir>: a row takes a list apart and stores its ELEMENTS (flatMap, flat, concat, from, a spread). The list is one that nobody follows: native code made it, a class of the program, a proxy.
# maker x road x use. ONE DEED A PROGRAM. Every program prints what plain Bun prints.
import sys, os
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
makers = {
 'clone': 'structuredClone([1, 2])', 'parsed': 'JSON.parse("[1, 2]")', 'of-a-class': 'Stack.of(1, 2)', 'new-of-a-class': 'filled(new Stack())', 'proxy': 'new Proxy([1, 2], {})', 'proxy-of-a-class': 'new Proxy(Stack.of(1, 2), {})',
 'constructed-below': 'filled(Reflect.construct(Array, [], Stack))', 'values': 'Object.values({ a: 1, b: 2 })', 'literal': '[1, 2]', 'of-a-parameter': 'handedOn(structuredClone([1, 2]))', 'from-a-map': '[...new Map([[1, 2]]).keys()]',
 'species': 'Stack.of(1, 2).map(x => x)', 'buffer-json': 'Buffer.from([1, 2]).toJSON().data', 'one-of-two': '(Date.now() > 0 ? structuredClone([1, 2]) : [{}])',
}
roads = {
 'flat-map': '[0].flatMap(() => m)', 'flat': '[m].flat()', 'flat-deep': '[[m]].flat(2)', 'concat': '[].concat(m)', 'concat-two': '[{}].concat(m, m)', 'concat-by-call': 'Array.prototype.concat.call([], m)', 'from': 'Array.from(m)',
 'spread': '[...m]', 'of': 'Array.of(...m)', 'iterator-flat-map': '[0].values().flatMap(() => m).toArray()', 'set': '[...new Set(m)]', 'flat-map-of-a-parameter': 'flatten([0], () => m)', 'slice-by-call': 'Array.prototype.slice.call(m)',
 'map-by-call': 'Array.prototype.map.call(m, x => x)', 'to-sorted-by-call': 'Array.prototype.toSorted.call(m)', 'push-spread': 'pushed(m)', 'apply': 'collect.apply(null, m)', 'all': 'await Promise.all(m)',
}
uses = ['typeof e', 'e + 1', 'String(e)', 'e == null', 'e === 1 || e === 2']
helpers = '''class Stack extends Array {}
function filled(a) { a.push(1, 2); return a; }
function handedOn(a) { return a; }
function flatten(l, f) { return l.flatMap(f); }
function pushed(a) { const r = []; r.push(...a); return r; }
function collect(...all) { return all; }'''
count = 0
for maker, made in makers.items():
    for road, way in roads.items():
        for number, use in enumerate(uses):
            with open(os.path.join(out, '%s-%s-%d.mjs' % (maker, road, number)), 'w') as f:
                f.write('\n'.join(['// A list that nobody follows (%s) is taken apart by %s.' % (maker.replace('-', ' '), road.replace('-', ' ')), helpers, 'function use(e) { return %s; }' % use, 'const m = %s;' % made, 'const r = %s;' % way,
                                   'try { console.log(use(r.at(-1))); } catch (error) { console.log(error.constructor.name); }']) + '\n')
            count += 1
print(count, 'programs')
