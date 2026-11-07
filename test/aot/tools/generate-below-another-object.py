# generate-below-another-object.py <folder>: all 2,268; ../parallel/below-another-object/ holds 2 of them: an object stands below another object than the one that its class or literal has above it. What stands there (a setter, a getter, both, a property that cannot be written, a method, a plain property)
# answers stores, reads, calls, `in`, delete and the rest. One program for each way of coming to stand there x what stands there x typed | erased. Every program prints what plain Bun prints.
import sys, os
out = sys.argv[1]
os.makedirs(out, exist_ok=True)

ways = {
 'object-create':                   'Object.create(above)',
 'object-create-with-descriptors':  'Object.create(above, { own: { value: 1, writable: true, enumerable: true, configurable: true } })',
 'object-create-twice':             'Object.create(Object.create(above))',
 'set-prototype-of-a-literal':      'Object.setPrototypeOf({ own: 1 }, above)',
 'set-prototype-of-an-empty-literal': 'Object.setPrototypeOf({}, above)',
 'set-prototype-of-an-instance':    'Object.setPrototypeOf(new Plain(), above)',
 'set-prototype-of-a-list':         'Object.setPrototypeOf([1], above)',
 'set-prototype-of-a-map':          'Object.setPrototypeOf(new Map(), above)',
 'set-prototype-of-a-function':     'Object.setPrototypeOf(function () {}, above)',
 'reflect-set-prototype-of':        '(o => (Reflect.setPrototypeOf(o, above), o))({ own: 1 })',
 'reflect-set-prototype-of-an-instance': '(o => (Reflect.setPrototypeOf(o, above), o))(new Plain())',
 'proto-in-a-literal':              '({ __proto__: above, own: 1 })',
 'proto-stored':                    '(o => (o.__proto__ = above, o))({ own: 1 })',
 'proto-stored-on-an-instance':     '(o => (o.__proto__ = above, o))(new Plain())',
 'proto-stored-on-a-list':          '(o => (o.__proto__ = above, o))([1])',
 'class-extends-a-function':        'new (class extends functionWith(above) {})()',
 'class-extends-an-expression':     'new (class extends [functionWith(above)][0] { own = 1; })()',
 'reflect-construct-object':        'Reflect.construct(Object, [], functionWith(above))',
 'reflect-construct-array':         'Reflect.construct(Array, [], functionWith(above))',
 'reflect-construct-map':           'Reflect.construct(Map, [], functionWith(above))',
 'reflect-construct-a-class':       'Reflect.construct(Plain, [], functionWith(above))',
 'reflect-construct-a-function':    'Reflect.construct(function () { this.own = 1; }, [], functionWith(above))',
 'constructor-function-with-another-prototype': 'new (functionWith(above))()',
 'prototype-of-a-class-gets-another-above': 'new (classBelow(above))()',
 'bound-function':                  'Function.prototype.bind.call(Object.setPrototypeOf(function () {}, above), null)',
 'object-create-of-an-instance-above': 'Object.create(Object.setPrototypeOf(new Plain(), above))',
 'assign-onto-created':             'Object.assign(Object.create(above), { own: 1 })',
}

aboves = {
 'setter':   '{ set slot(v) { if (v && typeof v === "object") { v.from = 42; v.added = "new"; delete v.gone; } kept.push(v); } }',
 'getter':   '{ get slot() { this.touched = true; return 7; } }',
 'both':     '{ get slot() { return this.hidden; }, set slot(v) { this.hidden = v; if (v && typeof v === "object") v.from = 42; } }',
 'unwritable': 'Object.defineProperty({}, "slot", { value: 1, writable: false, enumerable: true, configurable: true })',
 'method':   '{ slot(x) { this.called = true; if (x && typeof x === "object") { x.from = 42; delete x.gone; } return this; } }',
 'plain':    '{ slot: "inherited" }',
}

# name: body, which may use o (stands below), v (a value of class V), k (the text "slot")
deeds = [
 ('store',      'o.slot = v;'),
 ('read',       'r = o.slot;'),
 ('call',       'r = o.slot(v);'),
 ('has',        'r = "slot" in o;'),
 ('has-own',    'r = Object.hasOwn(o, "slot");'),
 ('delete',     'r = delete o.slot;'),
 ('store-then-delete', 'o.slot = v; r = delete o.slot;'),
 ('store-then-read',   'o.slot = v; r = o.slot;'),
 ('store-by-key',      'o[k] = v;'),
 ('read-by-key',       'r = o[k];'),
 ('add-to',     'o.slot += 1; r = o.slot;'),
 ('assign',     'Object.assign(o, { slot: v });'),
 ('reflect-set', 'r = Reflect.set(o, "slot", v);'),
 ('reflect-get', 'r = Reflect.get(o, "slot");'),
 ('take-apart', '({ slot: r } = o);'),
 ('for-in',     'r = ""; for (const name in o) r += name + ",";'),
 ('define',     'Object.defineProperty(o, "slot", { value: v, writable: true, enumerable: true, configurable: true }); r = o.slot === v;'),
 ('spread',     'r = Object.keys({ ...o }).join();'),
 ('store-a-number', 'o.slot = 5; r = o.slot;'),
 ('store-thrice', 'for (let i = 0; i < 3; i++) o.slot = v; r = kept.length;'),
]

