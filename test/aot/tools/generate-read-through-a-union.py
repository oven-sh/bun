# read-through-a-union.py <outdir>: for LinkFlow::fieldReadThrough(): a read `value.x` through a declared union ties only the members that LIST x one by one. A member that does not list it answers with undefined,
# with what somebody has laid on it under the name, and with what lies beside its fields. So: x is laid on a member that does not list it, IN EVERY WAY, in front of the read or behind a first read, and looked at
# through the union and through what lists an object's own values. way x value x how the union is read x what is looked at x when. ONE SHAPE A FILE. Every program prints what plain Bun prints.
import sys, os
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
head = '''interface A { kind: string; x: number | string | object }
interface B { kind: string; y: string }
interface C { kind: string; z: boolean }
type Any = A | B | C;
function makeA(n: number): A { return { kind: "a", x: n > 1 ? "two" : n }; }
function makeB(n: number): B { return { kind: "b", y: "t" + n }; }
function makeC(n: number): C { return { kind: "c", z: n > 0 }; }
interface D { kind: string; w: number; x: number | string | object }
function makeD(n: number): D { return { kind: "d", w: n, x: n + 10 }; }
interface E { kind: string; u: string; t: number; x: number | string | object }
function makeE(n: number): E { return { kind: "e", u: "u", t: n, x: n + 20 }; }
type All = A | B | C | D | E;
type First = A | B;
function kindOf(value: All): string { return value.kind; }
function firstKind(value: First): string { return value.kind; }
'''
# LAY(o, v): statements that lay v on o under "x". `before`: declarations.
ways = {
 'nothing':            ('', ''),
 'by-name':            ('', '(o as any).x = v;'),
 'by-name-in-callee':  ('function put(t: B, w: unknown) { (t as any).x = w; }', 'put(o, v);'),
 'through-the-union':  ('function put(t: Any, w: unknown) { (t as any).x = w; }', 'put(o, v);'),
 'through-a-shape':    ('function put(t: { x?: unknown }, w: unknown) { t.x = w; }', 'put(o as any, v);'),
 'assign':             ('', 'Object.assign(o, { x: v });'),
 'define':             ('', 'Object.defineProperty(o, "x", { value: v, enumerable: true, writable: true, configurable: true });'),
 'define-getter':      ('', 'Object.defineProperty(o, "x", { get() { return v; }, enumerable: true, configurable: true });'),
 'reflect-set':        ('', 'Reflect.set(o, "x", v);'),
 'computed-key':       ('const names = ["y", "x"];', '(o as any)[names[names.length - 1]] = v;'),
 'global-alias':       ('', '(globalThis as any).held = o; (globalThis as any).held.x = v;'),
 'list-alias':         ('const kept: Any[] = [];', 'kept.push(o); (kept[kept.length - 1] as any).x = v;'),
 'map-alias':          ('const byName = new Map<string, unknown>();', 'byName.set("o", o); (byName.get("o") as any).x = v;'),
 'run-time-code':      ('const lay = new Function("t", "w", "t.x = w");', 'lay(o, v);'),
 'closure':            ('function later(t: B, w: unknown) { return () => { (t as any).x = w; }; }', 'later(o, v)();'),
 'prototype-above':    ('', 'Object.setPrototypeOf(o, { x: v });'),
 'entries':            ('', 'for (const [k, w] of Object.entries({ x: v })) (o as any)[k] = w;'),
 'lost-value':         ('interface Other { w: number }\nfunction makeOther(n: number): Other { return { w: n }; }\nfunction pick(flag: boolean, one: unknown, two: unknown): unknown { return flag ? one : two; }', '(pick(n > 0, o, makeOther(n)) as any).x = v;'),
 'lost-value-in-callee': ('interface Other { w: number }\nfunction makeOther(n: number): Other { return { w: n }; }\nfunction put(t: unknown, w: unknown) { (t as any).x = w; }', 'put(o, v); put(makeOther(n), 0);'),
}
values = {
 'number': '7',
 'text': '"laid"',
 'object': '{ q: 1 }',
 'function': 'function named() { return 3; }',
 'undefined': 'undefined',
}
# READ: a function read(value: Any)
reads = {
 'behind-the-tag':  'function read(value: Any): unknown { switch (value.kind) { case "a": return (value as A).x; case "b": return (value as B).y; default: return (value as C).z; } }',
 'by-in':           'function read(value: Any): unknown { return "x" in value ? value.x : "none"; }',
 'as-the-member':   'function read(value: Any): unknown { return (value as A).x; }',
 'as-anything':     'function read(value: Any): unknown { return (value as any).x; }',
 # A | D | E cuts across A | B, which is smaller and so admitted in front of it: it is no family: what is expected of `value` widens to all five, of which three have the name, at three offsets.
 'through-a-part':  'function read(value: A | D | E): unknown { return value.x; }',
 # `canHaveLocals(location) && location.locals`: the checker narrows behind the predicate, the compiler expects the whole union: three of the five have the name, at three offsets. The predicate answers by the tag, which a store may have changed.
 'behind-a-predicate': 'function hasX(value: All): value is A | D | E { return value.kind !== "b" && value.kind !== "c"; }\nfunction read(value: All): unknown { return hasX(value) ? value.x : "none"; }',
 'behind-a-predicate-that-lies': 'function hasX(value: All): value is A | D | E { return value.kind !== "c"; }\nfunction read(value: All): unknown { return hasX(value) ? value.x : "none"; }',
 'through-a-part-twice': 'function read(value: A | D | E): unknown { return value.x === undefined ? "none" : value.x; }',
}
show = 'function show(w: unknown): string { return typeof w === "function" ? "function " + w.name : typeof w === "object" && w ? JSON.stringify(w) : String(w); }\n'
looks = {
 'the-read':     'console.log(show(read(o)));',
 'the-read-of-all': 'for (const each of all) console.log(show(read(each)));',
 'stringify':    'console.log(show(read(o)), JSON.stringify(o));',
 'keys':         'console.log(show(read(o)), Object.keys(o).join());',
 'values':       'console.log(show(read(o)), Object.values(o).map(show).join());',
 'spread':       'const copy = { ...o }; console.log(show(read(o)), show((copy as any).x), Object.keys(copy).join());',
 'for-in':       'let found = ""; for (const k in o) found += k + "=" + show((o as any)[k]) + ";"; console.log(show(read(o)), found);',
 'has-own':      'console.log(show(read(o)), Object.hasOwn(o, "x"), "x" in o);',
 'typeof':       'console.log(typeof read(o), typeof read(all[0]), typeof read(all[2]));',
}
whens = {
 'in-front': 'LAY\nLOOK',
 'behind-a-read': 'console.log(show(read(o)));\nLAY\nLOOK',
 'tag-of-the-lister': '(o as any).kind = "a";\nLAY\nLOOK',
}
count = 0
for way, (before, lay) in ways.items():
    for value, text in values.items():
        if way == 'nothing' and value != 'number':
            continue
        for read, reader in reads.items():
            for look, looking in looks.items():
                for when, order in whens.items():
                    lines = ['// x is laid on a member of a union that does not list it: %s, %s; the union is read %s; %s; %s.' % (way.replace('-', ' '), value, read.replace('-', ' '), look.replace('-', ' '), when.replace('-', ' ')),
                             head + show + reader, before,
                             'function run(n: number) {\n  const o = makeB(n);\n  const all: any[] = [makeA(n), o, makeC(n), makeD(n), makeE(n)];\n  console.log(kindOf(all[n %% 5]), firstKind(all[n %% 2]));\n  const v: unknown = %s;\n  %s\n}' % (text, order.replace('LAY', lay).replace('LOOK', looking).replace('read(o)', 'read(o as any)').replace('\n', '\n  ')),
                             'try { run(1); run(2); } catch (error) { console.log((error as Error).constructor.name); }']
                    with open(os.path.join(out, '%s-%s-%s-%s-%s.ts' % (way, value, read, look, when)), 'w') as f:
                        f.write('\n'.join(l for l in lines if l) + '\n')
                    count += 1
print(count, 'programs')
