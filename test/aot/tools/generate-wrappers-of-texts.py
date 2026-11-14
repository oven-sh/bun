# generate-wrappers-of-texts.py <outdir>: the object that stands for a text has its characters under their indexes. Each road takes one out, and it is used as what it is. ONE DEED A PROGRAM.
import sys, os
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
makers = { 'new-string': 'new String("ab")', 'object-of': 'Object("ab")', 'new-object-of': 'new Object("ab")', 'assigned': 'Object.assign("ab", {})', 'of-a-parameter': 'boxed("ab")', 'by-reflect': 'Reflect.construct(String, ["ab"])' }
roads = {
 'index': 'm[0]', 'second': 'm[1]', 'index-of-a-parameter': 'at(m, 1)', 'beyond': 'm[2]', 'at': 'm.at(0)', 'char-at': 'm.charAt(1)', 'spread': '[...m][0]', 'from': 'Array.from(m)[1]', 'map': 'Array.prototype.map.call(m, c => c)[0]',
 'slice': 'Array.prototype.slice.call(m)[1]', 'entries': 'Object.entries(m)[0][1]', 'values': 'Object.values(m)[1]', 'keys-mapped': 'Object.keys(m).map(k => m[k])[0]', 'for-of': 'firstOf(m)', 'for-in': 'byForIn(m)',
 'descriptor': 'Object.getOwnPropertyDescriptor(m, 0).value', 'descriptors': 'Object.getOwnPropertyDescriptors(m)[1].value', 'assign': 'Object.assign({}, m)[0]', 'spread-into-a-record': '({ ...m })[1]', 'find': 'Array.prototype.find.call(m, c => c === "b")',
 'reduce': 'Array.prototype.reduce.call(m, (a, c) => c)', 'filter': 'Array.prototype.filter.call(m, () => true)[0]', 'flat': 'Array.prototype.flat.call(m)[1]', 'step-of-values': 'Array.prototype.values.call(m).next().value',
 'pair-of-entries': 'Array.prototype.entries.call(m).next().value[1]', 'array-at': 'Array.prototype.at.call(m, 1)', 'to-sorted': 'Array.prototype.toSorted.call(m)[0]', 'with': 'Array.prototype.with.call(m, 0, "z")[1]',
 'reflect-get': 'Reflect.get(m, 0)', 'destructured': '(([a]) => a)(m)', 'destructured-by-name': '(({ 1: b }) => b)(m)', 'concat': 'Array.prototype.concat.call([], [...m])[0]', 'for-each': 'lastSeen(m)', 'own-names-mapped': 'Object.getOwnPropertyNames(m).map(k => m[k])[1]',
 'length': 'm.length', 'value-of': 'm.valueOf()', 'from-entries': 'Object.fromEntries(Object.entries(m))[0]', 'map-of-entries': 'new Map(Object.entries(m)).get("1")',
}
uses = ['typeof e', 'e + "!"', 'e === "a"', 'e == null', 'String(e).length']
helpers = '''function boxed(t) { return new String(t); }
function at(o, i) { return o[i]; }
function firstOf(o) { for (const c of o) return c; }
function byForIn(o) { let found; for (const k in o) found = o[k]; return found; }
function lastSeen(o) { let seen; Array.prototype.forEach.call(o, c => { seen = c; }); return seen; }'''
count = 0
for maker, made in makers.items():
    for road, way in roads.items():
        for number, use in enumerate(uses):
            with open(os.path.join(out, '%s-%s-%d.mjs' % (maker, road, number)), 'w') as f:
                f.write('\n'.join(['// A character comes out of the object that stands for a text (%s) by %s.' % (maker.replace('-', ' '), road.replace('-', ' ')), helpers, 'function use(e) { return %s; }' % use, 'const m = %s;' % made,
                                   'try { console.log(use(%s)); } catch (error) { console.log(error.constructor.name); }' % way]) + '\n')
            count += 1
print(count, 'programs')
