# generate-born-with-names.py <outdir>: all 3,606; ../parallel/born-with-names/ holds 36 of them: a list that native code makes with names of its own (a match: index, input, groups, indices; a template object: raw) is no list as Array makes it.
# What lies under those names is taken out by every road that reads own values or own keys, and used as what it is. ONE DEED A PROGRAM. Every program prints what plain Bun prints.
import sys, os
out = sys.argv[1]
os.makedirs(out, exist_ok=True)

makers = {
 'exec':               '/(?<n>a)/.exec("xa")',
 'exec-by-call':       'RegExp.prototype.exec.call(/(?<n>a)/, "xa")',
 'match':              '"xa".match(/(?<n>a)/)',
 'match-all':          '[..."xa".matchAll(/(?<n>a)/g)][0]',
 'symbol-match':       '/(?<n>a)/[Symbol.match]("xa")',
 'exec-of-a-parameter': 'find(/(?<n>a)/, "xa")',
 'exec-with-indices':  '/(?<n>a)/d.exec("xa")',
}
# The own keys of such a match, in order: 0 1 index input groups (and indices behind the flag d). Reflect.ownKeys: 0 1 length index input groups.
roads = {
 'values':               'Object.values(m)[POSITION]',
 'entries':              'Object.entries(m)[POSITION][1]',
 'entries-mapped':       'Object.entries(m).map(([k, v]) => v)[POSITION]',
 'assign':               'Object.assign({}, m).NAME',
 'assign-to-a-list':     'Object.assign([], m).NAME',
 'values-of-assigned':   'Object.values(Object.assign([], m))[POSITION]',
 'spread':               '({ ...m }).NAME',
 'rest':                 '(({ length, ...rest }) => rest)(m).NAME',
 'for-in':               'byForIn(m, "NAME")',
 'made-up-key':          'm[["NA", "ME"].join("")]',
 'descriptor':           'Object.getOwnPropertyDescriptor(m, "NAME").value',
 'descriptors':          'Object.getOwnPropertyDescriptors(m).NAME.value',
 'reflect-get':          'Reflect.get(m, "NAME")',
 'from-entries':         'Object.fromEntries(Object.entries(m)).NAME',
 'map-of-entries':       'new Map(Object.entries(m)).get("NAME")',
 'clone':                'structuredClone(m).NAME',
 'keys-mapped':          'Object.keys(m).map(k => m[k])[POSITION]',
 'own-keys-mapped':      'Reflect.ownKeys(m).map(k => m[k])[POSITION + 1]',
 'own-names-mapped':     'Object.getOwnPropertyNames(m).map(k => m[k])[POSITION + 1]',
 'by-name':              'm.NAME',
 'destructured':         '(({ NAME }) => NAME)(m)',
}
taken = {
 'index':  dict(position=2, halves=('in', 'dex'), uses=['typeof e', 'e + 1', 'e === 1', 'String(e)', 'e.toFixed(1)', 'e == null', '!e', 'e | 0', 'String(e.length)', 'e < 5', 'e === undefined', '`${e}`']),
 'groups': dict(position=4, halves=('gro', 'ups'), uses=['typeof e', 'e.n', 'Object.keys(e).join()', 'e == null', 'e instanceof Object', 'Object.getPrototypeOf(e) === null', '"n" in e', 'JSON.stringify(e)', 'e === undefined', 'String(e.length)']),
}
helpers = '''function find(re, text) { return re.exec(text); }
function byForIn(o, name) { let found; for (const k in o) { if (k === name) found = o[k]; } return found; }
'''
count = 0
def write(name, lines):
    global count
    with open(os.path.join(out, name + '.mjs'), 'w') as f:
        f.write('\n'.join(lines) + '\n')
    count += 1

for maker, made in makers.items():
    for road, way in roads.items():
        for name, t in taken.items():
            for number, use in enumerate(t['uses']):
                text = way.replace('"NA", "ME"', '"%s", "%s"' % t['halves']).replace('NAME', name).replace('POSITION', str(t['position']))
                write('%s-%s-%s-%d' % (maker, road, name, number), [
                    '// What lies under `%s` of a match (%s) comes out by %s and is used as what it is.' % (name, maker.replace('-', ' '), road.replace('-', ' ')),
                    helpers.rstrip(),
                    'function use(e) { return %s; }' % use,
                    'const m = %s;' % made,
                    'console.log(use(%s));' % text,
                ])

