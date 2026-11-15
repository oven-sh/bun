# generate-what-can-be-reached.py <folder>: all 292; ../parallel/what-can-be-reached/ holds 8 of them: what comes out of a built-in that hands on what can be REACHED from its operand (not only what the operand itself holds) is read, called, stored into, compared and tested.
# One program for each way of coming out x kind of value x typed | erased. Every program prints what plain Bun prints.
import sys, os
out = sys.argv[1]
os.makedirs(out, exist_ok=True)

# name: (expression for the list or value that comes out, given V = the value that went in; how to take the element out of it)
ways = {
 'flat':                    ('[[V]].flat()', 'R[0]'),
 'flat-of-a-parameter':     ('flatten([[V]])', 'R[0]'),
 'flat-two-deep':           ('[[[V]]].flat(2)', 'R[0]'),
 'flat-infinity':           ('[[[[V]]]].flat(Infinity)', 'R[0]'),
 'flat-one-of-two-deep':    ('[[[V]]].flat()', 'R[0][0]'),
 'flat-mixed':              ('[W, [V]].flat()', 'R[1]'),
 'flat-twice':              ('[[[V]]].flat().flat()', 'R[0]'),
 'flat-by-call':            ('Array.prototype.flat.call([[V]])', 'R[0]'),
 'flat-of-pushed':          ('pushed(V).flat()', 'R[0]'),
 'flat-of-array-like':      ('Array.prototype.flat.call({ length: 1, 0: [V] })', 'R[0]'),
 'flat-then-map':           ('[[V]].flat().map(e => e)', 'R[0]'),
 'flat-then-spread':        ('[...[[V]].flat()]', 'R[0]'),
 'flat-last':               ('[[W], [V]].flat()', 'R.at(-1)'),
 'flat-pop':                ('[[V]].flat()', 'R.pop()'),
 'flat-map':                ('[0].flatMap(() => [V])', 'R[0]'),
 'flat-map-of-lists':       ('[[V]].flatMap(e => e)', 'R[0]'),
 'concat':                  ('[].concat([V])', 'R[0]'),
 'concat-nested':           ('[].concat([[V]])', 'R[0][0]'),
 'array-from-nested':       ('Array.from([[V]])', 'R[0][0]'),
 'from-entries':            ('Object.fromEntries([["k", V]])', 'R.k'),
 'from-entries-of-a-map':   ('Object.fromEntries(new Map([["k", V]]))', 'R.k'),
 'object-group-by':         ('Object.groupBy([V], () => "k")', 'R.k[0]'),
 'map-group-by':            ('Map.groupBy([V], () => "k")', 'R.get("k")[0]'),
 'to-sorted-nested':        ('[[V]].toSorted()', 'R[0][0]'),
 'sort-nested':             ('[[V]].sort()', 'R[0][0]'),
 'map-of-entries':          ('new Map([["k", V]])', 'R.get("k")'),
 'set-of-lists':            ('[...new Set([[V]])]', 'R[0][0]'),
 'iterator-flat-map':       ('[[V]].values().flatMap(e => e).toArray()', 'R[0]'),
 'stringify-with-replacer': ('seenBy([[V]])', 'R[0]'),
 'entries-of-entries':      ('Object.entries({ k: [V] })', 'R[0][1][0]'),
 'values-nested':           ('Object.values({ k: [V] })', 'R[0][0]'),
}

kinds = {
 'object': dict(
   before='class P { x = 1; y = 2; m() { return this.x + 1; } toString() { return "P" + this.x; } }\nclass Q extends P { x = 5; }',
   make='new P()', other='new Q()', type='P',
   uses=['e.x', 'e.m()', 'e.y + 1', 'e === v', 'typeof e', 'e instanceof P', 'e instanceof Array', 'Array.isArray(e)', 'String(e.length)', '"" + e', '`${e}`', 'e == null', '!e',
         'Object.keys(e).join()', '(e.x = "s", v.x)', '(e.z = 1, Object.keys(v).join())', '(delete e.y, Object.keys(v).join())', '"x" in e', 'e.constructor === P', 'JSON.stringify(e)']),
 'number': dict(
   before='', make='41', other='7', type='number',
   uses=['e + 1', 'e * 2', 'e | 0', 'e < 50', 'e === 41', 'typeof e', 'Array.isArray(e)', 'String(e.length)', 'String(e)', 'e.toFixed(1)', 'Math.abs(e)', '-e', 'e % 5', '"" + e', '!e', 'e == null', '[10, 20][e - 41]', 'e > 40 ? "big" : "small"']),
 'string': dict(
   before='', make='"ab"', other='"zz"', type='string',
   uses=['e + "c"', 'e.length', 'e.toUpperCase()', 'typeof e', 'e === "ab"', 'e[0]', 'Array.isArray(e)', 'e.charCodeAt(1)', 'e < "b"', '`${e}!`', '!e', 'e == null', 'e.slice(1)', '[...e].length']),
 'function': dict(
   before='', make='() => 7', other='() => 9', type='() => number',
   uses=['e()', 'typeof e', 'e === v', 'e.call(null)', 'Array.isArray(e)', 'e.length', 'e instanceof Function', '!e', 'e == null', '[1].map(e)[0]', 'e.name.length >= 0']),
}

