# generate-entered-without-a-call.py <folder>: all 722; ../parallel/entered-without-a-call/ holds 2 of them: an operation that is no call in the text enters code of the program: a getter, a setter, a conversion, an iteration, a trap. That code has an effect. A function calls the function that holds the operation,
# and looks at the state before and behind the call, straight and in a loop. If who-calls-whom lacked the edge, the caller would be proven not to have the effect. One road x one effect a program. Every program prints what plain Bun prints.
import sys, os
out = sys.argv[1]
os.makedirs(out, exist_ok=True)

# state: (declarations, the effect, how the state is read given c)
states = {
 'module-variable': ('let count = 0;', 'count++;', 'count'),
 'field-of-another-object': ('const holder = { n: 0 };', 'holder.n++;', 'holder.n'),
 'list': ('const log = [];', 'log.push(1);', 'log.length'),
 'field-of-this': ('', 'this.n = (this.n || 0) + 1;', 'c.n'),
 'static-field': ('class Counter { static n = 0; }', 'Counter.n++;', 'Counter.n'),
 'type-of-a-field': ('const holder = { v: 1 };', 'holder.v = typeof holder.v === "number" ? "text" : 1;', 'typeof holder.v'),
 'shape-of-an-object': ('const holder = { a: 1 };', 'holder["k" + Object.keys(holder).length] = 1;', 'Object.keys(holder).length'),
 'throws': ('', 'throw new Error("thrown");', '0'),
 'closure-of-each-entry': ('const made = [];', '{ let n = 0; made.push(() => ++n); }', 'made.map(f => f()).join("")'),
 'object-of-each-entry': ('const made = [];', '{ const o = { n: made.length }; made.push(o); }', 'made.map(o => o.n).join("") + (made.length > 1 && made[0] === made[1])'),
 'variable-initialized-late': ('let late;\nfunction init() { late = { v: 1 }; }', 'if (!late) init(); late.v++;', '(late ? late.v : "none")'),
}
# road: (definitions with EFFECT, make(), the deed in middle(c, k), whether `this` in the entered code is c)
roads = {
 'class-getter':        ('class C { get x() { EFFECT return 1; } }', 'new C()', 'return c.x;', True),
 'class-setter':        ('class C { set x(v) { EFFECT } }', 'new C()', 'c.x = 1;', True),
 'static-getter':       ('class C { static get x() { EFFECT return 1; } }', 'C', 'return c.x;', True),
 'static-setter':       ('class C { static set x(v) { EFFECT } }', 'C', 'c.x = 1;', True),
 'literal-getter':      ('', '({ get x() { EFFECT return 1; } })', 'return c.x;', True),
 'literal-setter':      ('', '({ set x(v) { EFFECT } })', 'c.x = 1;', True),
 'inherited-getter':    ('class B { get x() { EFFECT return 1; } }\nclass C extends B { own = 1; }', 'new C()', 'return c.x;', True),
 'inherited-setter':    ('class B { set x(v) { EFFECT } }\nclass C extends B { own = 1; }', 'new C()', 'c.x = 1;', True),
 'getter-defined-on-an-instance': ('class C { own = 1; }', 'Object.defineProperty(new C(), "x", { get() { EFFECT return 1; }, configurable: true })', 'return c.x;', True),
 'getter-defined-on-a-prototype': ('class C { own = 1; }\nObject.defineProperty(C.prototype, "x", { get() { EFFECT return 1; }, configurable: true });', 'new C()', 'return c.x;', True),
 'getter-of-a-constructor-function': ('function F() { this.own = 1; }\nObject.defineProperty(F.prototype, "x", { get() { EFFECT return 1; }, configurable: true });', 'new F()', 'return c.x;', True),
 'private-getter':      ('class C { get #x() { EFFECT return 1; } read() { return this.#x; } }', 'new C()', 'return c.read();', True),
 'private-setter':      ('class C { set #x(v) { EFFECT } write() { this.#x = 1; } }', 'new C()', 'c.write();', True),
 'super-getter':        ('class B { get x() { EFFECT return 1; } }\nclass C extends B { get y() { return super.x; } }', 'new C()', 'return c.y;', True),
 'taken-apart':         ('class C { get x() { EFFECT return 1; } }', 'new C()', 'const { x } = c; return x;', True),
 'updated':             ('class C { get x() { return 1; } set x(v) { EFFECT } }', 'new C()', 'c.x++;', True),
 'added-to':            ('class C { get x() { EFFECT return 1; } set x(v) {} }', 'new C()', 'c.x += 1;', True),
 'read-by-key':         ('class C { get x() { EFFECT return 1; } }', 'new C()', 'return c[k];', True),
 'stored-by-key':       ('class C { set x(v) { EFFECT } }', 'new C()', 'c[k] = 1;', True),
 'optional-read':       ('class C { get x() { EFFECT return 1; } }', 'new C()', 'return c?.x;', True),
 'spread':              ('', '({ get x() { EFFECT return 1; } })', 'return { ...c }.x;', True),
 'rest':                ('', '({ a: 1, get x() { EFFECT return 1; } })', 'const { a, ...others } = c; return others.x;', True),
 'object-assign-from':  ('', '({ get x() { EFFECT return 1; } })', 'return Object.assign({}, c).x;', True),
 'object-assign-onto':  ('', '({ set x(v) { EFFECT } })', 'Object.assign(c, { x: 1 });', True),
 'json-stringify':      ('', '({ get x() { EFFECT return 1; } })', 'return JSON.stringify(c);', True),
 'to-json':             ('class C { toJSON() { EFFECT return 1; } }', 'new C()', 'return JSON.stringify(c);', True),
 'object-values':       ('', '({ get x() { EFFECT return 1; } })', 'return Object.values(c)[0];', True),
 'object-entries':      ('', '({ get x() { EFFECT return 1; } })', 'return Object.entries(c)[0][1];', True),
 'reflect-get':         ('class C { get x() { EFFECT return 1; } }', 'new C()', 'return Reflect.get(c, "x");', True),
 'reflect-set':         ('class C { set x(v) { EFFECT } }', 'new C()', 'Reflect.set(c, "x", 1);', True),
 'value-of-in-a-sum':   ('class C { valueOf() { EFFECT return 1; } }', 'new C()', 'return c + 1;', True),
 'value-of-in-a-product': ('class C { valueOf() { EFFECT return 1; } }', 'new C()', 'return c * 2;', True),
 'value-of-compared':   ('class C { valueOf() { EFFECT return 1; } }', 'new C()', 'return c < 2;', True),
 'value-of-loosely-equal': ('class C { valueOf() { EFFECT return 1; } }', 'new C()', 'return c == 1;', True),
 'value-of-negated':    ('class C { valueOf() { EFFECT return 1; } }', 'new C()', 'return -c;', True),
 'value-of-in-math':    ('class C { valueOf() { EFFECT return 1; } }', 'new C()', 'return Math.abs(c);', True),
 'value-of-as-an-index-argument': ('class C { valueOf() { EFFECT return 1; } }', 'new C()', 'return "abc".charAt(c);', True),
 'to-string-in-a-template': ('class C { toString() { EFFECT return "s"; } }', 'new C()', 'return `${c}`;', True),
 'to-string-in-a-sum':  ('class C { toString() { EFFECT return "s"; } }', 'new C()', 'return "" + c;', True),
 'to-string-as-a-key':  ('class C { toString() { EFFECT return "s"; } }', 'new C()', 'return ({ s: 1 })[c];', True),
 'to-string-by-string': ('class C { toString() { EFFECT return "s"; } }', 'new C()', 'return String(c);', True),
 'to-string-by-join':   ('class C { toString() { EFFECT return "s"; } }', 'new C()', 'return [c].join();', True),
 'to-primitive':        ('class C { [Symbol.toPrimitive]() { EFFECT return 1; } }', 'new C()', 'return +c;', True),
 'iterator-in-for-of':  ('class C { [Symbol.iterator]() { EFFECT return [1].values(); } }', 'new C()', 'for (const v of c) return v;', True),
 'iterator-in-a-spread': ('class C { [Symbol.iterator]() { EFFECT return [1].values(); } }', 'new C()', 'return [...c].length;', True),
 'iterator-taken-apart': ('class C { [Symbol.iterator]() { EFFECT return [1].values(); } }', 'new C()', 'const [v] = c; return v;', True),
 'iterator-in-array-from': ('class C { [Symbol.iterator]() { EFFECT return [1].values(); } }', 'new C()', 'return Array.from(c).length;', True),
 'next-of-an-iterator': ('class C { [Symbol.iterator]() { return this; } next() { EFFECT return { done: true, value: 1 }; } }', 'new C()', 'for (const v of c) return v;', True),
 'return-of-an-iterator': ('class C { [Symbol.iterator]() { return this; } next() { return { done: false, value: 1 }; } return() { EFFECT return {}; } }', 'new C()', 'for (const v of c) break;', True),
 'has-instance':        ('class C { static [Symbol.hasInstance](v) { EFFECT return true; } }', 'C', 'return 1 instanceof c;', True),
 'proxy-get':           ('', 'new Proxy({}, { get() { EFFECT return 1; } })', 'return c.x;', False),
 'proxy-set':           ('', 'new Proxy({}, { set() { EFFECT return true; } })', 'c.x = 1;', False),
 'proxy-has':           ('', 'new Proxy({}, { has() { EFFECT return true; } })', 'return "x" in c;', False),
 'proxy-delete':        ('', 'new Proxy({}, { deleteProperty() { EFFECT return true; } })', 'return delete c.x;', False),
 'proxy-own-keys':      ('', 'new Proxy({}, { ownKeys() { EFFECT return []; } })', 'return Object.keys(c).length;', False),
 'proxy-apply':         ('', 'new Proxy(function () {}, { apply() { EFFECT return 1; } })', 'return c();', False),
 'proxy-construct':     ('', 'new Proxy(function () {}, { construct() { EFFECT return {}; } })', 'return typeof new c();', False),
 'getter-above-created': ('', 'Object.create({ get x() { EFFECT return 1; } })', 'return c.x;', True),
 'setter-above-created': ('', 'Object.create({ set x(v) { EFFECT } })', 'c.x = 1;', True),
 'comparator':          ('', '[2, 1]', 'return c.sort((p, q) => { EFFECT return p - q; })[0];', False),
 'callback-of-map':     ('', '[1]', 'return c.map(v => { EFFECT return v; })[0];', False),
 'replacer':            ('', '"a"', 'return c.replace("a", () => { EFFECT return "b"; });', False),
 'species':             ('class C extends Array { static get [Symbol.species]() { EFFECT return Array; } }', 'new C()', 'return c.map(v => v).length;', False),
 'field-initializer':   ('class C { x = (() => { EFFECT return 1; })(); }', 'C', 'return new c().x;', False),
 'static-block-once':   ('', '() => class { static { EFFECT } }', 'return typeof c();', False),
 'default-parameter':   ('function f(v = (() => { EFFECT return 1; })()) { return v; }', 'f', 'return c();', False),
 'tagged-template':     ('function tag() { EFFECT return 1; }', 'tag', 'return c`t`;', False),
}
count = 0
for road, (definitions, made, deed, this_is_c) in roads.items():
    for state, (declarations, effect, read) in states.items():
        if state == 'field-of-this' and not this_is_c:
            continue
        L = ['// %s enters code that has an effect (%s), and a caller of the function that holds it looks at the state before and behind.' % (road.replace('-', ' ').capitalize(), state.replace('-', ' '))]
        if declarations: L.append(declarations)
        if definitions: L.append(definitions.replace('EFFECT', effect))
        L.append('function make() { return %s; }' % made.replace('EFFECT', effect))
        L.append('function middle(c, k) { %s }' % deed.replace('EFFECT', effect))
        if state == 'throws':
            L.append('function outer(c) { try { middle(c, "x"); return "no error"; } catch (e) { return e.message; } }')
            L.append('function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { try { middle(c, "x"); s += "no,"; } catch (e) { s += e.message + ","; } } return s; }')
        else:
            L.append('function outer(c) { const before = %s; middle(c, "x"); const behind = %s; return before + ">" + behind; }' % (read, read))
            L.append('function looped(c) { let s = ""; for (let i = 0; i < 3; i++) { middle(c, "x"); s += %s + ","; } return s; }' % read)
        L.append('console.log(outer(make()), looped(make()));')
        open(os.path.join(out, 'entered-%s-%s.js' % (road, state)), 'w').write('\n'.join(L) + '\n')
        count += 1
print(count)
