# members-laid-above-later.py <outdir>: for LinkTables::findMember() answering Nothing: a name that no class of the row lists is laid ABOVE an object by one road, and one look at the object finds it or does not.
# holder x road x what is laid x look x (laid in front of the look | behind a first look). ONE SHAPE A FILE. Every program prints what plain Bun prints.
import sys, os
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
# name: (declarations, the object, the object ABOVE it on which the name is laid)
holders = {
 'class':               ('class C { x = 1; m() { return "m"; } }', 'new C()', 'C.prototype'),
 'base-class':          ('class B { b() { return "b"; } }\nclass C extends B { x = 1; }', 'new C()', 'B.prototype'),
 'derived-of-two':      ('class A {}\nclass B extends A {}\nclass C extends B { x = 1; }', 'new C()', 'A.prototype'),
 'constructor-function': ('function C() { this.x = 1; }', 'new C()', 'C.prototype'),
 'record':              ('', '{ x: 1 }', 'Object.prototype'),
 'instance-below-object-prototype': ('class C { x = 1; }', 'new C()', 'Object.prototype'),
 'list':                ('', '[1]', 'Array.prototype'),
 'function':            ('', 'function f() {}', 'Function.prototype'),
 'class-object':        ('class B {}\nclass C extends B {}', 'C', 'B'),
 'mixin':               ('const mix = Base => class extends Base { x = 1; };\nclass B {}\nconst C = mix(B);', 'new C()', 'B.prototype'),
}
roads = {
 'store':               'ABOVE.extra = LAID;',
 'store-by-a-made-up-key': 'ABOVE[["ex", "tra"].join("")] = LAID;',
 'define':              'Object.defineProperty(ABOVE, "extra", { value: LAID, configurable: true, writable: true });',
 'define-properties':   'Object.defineProperties(ABOVE, { extra: { value: LAID, configurable: true } });',
 'reflect-set':         'Reflect.set(ABOVE, "extra", LAID);',
 'reflect-define':      'Reflect.defineProperty(ABOVE, "extra", { value: LAID, configurable: true });',
 'assign':              'Object.assign(ABOVE, { extra: LAID });',
 'through-the-object':  'Object.getPrototypeOf(o).extra = LAID;',
 'through-proto':       'o.__proto__.extra = LAID;',
 'through-the-constructor': 'o.constructor.prototype.extra = LAID;',
 'in-a-callee':         'lay(ABOVE, LAID);',
 'in-a-callee-by-key':  'layUnder(ABOVE, "extra", LAID);',
 'getter':              'Object.defineProperty(ABOVE, "extra", { get() { return LAID; }, configurable: true });',
 'define-getter':       'ABOVE.__defineGetter__("extra", () => LAID);',
 'relink-above':        'Object.setPrototypeOf(ABOVE, { extra: LAID });',
 'relink-the-object':   'Object.setPrototypeOf(o, Object.create(Object.getPrototypeOf(o), { extra: { value: LAID } }));',
 'by-a-loop':           'for (const [k, v] of Object.entries({ extra: LAID })) ABOVE[k] = v;',
 'by-a-kept-reference': 'kept.push(ABOVE); kept[0].extra = LAID;',
}
laid = { 'number': '7', 'function': '(function () { return "laid"; })', 'object': '({ deep: 1 })' }
looks = ['typeof p.extra', 'p.extra === undefined', '"extra" in p', 'String(p.extra?.deep)', 'typeof p?.extra', '(({ extra }) => typeof extra)(p)', 'typeof p["extra"]', 'typeof p.extra === "function" ? p.extra() : "no call"', 'Object.hasOwn(p, "extra")', 'p.extra ?? "nothing"' ]
count = 0
for holder, (before, made, above) in holders.items():
    for road, way in roads.items():
        for kind, value in laid.items():
            for number, look in enumerate(looks):
                if kind != 'number' and number in (1, 2, 8): continue
                for order in ('laid-first', 'looked-at-first'):
                    lines = ['// A name is laid above an object (%s) by %s: %s, %s.' % (holder.replace('-', ' '), road.replace('-', ' '), kind, order.replace('-', ' ')), before, 'const kept = [];',
                             'function lay(a, v) { a.extra = v; }', 'function layUnder(a, k, v) { a[k] = v; }', 'function look(p) { const seen = %s; return typeof seen === "object" || typeof seen === "function" ? typeof seen : seen; }' % look, 'const o = %s;' % made]
                    if order == 'looked-at-first': lines.append('console.log(look(o));')
                    lines += ['try { %s } catch (error) { console.log(error.constructor.name); }' % way.replace('ABOVE', above).replace('LAID', value), 'try { console.log(look(o)); } catch (error) { console.log(error.constructor.name); }']
                    with open(os.path.join(out, '%s-%s-%s-%d-%s.mjs' % (holder, road, kind, number, order)), 'w') as f:
                        f.write('\n'.join(l for l in lines if l) + '\n')
                    count += 1
print(count, 'programs')