helpers_js = '''function flatten(l) { return l.flat(); }
function pushed(x) { const outer = []; for (let i = 0; i < 2; i++) { const inner = []; inner.push(x); outer.push(inner); } return outer; }
function seenBy(l) { const seen = []; JSON.stringify(l, function (k, val) { if (k !== "" && !Array.isArray(val)) seen.push(val); return typeof val === "function" ? 0 : val; }); return seen; }
'''
helpers_ts = '''function flatten(l: T[][]): T[] { return l.flat(); }
function pushed(x: T): T[][] { const outer: T[][] = []; for (let i = 0; i < 2; i++) { const inner: T[] = []; inner.push(x); outer.push(inner); } return outer; }
function seenBy(l: T[][]): T[] { const seen: T[] = []; JSON.stringify(l, function (k: string, val: any) { if (k !== "" && !Array.isArray(val)) seen.push(val); return typeof val === "function" ? 0 : val; }); return seen; }
'''

inferred = { 'flat', 'flat-of-a-parameter', 'flat-two-deep', 'flat-twice', 'flat-of-pushed', 'flat-then-map', 'flat-then-spread', 'flat-map', 'flat-map-of-lists', 'concat', 'flat-last' }
count = 0
for way, (made, taken) in ways.items():
    for kind, k in kinds.items():
        for flavor in ('erased', 'typed', 'inferred'):
            if flavor == 'inferred' and way not in inferred:
                continue
            typed = flavor != 'erased'
            lines = ['// What comes out of %s is used as what it is (%s, %s).' % (way.replace('-', ' '), kind, flavor)]
            if k['before']: lines.append(k['before'])
            if typed:
                lines.append('type T = %s;' % k['type'])
                lines.append(helpers_ts.rstrip())
            else:
                lines.append(helpers_js.rstrip())
            ann = ': T' if typed else ''
            anyr = ': any' if flavor == 'typed' else ''
            lines.append('const show = (x%s) => typeof x === "string" ? JSON.stringify(x) : String(x);' % (': unknown' if typed else ''))
            for n, use in enumerate(k['uses']):
                made_here = made.replace('V', 'v').replace('W', 'w')
                take = taken.replace('R', 'r')
                cast = (' as T' if flavor == 'typed' else '')
                # straight
                lines.append('function straight%d() { const v%s = %s; const w%s = %s; const r%s = %s; const e%s = %s%s; return %s; }' % (n, ann, k['make'], ann, k['other'], anyr, made_here, ann, take, cast, use))
                # through a parameter
                lines.append('function used%d(e%s, v%s) { return %s; }' % (n, ann, ann, use))
                lines.append('function passed%d() { const v%s = %s; const w%s = %s; const r%s = %s; return used%d(%s%s, v); }' % (n, ann, k['make'], ann, k['other'], anyr, made_here, n, take, cast))
                # in a loop
                lines.append('function looped%d() { let all = ""; for (let i = 0; i < 3; i++) { const v%s = %s; const w%s = %s; const r%s = %s; const e%s = %s%s; all += show(%s) + ","; } return all; }' % (n, ann, k['make'], ann, k['other'], anyr, made_here, ann, take, cast, use))
                lines.append('console.log(%d, show(straight%d()), show(passed%d()), looped%d());' % (n, n, n, n))
            name = 'reach-%s-%s%s.%s' % (way, kind, '-inferred' if flavor == 'inferred' else '', 'ts' if typed else 'js')
            open(os.path.join(out, name), 'w').write('\n'.join(lines) + '\n')
            count += 1
print(count)