# Which deeds what stands above answers. EACH DEED IS A PROGRAM OF ITS OWN: beside another deed the value would escape by that one, and the fault would hide.
asked = {
 'setter':     ['store', 'store-by-key', 'add-to', 'assign', 'reflect-set', 'store-thrice', 'store-then-read', 'store-then-delete', 'store-a-number', 'define'],
 'getter':     ['read', 'read-by-key', 'reflect-get', 'take-apart', 'add-to', 'for-in', 'has', 'store'],
 'both':       ['store-then-read', 'add-to', 'assign', 'read', 'store'],
 'unwritable': ['store', 'store-by-key', 'assign', 'reflect-set', 'add-to', 'define', 'delete'],
 'method':     ['call', 'read', 'store', 'delete'],
 'plain':      ['read', 'store-then-delete', 'has', 'has-own', 'for-in', 'delete', 'store', 'spread'],
}
bodies = dict(deeds)
count = 0
for way, made in ways.items():
    for what, above in aboves.items():
      for name in asked[what]:
        body = bodies[name]
        for typed in (False, True):
            A = ': any' if typed else ''
            Vt = ': V' if typed else ''
            St = ': string' if typed else ''
            Nt = ': number' if typed else ''
            L = ['// An object stands below another (%s), where %s stands under `slot`: %s (%s).' % (way.replace('-', ' '), {'setter': 'a setter', 'getter': 'a getter', 'both': 'a getter and a setter', 'unwritable': 'a property that cannot be written', 'method': 'a method', 'plain': 'a plain property'}[what], name.replace('-', ' '), 'typed' if typed else 'erased')]
            if typed:
                L.append('class V { from: any; gone: any; constructor(i: number) { this.from = "here" + i; this.gone = i; } }')
                L.append('class Plain { own = 1; }')
                L.append('let kept: any[] = [];')
            else:
                L.append('class V { constructor(i) { this.from = "here" + i; this.gone = i; } }')
                L.append('class Plain { own = 1; }')
                L.append('let kept = [];')
            if 'functionWith' in made:
                L.append('function functionWith(above%s)%s { function F(%s) {} F.prototype = above; return F; }' % (A, A, 'this: any' if typed else ''))
            if 'classBelow' in made:
                L.append('function classBelow(above%s)%s { class C { own = 1; } Object.setPrototypeOf(C.prototype, above); return C; }' % (A, A))
            L.append('function makeAbove()%s { return %s; }' % (A, above.replace('slot(v)', 'slot(v: any)').replace('slot(x)', 'slot(x: any)').replace('slot() {', 'slot(this: any) {').replace('slot(x: any) {', 'slot(this: any, x: any) {') if typed else above))
            L.append('function below(above%s)%s { return %s; }' % (A, A, made.replace('(o =>', '((o: any) =>').replace('function () { this.own = 1; }', 'function (this: any) { this.own = 1; }') if typed else made))
            L.append('function lengthOf(p%s) { return typeof p.from === "string" ? p.from.length : -1; }' % Vt)
            L.append('function showValue(p%s) { return typeof p.from + " " + p.from + " " + lengthOf(p) + " " + ("gone" in p) + " " + p.gone + " " + Object.keys(p).join(); }' % Vt)
            L.append('function showResult(r%s) { return r === undefined ? "undefined" : typeof r === "object" || typeof r === "function" ? typeof r : typeof r + ":" + (String(r).length > 30 ? "long" : String(r)); }' % A)
            L.append('function ownNames(o%s) { return Object.keys(o).join(); }' % A)
            L.append('function deed(o%s, v%s, k%s)%s { let r%s; %s return r; }' % (A, Vt, St, A, A, body))
            L.append('function attempt(i%s) { kept = []; const o = below(makeAbove()); const v = new V(i); let r%s; try { r = showResult(deed(o, v, "sl" + "ot")); } catch (e%s) { r = "threw " + e.name; } return r + " | " + showValue(v) + " | " + ownNames(o) + " | " + kept.length + " " + (kept[0] === v); }' % (Nt, A, A))
            L.append('console.log(attempt(1), "//", attempt(2));')
            L.append('let all = ""; for (let i = 0; i < 3; i++) all += attempt(i) + ";"; console.log(all);')
            open(os.path.join(out, 'below-%s-%s-%s.%s' % (way, what, name, 'ts' if typed else 'js')), 'w').write('\n'.join(L) + '\n')
            count += 1
print(count)
