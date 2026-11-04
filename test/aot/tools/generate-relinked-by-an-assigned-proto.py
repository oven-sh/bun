# generate-relinked-by-an-assigned-proto.py <outdir>: all 8,392: `Object.assign(record, { ["__proto__"]: evil })`: an own enumerable `__proto__` of the SOURCE is ASSIGNED, so the record stands below `evil` from then on.
# source x evil x target x use. ONE SHAPE A FILE. The controls: a spread, which defines and does not relink . the link laid by hand. Every program prints what plain Bun prints.
import sys, os
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
sources = {
 'computed-key':     '{ ["__proto__"]: evil }',
 'made-up-key':      '{ [["__pro", "to__"].join("")]: evil }',
 'from-entries':     'Object.fromEntries([["__proto__", evil]])',
 'defined':          'Object.defineProperty({}, "__proto__", { value: evil, enumerable: true })',
 'field-of-a-class': 'new (class { ["__proto__"] = evil; })()',
 'beside-others':    '{ y: 3, ["__proto__"]: evil, w: 4 }',
 'of-a-parameter':   'handedOn({ ["__proto__"]: evil })',
 'map-entries':      'Object.fromEntries(new Map([["__proto__", evil]]))',
}
ways = {
 'assign':            'Object.assign(record, SOURCE);',
 'assign-two':        'Object.assign(record, {}, SOURCE);',
 'assign-in-a-callee': 'assignTo(record, SOURCE);',
 'assign-by-call':    'Object.assign.call(null, record, SOURCE);',
 'by-a-loop':         'const s = SOURCE; for (const k of Object.keys(s)) record[k] = s[k];',
 'by-entries':        'for (const [k, v] of Object.entries(SOURCE)) record[k] = v;',
 'reflect-set':       'const s = SOURCE; Reflect.set(record, Object.keys(s).at(-1 - (Object.keys(s).length > 1 ? 1 : 0)), evil);',
 'by-hand':           'record.__proto__ = evil;',
 'set-prototype-of':  'Object.setPrototypeOf(record, evil);',
}
evils = {
 'setter-for-a-name-it-lacks':  ('{ set z(v) { this.x = "s"; } }', 'record.z = 1;'),
 'getter-that-stores':          ('{ get z() { this.x = "g"; return 1; } }', 'record.z;'),
 'setter-that-deletes':         ('{ set z(v) { delete this.x; } }', 'record.z = 1;'),
 'setter-that-keeps':           ('{ set z(v) { kept.push(this); } }', 'record.z = 1; kept[0].x = "k";'),
 'method':                      ('{ m() { this.x = "m"; return "evil"; } }', 'record.m();'),
 'plain':                       ('{ z: "inherited", x: "above" }', ''),
}
targets = {
 'record':    ('', '{ x: 1, y: 2 }'),
 'instance':  ('class P { x = 1; y = 2; m() { return "P"; } }', 'new P()'),
 'made-in-a-function': ('function make() { return { x: 1, y: 2 }; }', 'make()'),
}
uses = ['p.x + 1', 'typeof p.x', 'String(p.z)', 'Object.getPrototypeOf(p) === evil', 'Object.keys(p).join()', '"z" in p', 'typeof p.m', 'typeof p.toString']
count = 0
def write(name, lines):
    global count
    with open(os.path.join(out, name + '.mjs'), 'w') as f:
        f.write('\n'.join(l for l in lines if l) + '\n')
    count += 1
for way, done in ways.items():
    for source, made in sources.items():
        if 'SOURCE' not in done and source != 'computed-key':
            continue
        for evil, (above, deed) in evils.items():
            for target, (before, born) in targets.items():
                for number, use in enumerate(uses):
                    write('%s-%s-%s-%s-%d' % (way, source, evil, target, number), [
                        '// %s of a source (%s) onto a %s; above it then: %s.' % (way.replace('-', ' '), source.replace('-', ' '), target.replace('-', ' '), evil.replace('-', ' ')),
                        before, 'const kept = [];', 'function handedOn(o) { return o; }', 'function assignTo(t, s) { return Object.assign(t, s); }',
                        'const evil = %s;' % above, 'function use(p) { return %s; }' % use, 'const record = %s;' % born,
                        'try { %s %s } catch (error) { console.log(error.constructor.name); }' % (done.replace('SOURCE', made), deed),
                        'try { console.log(use(record)); } catch (error) { console.log(error.constructor.name); }'])
# What is parsed has `__proto__` as a property of its own. A spread DEFINES it and does not relink.
for name, line in { 'parsed': 'Object.assign(record, JSON.parse(\'{"__proto__": {"z": "inherited", "x": "above"}}\'));', 'parsed-nested': 'Object.assign(record, JSON.parse(\'{"a": {"__proto__": {"z": "inherited"}}}\').a);',
                    'spread-control': 'record = { ...record, ...{ ["__proto__"]: { z: "inherited" } } };', 'literal-control': 'record = { x: 1, y: 2, ["__proto__"]: { z: "inherited" } };', 'literal-that-links': 'record = { x: 1, y: 2, __proto__: { z: "inherited" } };' }.items():
    for number, use in enumerate(['p.x + 1', 'typeof p.x', 'String(p.z)', 'Object.getPrototypeOf(p) === Object.prototype', 'Object.keys(p).join()', '"z" in p', 'typeof p.toString', 'Object.hasOwn(p, "__proto__")']):
        write('%s-%d' % (name, number), ['// %s.' % name.replace('-', ' '), 'function use(p) { return %s; }' % use, 'let record = { x: 1, y: 2 };', line, 'console.log(use(record));'])
print(count, 'programs')