# The keys themselves.
askers = ['Object.keys(m).join()', 'Object.keys(m).length', 'Reflect.ownKeys(m).join()', 'Object.getOwnPropertyNames(m).length', 'Object.entries(m).length', 'Object.values(m).length',
          '"index" in m', 'Object.hasOwn(m, "index")', 'm.hasOwnProperty("groups")', 'Object.keys({ ...m }).join()', 'JSON.stringify(m)', 'JSON.stringify({ ...m })', 'countForIn(m)',
          'm.propertyIsEnumerable("index")', 'Object.keys(Object.assign({}, m)).length', 'Object.keys(structuredClone(m)).join()', 'm.length', 'm.slice().index', 'm.map(e => e).index', '[...m].index',
          'Array.from(m).index', 'm.concat().index', 'Object.isExtensible(m)', 'Object.isFrozen(m)']
for maker, made in makers.items():
    for number, asker in enumerate(askers):
        write('%s-keys-%d' % (maker, number), [
            '// The own keys of a match (%s).' % maker.replace('-', ' '),
            helpers.rstrip(),
            'function countForIn(o) { let n = 0; for (const k in o) n++; return n; }',
            'const m = %s;' % made,
            'console.log(%s);' % asker,
        ])

# Template objects: frozen, with a frozen list under `raw`, which no key lister for enumerable keys shows. One object for each site, however often it runs.
templates = {
 'tag':                'tag`a${1}b`',
 'tag-in-a-function':  'again()',
}
template_roads = {
 'by-name':     'm.raw',
 'made-up-key': 'm[["r", "aw"].join("")]',
 'descriptor':  'Object.getOwnPropertyDescriptor(m, "raw").value',
 'descriptors': 'Object.getOwnPropertyDescriptors(m).raw.value',
 'reflect-get': 'Reflect.get(m, "raw")',
 'own-keys':    'Reflect.ownKeys(m).map(k => m[k])[3]',
 'own-names':   'Object.getOwnPropertyNames(m).map(k => m[k])[3]',
}
template_uses = ['typeof e', 'Array.isArray(e)', 'e[0]', 'e.length', 'Object.isFrozen(e)', 'e == null', 'e.join("|")', 'e === undefined', 'refused(() => e.push("c"))', 'refused(() => { e[0] = "z"; })', 'refused(() => { e.length = 0; })']
template_askers = ['Object.isFrozen(m)', 'Object.isExtensible(m)', 'refused(() => m.push("c"))', 'refused(() => { m[0] = "z"; })', 'refused(() => { m.length = 0; })', 'refused(() => { m.extra = 1; })', 'refused(() => m.pop())',
                   'refused(() => m.sort())', 'refused(() => m.reverse())', 'refused(() => m.fill("z"))', 'refused(() => { delete m[0]; })', 'again() === again()', 'Reflect.ownKeys(m).join()', 'Object.keys(m).join()', 'm.length',
                   'm.join("|")', 'refused(() => Object.defineProperty(m, "0", { value: "z" }))', 'refused(() => Object.setPrototypeOf(m, null))', 'refused(() => m.splice(0, 1))', 'refused(() => m.shift())', 'refused(() => m.unshift("z"))',
                   'refused(() => m.copyWithin(0, 1))', 'Reflect.set(m, "0", "z")', 'Reflect.deleteProperty(m, "0")', 'Reflect.defineProperty(m, "x", { value: 1 })']
template_helpers = '''function tag(strings) { return strings; }
function again() { return tag`a${1}b`; }
function refused(deed) { try { deed(); return "done"; } catch (error) { return error.constructor.name; } }
'''
for maker, made in templates.items():
    for road, way in template_roads.items():
        for number, use in enumerate(template_uses):
            write('template-%s-%s-%d' % (maker, road, number), [
                '// What lies under `raw` of a template object comes out by %s.' % road.replace('-', ' '),
                template_helpers.rstrip(),
                'function use(e) { return %s; }' % use,
                'const m = %s;' % made,
                'console.log(use(%s), m.join("|"), m.raw.join("|"));' % way,
            ])
    for number, asker in enumerate(template_askers):
        write('template-%s-asked-%d' % (maker, number), [
            '// A template object is frozen.',
            template_helpers.rstrip(),
            'const m = %s;' % made,
            'console.log(%s, m.join("|"), m.length);' % asker,
        ])
print(count, 'programs')
