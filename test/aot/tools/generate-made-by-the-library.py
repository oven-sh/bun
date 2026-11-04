# generate-made-by-the-library.py <outdir>: what a built-in makes is ONE object, whoever types it: Link by the row, the walk by the row, by the function of the library that it calls, or by the body that it copies in line.
# The object is made, kept somewhere, touched through the keeper, read back, and held against itself. maker x keeper x company of the keeper x observer. ONE SHAPE A FILE. Every program prints what plain Bun prints.
import sys, os
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
# An expression over `n`. (L): the built-in has a body in the library. (H): the host makes it. (C): a control.
steps = {
 'array-values-next':      '[n, 2].values().next()',
 'array-keys-next':        '[n, 2].keys().next()',
 'array-entries-next':     '[n, 2].entries().next()',
 'array-iterator-next':    '[n, 2][Symbol.iterator]().next()',
 'map-values-next':        'new Map([[n, 2]]).values().next()',
 'map-keys-next':          'new Map([[n, 2]]).keys().next()',
 'map-entries-next':       'new Map([[n, 2]]).entries().next()',
 'set-values-next':        'new Set([n, 2]).values().next()',
 'set-entries-next':       'new Set([n, 2]).entries().next()',
 'typed-array-values-next': 'new Int8Array([n, 2]).values().next()',
 'string-iterator-next':   '"ab"[Symbol.iterator]().next()',
 'match-all-next':         '"ab".matchAll(/a/g).next()',
 'generator-next':         'numbers(n).next()',
 'generator-return':       'numbers(n).return(n)',
 'generator-next-at-the-end': '((g) => (g.next(), g.next()))(numbers(n))',
 'helper-map-next':        'Iterator.from([n]).map(x => x).next()',
 'helper-filter-next':     'Iterator.from([n]).filter(x => true).next()',
 'helper-take-next':       'Iterator.from([n]).take(1).next()',
 'helper-drop-next':       'Iterator.from([n]).drop(0).next()',
 'helper-flat-map-next':   'Iterator.from([n]).flatMap(x => [x]).next()',
 'helper-return':          'Iterator.from([n]).map(x => x).return()',
 'wrapped-next':           'Iterator.from({ next() { return { done: false, value: n }; } }).next()',
 'arguments-iterator-next': '(function () { return arguments[Symbol.iterator]().next(); })(n, 2)',
}
others = {
 'array-values':           '[n, 2].values()',
 'map-entries':            'new Map([[n, 2]]).entries()',
 'set-values':             'new Set([n]).values()',
 'match-all':              '"ab".matchAll(/a/g)',
 'generator':              'numbers(n)',
 'iterator-from-a-list':   'Iterator.from([n])',
 'iterator-from-an-object': 'Iterator.from({ next() { return { done: true, value: n }; } })',
 'helper-map':             'Iterator.from([n]).map(x => x)',
 'iterator-concat':        'Iterator.concat([n], [2])',
 'from-entries':           'Object.fromEntries([["x", n]])',
 'from-entries-of-a-map':  'Object.fromEntries(new Map([["x", n]]))',
 'from-entries-by-call':   'Object.fromEntries.call(null, [["x", n]])',
 'from-entries-by-reflect': 'Reflect.apply(Object.fromEntries, null, [[["x", n]]])',
 'object-group-by':        'Object.groupBy([n], () => "x")',
 'group-of-object-group-by': 'Object.groupBy([n], () => "x").x',
 'map-group-by':           'Map.groupBy([n], () => "x")',
 'group-of-map-group-by':  'Map.groupBy([n], () => "x").get("x")',
 'entries':                'Object.entries({ x: n })',
 'pair-of-entries':        'Object.entries({ x: n })[0]',
 'pair-of-a-map-step':     'new Map([[n, 2]]).entries().next().value',
 'pair-of-an-array-step':  '[n].entries().next().value',
 'with-resolvers':         'Promise.withResolvers()',
 'promise-of-with-resolvers': 'Promise.withResolvers().promise',
 'promise-try':            'Promise.try(() => n)',
 'new-promise':            'new Promise(() => {})',
 'from-async':             'Array.fromAsync([n])',
 'array-from':             'Array.from([n])',
 'array-from-a-length':    'Array.from({ length: 1 })',
 'array-from-a-set':       'Array.from(new Set([n]))',
 'array-from-with-a-mapper': 'Array.from([n], x => x)',
 'array-map':              '[n].map(x => x)',
 'array-filter':           '[n].filter(x => true)',
 'array-flat-map':         '[n].flatMap(x => [x])',
 'array-to-sorted':        '[n, 2].toSorted()',
 'array-sort':             '[n, 2].sort()',
 'iterator-to-array':      'Iterator.from([n]).toArray()',
 'typed-array-from':       'Int8Array.from([n])',
 'typed-array-map':        'new Int8Array([n]).map(x => x)',
 'moved-stack':            'new DisposableStack().move()',
 'used-by-a-stack':        'new DisposableStack().use({ [Symbol.dispose]() {}, x: n })',
 'descriptor':             'Object.getOwnPropertyDescriptor({ x: n }, "x")',
 'descriptor-by-reflect':  'Reflect.getOwnPropertyDescriptor({ x: n }, "x")',
 'descriptors':            'Object.getOwnPropertyDescriptors({ x: n })',
 'all-settled-control':    '({ status: "fulfilled", value: n })',
 'create-control':         'Object.create(null)',
 'assign-control':         'Object.assign({}, { x: n })',
 'spread-control':         '({ ...{ x: n } })',
 'parse-control':          'JSON.parse("{\\"x\\":1}")',
 'clone-control':          'structuredClone({ x: n })',
 'literal-control':        '({ value: n, done: false })',
}
makers = dict(steps); makers.update(others)
# name: (what stands in front, with INIT; KEEP; TAKE)
keepers = {
 'field':            ('const box = { k: INIT };', 'box.k = k;', 'box.k'),
 'appended-field':   ('const box = {}; if (INIT) box.k = INIT;', 'box.k = k;', 'box.k'),
 'instance-field':   ('class Box { k = INIT; }\nconst box = new Box();', 'box.k = k;', 'box.k'),
 'list-element':     ('const list = [INIT];', 'list[0] = k;', 'list[0]'),
 'pushed':           ('const list = [INIT];', 'list.push(k);', 'list[list.length - 1]'),
 'map-value':        ('const map = new Map([["k", INIT]]);', 'map.set("k", k);', 'map.get("k")'),
 'set-member':       ('const set = new Set([INIT]);', 'set.add(k);', '[...set].at(-1)'),
 'weak-map-value':   ('const weak = new WeakMap(); const key = {}; weak.set(key, INIT);', 'weak.set(key, k);', 'weak.get(key)'),
 'variable':         ('let kept = INIT;', 'kept = k;', 'kept'),
 'captured-variable': ('function cellOf(first) { let held = first; return { put(v) { held = v; }, get() { return held; } }; }\nconst cell = cellOf(INIT);', 'cell.put(k);', 'cell.get()'),
 'argument':         ('function same(a) { return a; }\nsame(INIT);', '', 'same(k)'),
}
company = {
 'alone':                'undefined',
 'beside-a-host-record': 'Promise.withResolvers()',
 'beside-a-literal':     '({ value: 0 })',
 'beside-a-plain-object': 'Object.create(null)',
}
observers = {
 'strict':          'other === k',
 'not-strict':      'other !== k',
 'loose':           'other == k',
 'object-is':       'Object.is(other, k)',
 'includes':        '[other].includes(k)',
 'index-of':        '[other].indexOf(k)',
 'switch':          '(() => { switch (other) { case k: return "same"; default: return "another"; } })()',
 'branch':          'other === k ? "same" : "another"',
 'set-size':        'new Set([other, k]).size',
 'map-has':         'new Map([[other, 1]]).has(k)',
 'weak-set-has':    'new WeakSet([other]).has(k)',
 'typeof':          'typeof other + typeof k',
 'instanceof-object': 'other instanceof Object',
 'prototype':       'Object.getPrototypeOf(other) === Object.getPrototypeOf(k)',
 'to-string':       'Object.prototype.toString.call(other)',
 'constructor':     'other.constructor === k.constructor',
 'is-array':        'Array.isArray(other)',
 'keys':            'Object.keys(other).join()',
 'what-was-stored': 'String(other.value) + String(k.value)',
}
# How the step is called. IT: an expression for the iterator.
calls = {
 'in-sight':          'IT.next()',
 'iterator-in-a-variable': '((it) => it.next())(IT)',
 'iterator-handed-over': 'stepOf(IT)',
 'next-by-call':      '((it) => it.next.call(it))(IT)',
 'next-by-reflect':   '((it) => Reflect.apply(it.next, it, []))(IT)',
 'next-as-a-value':   '((it) => { const next = it.next; return next.call(it); })(IT)',
 'next-under-a-made-up-key': '((it) => it[["ne", "xt"].join("")]())(IT)',
 'next-bound':        '((it) => it.next.bind(it)())(IT)',
 'second-step':       '((it) => (it.next(), it.next()))(IT)',
}
iterators = {
 'array':     '[n, 2].values()',
 'map':       'new Map([[n, 2]]).values()',
 'set':       'new Set([n, 2]).values()',
 'generator': 'numbers(n)',
 'helper':    'Iterator.from([n, 2]).map(x => x)',
 'string':    '"ab"[Symbol.iterator]()',
}
count = 0
def write(name, maker, keeper, beside, observer, loop):
    global count
    before, keep, take = keepers[keeper]
    lines = ['// %s.' % name.replace('-', ' '), 'function* numbers(n) { yield n; }', 'function stepOf(it) { return it.next(); }', before.replace('INIT', company[beside]),
             'function run(n) {', '  const k = %s;' % maker, '  %s' % keep, '  const target = %s;' % take, '  if (target) { target.value = 9; }', '  const other = %s;' % take, '  return %s;' % observers[observer], '}',
             'try { console.log(String(run(1)), String(run(2))); } catch (error) { console.log(error.constructor.name); }']
    if loop:
        lines.append('for (const x of [1]) console.log(x);')
    with open(os.path.join(out, name + '.mjs'), 'w') as f:
        f.write('\n'.join(l for l in lines if l.strip()) + '\n')
    count += 1
for maker, text in makers.items():
    for keeper in keepers:
        for beside in company:
            write('%s-%s-%s-strict' % (maker, keeper, beside), text, keeper, beside, 'strict', False)
    for observer in observers:
        if observer == 'strict':
            continue
        for beside in ('alone', 'beside-a-host-record'):
            write('%s-field-%s-%s-and-a-loop' % (maker, beside, observer), text, 'field', beside, observer, True)
    write('%s-field-alone-strict-and-a-loop' % maker, text, 'field', 'alone', 'strict', True)
for way, call in calls.items():
    for iterator, text in iterators.items():
        for keeper in ('field', 'list-element', 'variable'):
            for beside in ('alone', 'beside-a-host-record'):
                write('%s-of-%s-%s-%s-strict-and-a-loop' % (way, iterator, keeper, beside), call.replace('IT', text), keeper, beside, 'strict', True)
print(count, 'programs')
