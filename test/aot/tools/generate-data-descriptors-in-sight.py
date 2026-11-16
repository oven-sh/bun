#!/usr/bin/env python3
# all 406; ../parallel/data-descriptors-in-sight/ holds 0 of them.
# generate-data-descriptors-in-sight.py <folder>: `Object.defineProperty(F.prototype, "name", { value, writable: true, .. })` with the descriptor in sight is a store; the class that Babel writes out; a followed name lies nowhere else;
# instanceof of a constructor function that holds captures. One shape each, one observer a program, one file a program, held to `bun <file>`.
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
n = 0
def write(name, text):
    global n
    open(os.path.join(out, name + '.js'), 'w').write(text); n += 1

attempt = 'const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };\n'
head = attempt + 'function K(v) { this.v = v; }\nconst first = function first() { return this.v + 1; };\nconst other = function other() { return this.v + 100; };\n'
full = 'enumerable: false, configurable: true, writable: true'

# ---- D1 on the prototype object: how it is laid x who looks
readers = {
 'called-in-a-loop': 'function read(n) { let t = 0; for (let i = 0; i < n; i++) t += new K(i & 7).m(); return t; }',
 'read-not-called': 'function read(n) { const f = new K(1).m; return typeof f + (f === first) + (f === other); }',
 'listed-by-for-in': 'function read(n) { let t = ""; for (const k in new K(1)) t += k + ","; return t; }',
 'asked-of-the-holder': 'function read(n) { const d = Object.getOwnPropertyDescriptor(K.prototype, "m"); return d ? [typeof d.value, typeof d.get, d.enumerable, d.configurable, d.writable].join() : "none"; }',
 'stored-on-an-object-below': 'function read(n) { const o = new K(1); attempt(() => { o.m = 5; }); return typeof o.m + Object.keys(o).join(); }',
}
show = 'const show = (when) => console.log(when, attempt(() => read(5)));\n'
lay = 'Object.defineProperty(K.prototype, "m", { value: first, ' + full + ' });'
roads = {
 'laid-ahead': lay + ' show("a");',
 'read-above-the-definition': 'show("above"); ' + lay + ' show("behind");',
 'enumerable': 'Object.defineProperty(K.prototype, "m", { value: first, enumerable: true, configurable: true, writable: true }); show("a");',
 'read-only': 'Object.defineProperty(K.prototype, "m", { value: first, enumerable: false, configurable: true, writable: false }); show("a"); attempt(() => { K.prototype.m = other; }); show("b");',
 'read-only-by-leaving-it-out': 'Object.defineProperty(K.prototype, "m", { value: first, configurable: true }); show("a"); attempt(() => { K.prototype.m = other; }); show("b");',
 'read-only-in-strict-code': '"use strict"; Object.defineProperty(K.prototype, "m", { value: first, enumerable: false, configurable: true, writable: false }); show("a");',
 'not-configurable-and-defined-again': 'Object.defineProperty(K.prototype, "m", { value: first, enumerable: false, configurable: false, writable: false }); show("a"); console.log(attempt(() => Object.defineProperty(K.prototype, "m", { value: other, ' + full + ' }) && 1)); show("b");',
 'defined-again': lay + ' show("a"); Object.defineProperty(K.prototype, "m", { value: other, ' + full + ' }); show("b");',
 'defined-again-at-once': lay + ' Object.defineProperty(K.prototype, "m", { value: other, ' + full + ' }); show("b");',
 'stored-over-it': lay + ' show("a"); K.prototype.m = other; show("b");',
 'stored-first': 'K.prototype.m = other; show("a"); ' + lay + ' show("b");',
 'an-accessor-laid-over-it': lay + ' show("a"); Object.defineProperty(K.prototype, "m", { get() { return other; }, configurable: true }); show("b");',
 'an-accessor-laid-first': 'Object.defineProperty(K.prototype, "m", { get() { return other; }, configurable: true }); show("a"); ' + lay + ' show("b");',
 'deleted-later': lay + ' show("a"); delete K.prototype.m; show("b");',
 'under-a-condition-that-fails': 'if (process.argv.length > 99) ' + lay + ' show("a");',
 'in-a-function-called-later': 'function layIt() { ' + lay + ' } show("above"); layIt(); show("behind");',
 'either-of-two-values': 'Object.defineProperty(K.prototype, "m", { value: process.argv.length < 99 ? other : first, ' + full + ' }); show("a");',
 'a-flag-that-nobody-knows': 'Object.defineProperty(K.prototype, "m", { value: first, enumerable: process.argv.length < 99, configurable: true, writable: process.argv.length > 99 }); show("a"); attempt(() => { K.prototype.m = other; }); show("b");',
 'the-descriptor-is-kept-and-changed': 'const d = { value: first, ' + full + ' }; Object.defineProperty(K.prototype, "m", d); d.value = other; show("a");',
 'the-descriptor-is-kept-and-read': 'const d = { value: first, ' + full + ' }; Object.defineProperty(K.prototype, "m", d); show("a"); console.log(d.value.call({ v: 5 }));',
 'the-descriptor-is-kept-where-unseen-code-finds-it': 'const d = { value: first, ' + full + ' }; Object.defineProperty(K.prototype, "m", d); globalThis["ke" + "pt"] = d; show("a"); console.log(globalThis["ke" + "pt"].value.call({ v: "text" }));',
 'the-descriptor-is-changed-first': 'const d = { value: first, ' + full + ' }; d.value = other; Object.defineProperty(K.prototype, "m", d); show("a");',
 'the-descriptor-serves-twice': 'function J(v) { this.v = v * 2; } const d = { value: first, ' + full + ' }; Object.defineProperty(K.prototype, "m", d); Object.defineProperty(J.prototype, "m", d); show("a"); console.log(new J(4).m());',
 'the-descriptor-is-made-in-front-of-a-loop': 'const d = { value: first, ' + full + ' }; for (let i = 0; i < 2; i++) { Object.defineProperty(K.prototype, "m", d); d.value = other; } show("a");',
 'the-value-comes-by-a-getter': 'Object.defineProperty(K.prototype, "m", { get value() { return other; }, ' + full + ' }); show("a");',
 'the-value-is-inherited': 'Object.defineProperty(K.prototype, "m", Object.create({ value: other, ' + full + ' })); show("a");',
 'the-descriptor-is-spread': 'const base = { value: other }; Object.defineProperty(K.prototype, "m", { value: first, ' + full + ', ...base }); show("a");',
 'value-is-named-twice': 'Object.defineProperty(K.prototype, "m", { value: first, ' + full + ', value: other }); show("a");',
 'value-and-a-getter': 'console.log(attempt(() => Object.defineProperty(K.prototype, "m", { value: first, get() { return other; } }) && 1)); show("a");',
 'the-holder-takes-no-more': 'Object.preventExtensions(K.prototype); console.log(attempt(() => ' + lay[:-1] + ' && 1)); show("a");',
 'the-holder-is-frozen-behind': lay + ' Object.freeze(K.prototype); show("a"); attempt(() => { K.prototype.m = other; }); show("b");',
 'by-reflect': 'Reflect.defineProperty(K.prototype, "m", { value: first, ' + full + ' }); show("a");',
 'by-a-map-of-descriptors': 'Object.defineProperties(K.prototype, { m: { value: first, ' + full + ' } }); show("a");',
 'under-a-key-that-is-computed': 'Object.defineProperty(K.prototype, "m" + "", { value: first, ' + full + ' }); show("a");',
 'under-another-name-too': lay + ' Object.defineProperty(K.prototype, "w", { value: other, ' + full + ' }); show("a"); console.log(new K(2).w());',
 'on-either-of-two-holders': 'function J(v) { this.v = v; } J.prototype.m = other; Object.defineProperty((process.argv.length < 99 ? K : J).prototype, "m", { value: first, ' + full + ' }); show("a"); console.log(new J(1).m());',
 'on-the-object-that-goes': lay + ' K.prototype = { m: other }; show("a");',
 'on-the-object-that-comes': 'K.prototype = { w: 1 }; ' + lay + ' show("a");',
 'the-built-in-is-taken-first': 'const define = Object.defineProperty; define(K.prototype, "m", { value: first, ' + full + ' }); show("a");',
 'the-holder-is-a-proxy': 'const seen = []; K.prototype = new Proxy({ }, { defineProperty(t, k, d) { seen.push(typeof d.value); return Reflect.defineProperty(t, k, { ...d, value: other }); } }); ' + lay + ' show("a"); console.log(seen.join());',
 'the-value-is-no-function': 'Object.defineProperty(K.prototype, "m", { value: 7, ' + full + ' }); show("a"); console.log(new K(1).m + 1);',
 'the-value-is-an-object-that-is-changed': 'const box = { n: 1 }; Object.defineProperty(K.prototype, "m", { value: box, ' + full + ' }); new K(1).m.n = "text"; console.log(box.n, typeof new K(2).m.n);',
 'a-field-of-the-same-name': 'function J(v) { this.v = v; this.m = 3; } Object.defineProperty(J.prototype, "m", { value: first, enumerable: false, configurable: true, writable: false }); console.log(attempt(() => typeof new J(1).m + Object.keys(new J(1)).join()));',
 'a-field-of-the-same-name-writable': 'function J(v) { this.v = v; this.m = 3; } Object.defineProperty(J.prototype, "m", { value: first, ' + full + ' }); console.log(attempt(() => typeof new J(1).m + Object.keys(new J(1)).join()));',
}
for rn, r in readers.items():
    for dn, d in roads.items():
        write(f'prototype--{dn}--{rn}', head + r + '\n' + show + d + '\n')

# ---- D1 on the function itself
head2 = attempt + 'function K(v) { this.v = v; }\nconst first = function first(v) { return new K(typeof v === "string" ? v.length : v + 1); };\nconst other = function other(v) { return new K(100); };\n'
readers2 = {
 'called-in-a-loop': 'function read(n) { let t = 0; for (let i = 0; i < n; i++) t += K.of(i & 7).v; return t; }',
 'listed': 'function read(n) { let t = Object.keys(K).join() + "|"; for (const k in K) t += k; return t; }',
 'asked-of-the-holder': 'function read(n) { const d = Object.getOwnPropertyDescriptor(K, "of"); return d ? [typeof d.value, typeof d.get, d.enumerable, d.configurable, d.writable].join() : "none"; }',
}
lay2 = 'Object.defineProperty(K, "of", { value: first, ' + full + ' });'
roads2 = {
 'laid-ahead': lay2 + ' show("a");',
 'read-above-the-definition': 'show("above"); ' + lay2 + ' show("behind");',
 'enumerable': 'Object.defineProperty(K, "of", { value: first, enumerable: true, configurable: true, writable: true }); show("a");',
 'read-only': 'Object.defineProperty(K, "of", { value: first, enumerable: false, configurable: true, writable: false }); show("a"); attempt(() => { K.of = other; }); show("b");',
 'defined-again': lay2 + ' show("a"); Object.defineProperty(K, "of", { value: other, ' + full + ' }); show("b");',
 'stored-over-it': lay2 + ' show("a"); K.of = other; show("b");',
 'an-accessor-laid-over-it': lay2 + ' show("a"); Object.defineProperty(K, "of", { get() { return other; }, configurable: true }); show("b");',
 'deleted-later': lay2 + ' show("a"); delete K.of; show("b");',
 'the-descriptor-is-kept-and-read': 'const d = { value: first, ' + full + ' }; Object.defineProperty(K, "of", d); show("a"); console.log(d.value("text").v);',
 'the-descriptor-is-kept-where-unseen-code-finds-it': 'const d = { value: first, ' + full + ' }; Object.defineProperty(K, "of", d); globalThis["ke" + "pt"] = d; show("a"); console.log(globalThis["ke" + "pt"].value("text").v);',
 'on-either-of-two-functions': 'function J(v) { this.v = v; } J.of = other; Object.defineProperty(process.argv.length < 99 ? K : J, "of", { value: first, ' + full + ' }); show("a"); console.log(J.of(1).v);',
 'read-through-either-of-two-functions': 'function J(v) { this.v = v; } J.of = other; ' + lay2 + ' const pick = process.argv.length < 99 ? K : J; const of = pick.of; console.log(of("text").v); show("a");',
 'the-name-is-has-instance': 'Object.defineProperty(K, Symbol.hasInstance, { value: function () { return "yes"; }, ' + full + ' }); console.log(5 instanceof K, new K(1) instanceof K);',
 'the-name-is-prototype': 'console.log(attempt(() => Object.defineProperty(K, "prototype", { value: { m: 1 }, writable: true }) && 1), new K(1).m);',
 'the-name-is-name': 'Object.defineProperty(K, "name", { value: "Other", ' + full + ' }); console.log(K.name);',
 'the-name-is-call': 'Object.defineProperty(K, "call", { value: function () { return 7; }, ' + full + ' }); console.log(K.call(null, 1));',
 'the-function-takes-no-more': 'Object.preventExtensions(K); console.log(attempt(() => ' + lay2[:-1] + ' && 1)); show("a");',
 'found-from-a-function-below': lay2 + ' function Sub() { } Object.setPrototypeOf(Sub, K); console.log(Sub.of(1).v); show("a");',
}
for rn, r in readers2.items():
    for dn, d in roads2.items():
        write(f'function--{dn}--{rn}', head2 + r + '\n' + show + d + '\n')

# ---- T2: Babel's helper, as published
babel = '''function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }
function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }
function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }
'''
def cls(protos, statics='', check=True, more=''):
    c = '_classCallCheck(this, Counter); ' if check else ''
    s = ', [' + statics + ']' if statics else ''
    return 'var Counter = function () { function Counter(step) { ' + c + 'this.step = step; this.value = 0; }\n  _createClass(Counter, [' + protos + ']' + s + ');\n  ' + more + 'return Counter; }();\n'
bump = '{ key: "bump", value: function bump() { this.value += this.step; return this; } }'
of = '{ key: "of", value: function of(step) { return new Counter(step); } }'
loop = 'function run(n) { var t = 0; for (var i = 0; i < n; i++) t += new Counter(i & 3).bump().bump().value; return t; }\n'
t2 = {
 'a-method': cls(bump) + loop + 'console.log(run(20));',
 'a-method-and-a-static': cls(bump, of) + 'function run(n) { var t = 0; for (var i = 0; i < n; i++) t += Counter.of(i & 3).bump().value; return t; }\nconsole.log(run(20));',
 'called-without-new': cls(bump) + 'console.log(attempt(() => Counter(1)));',
 'what-the-method-is': cls(bump) + 'var d = Object.getOwnPropertyDescriptor(Counter.prototype, "bump"); console.log(d.value.name, d.enumerable, d.configurable, d.writable, Object.keys(d).join());',
 'what-the-static-is': cls(bump, of) + 'var d = Object.getOwnPropertyDescriptor(Counter, "of"); console.log(d.value.name, d.enumerable, d.configurable, d.writable, Object.keys(Counter).join());',
 'a-function-without-a-name': cls('{ key: "bump", value: function () { return 1; } }') + 'console.log(JSON.stringify(Counter.prototype.bump.name));',
 'an-arrow': cls('{ key: "bump", value: () => 4 }') + 'console.log(new Counter(1).bump(), JSON.stringify(Counter.prototype.bump.name));',
 'enumerable-is-written': cls('{ key: "bump", enumerable: true, value: function bump() { return 1; } }') + 'var t = ""; for (var k in new Counter(1)) t += k + ","; console.log(t);',
 'enumerable-is-written-false': cls('{ key: "bump", enumerable: false, value: function bump() { return 1; } }') + 'var t = ""; for (var k in new Counter(1)) t += k + ","; console.log(t);',
 'enumerable-is-a-number': cls('{ key: "bump", enumerable: 1, value: function bump() { return 1; } }') + 'console.log(Object.getOwnPropertyDescriptor(Counter.prototype, "bump").enumerable);',
 'writable-is-written-false': cls('{ key: "bump", writable: false, value: function bump() { return 1; } }') + 'console.log(Object.getOwnPropertyDescriptor(Counter.prototype, "bump").writable);',
 'configurable-is-written-false': cls('{ key: "bump", configurable: false, value: function bump() { return 1; } }') + 'console.log(Object.getOwnPropertyDescriptor(Counter.prototype, "bump").configurable);',
 'a-getter': cls(bump + ', { key: "double", get: function get() { return this.value * 2; } }') + 'console.log(new Counter(2).bump().double, Object.getOwnPropertyDescriptor(Counter.prototype, "double").get.name);',
 'a-getter-and-a-setter': cls('{ key: "w", get: function get() { return this.value; }, set: function set(v) { this.value = v * 2; } }') + 'var c = new Counter(1); c.w = 4; console.log(c.w);',
 'a-value-that-is-a-number': cls('{ key: "size", value: 7 }') + 'console.log(new Counter(1).size + 1);',
 'the-key-is-a-number': cls('{ key: 0, value: function zero() { return "z"; } }') + 'console.log(new Counter(1)[0]());',
 'the-key-looks-like-an-index': cls('{ key: "0", value: function zero() { return "z"; } }') + 'console.log(new Counter(1)[0](), Object.getOwnPropertyNames(Counter.prototype).join());',
 'the-key-is-named-twice': cls('{ key: "a", key: "b", value: function f() { return 1; } }') + 'console.log(Object.getOwnPropertyNames(Counter.prototype).join());',
 'the-key-is-constructor': cls('{ key: "constructor", value: function other() { } }') + 'console.log(new Counter(1).constructor.name);',
 'the-key-is-proto': cls('{ key: "__proto__", value: function p() { return 1; } }') + 'console.log(typeof new Counter(1).__proto__, Object.getOwnPropertyNames(Counter.prototype).join());',
 'another-name-in-the-descriptor': cls('{ key: "bump", kind: "method", value: function bump() { return 1; } }') + 'console.log(new Counter(1).bump());',
 'two-methods-one-name': cls(bump + ', { key: "bump", value: function second() { return "second"; } }') + 'console.log(new Counter(1).bump());',
 'two-classes': cls(bump) + cls('{ key: "bump", value: function bump() { return "other"; } }').replace('Counter', 'Other') + 'console.log(new Counter(1).bump().value, new Other(1).bump());',
 'the-method-is-replaced-later': cls(bump) + loop + 'console.log(run(4)); Counter.prototype.bump = function () { this.value = 50; return this; }; console.log(run(4));',
 'the-static-is-replaced-later': cls(bump, of) + 'console.log(Counter.of(2).step); Counter.of = function () { return { step: "s" }; }; console.log(Counter.of(2).step);',
 'the-method-is-read-by-native-code': cls(bump) + 'console.log(Object.getOwnPropertyNames(Counter.prototype).map((k) => typeof Counter.prototype[k]).join());',
 'the-method-is-called-with-another-this': cls(bump) + 'console.log(Counter.prototype.bump.call({ value: "a", step: "b" }).value);',
 'the-helper-is-replaced': cls(bump).replace('var Counter', '_createClass = function (C) { C.prototype.bump = function () { return "mine"; }; return C; };\nvar Counter') + 'console.log(new Counter(1).bump());',
 'define-property-is-taken-away': 'var kept = Object.defineProperty;\n' + cls(bump) + 'console.log(typeof kept, new Counter(1).bump().value);',
 'made-twice-by-a-factory': 'function make() { function Counter(step) { this.step = step; this.value = 0; }\n  _createClass(Counter, [' + bump + ']); return Counter; }\nvar A = make(), B = make(); B.prototype.bump = function () { return "b"; }; console.log(new A(1).bump().value, new B(1).bump(), new A(1) instanceof B);',
}
for name, text in t2.items():
    write(f'babel--{name}', attempt + babel + text + '\n')

# ---- I3: instanceof of a constructor function that holds captures
def scoped(body, more=''):
    return attempt + 'var K = function () { var made = 0; function K(v) { made++; this.v = v; }\n  K.count = function () { return made; };\n  ' + more + 'return K; }();\n' + body + '\n'
i3 = {
 'its-own-object': 'function run(n) { var t = 0; for (var i = 0; i < n; i++) t += new K(i) instanceof K ? 1 : 0; return t; } console.log(run(9), K.count());',
 'a-literal': 'function run(n) { var t = 0; for (var i = 0; i < n; i++) t += { v: i } instanceof K ? 1 : 0; return t; } console.log(run(9));',
 'a-primitive': 'console.log(5 instanceof K, null instanceof K, "s" instanceof K);',
 'made-by-object-create': 'console.log(Object.create(K.prototype) instanceof K, Object.create(null) instanceof K);',
 'an-object-of-another-function': 'function J() { } console.log(new J() instanceof K, new K(1) instanceof J);',
 'an-object-from-below': 'function J(v) { K.call(this, v); } J.prototype = Object.create(K.prototype); console.log(new J(1) instanceof K, new K(1) instanceof J);',
 'the-prototype-is-stored-later': 'var o = new K(1); console.log(o instanceof K); K.prototype = { }; console.log(o instanceof K, new K(2) instanceof K);',
 'the-object-is-relinked': 'var o = new K(1); Object.setPrototypeOf(o, null); console.log(o instanceof K);',
 'the-object-is-relinked-to-it': 'var o = { }; Object.setPrototypeOf(o, K.prototype); console.log(o instanceof K);',
 'has-instance-is-laid': 'Object.defineProperty(K, Symbol.hasInstance, { value: function (x) { return x === 7; } }); console.log(new K(1) instanceof K, 7 instanceof K);',
 'has-instance-is-laid-above': 'var above = function () { }; Object.defineProperty(above, Symbol.hasInstance, { value: function (x) { return x === 7; } }); Object.setPrototypeOf(K, above); console.log(new K(1) instanceof K, 7 instanceof K);',
 'the-prototype-is-no-object': 'K.prototype = 5; console.log(attempt(() => ({ }) instanceof K));',
 'a-bound-function-of-it': 'var B = K.bind(null); console.log(new K(1) instanceof B, new B(1) instanceof K);',
 'a-proxy-of-the-object': 'var p = new Proxy(new K(1), { getPrototypeOf() { return null; } }); console.log(p instanceof K);',
 'a-proxy-of-the-function': 'var P = new Proxy(K, { get(t, k) { return k === "prototype" ? Array.prototype : t[k]; } }); console.log([] instanceof P, new K(1) instanceof P);',
 'through-a-helper': 'function check(x, C) { return x instanceof C; } function run(n) { var t = 0; for (var i = 0; i < n; i++) t += check(i & 1 ? new K(i) : { }, K) ? 1 : 0; return t; } console.log(run(9));',
 'in-its-own-body': '',
}
for name, text in i3.items():
    if text:
        write(f'captures--{name}', scoped(text))
write('captures--in-its-own-body', attempt + 'var K = function () { function K(v) { if (!(this instanceof K)) return new K(v); this.v = v; } return K; }();\nfunction run(n) { var t = 0; for (var i = 0; i < n; i++) t += (i & 1 ? K(i) : new K(i)).v; return t; } console.log(run(9), attempt(() => K.call({ }, 3).v));\n')
write('captures--made-twice-by-a-factory', attempt + 'function make() { var made = 0; function K(v) { made++; this.v = v; } K.count = function () { return made; }; return K; }\nvar A = make(), B = make(); function run(n) { var t = 0; for (var i = 0; i < n; i++) t += (new A(i) instanceof B ? 10 : 0) + (new A(i) instanceof A ? 1 : 0); return t; } console.log(run(5), A.count(), B.count());\n')
write('captures--made-in-a-loop', attempt + 'var all = []; for (var i = 0; i < 2; i++) { all.push(function () { var made = 0; function K(v) { made++; this.v = v; } return K; }()); }\nconsole.log(new all[0](1) instanceof all[1], new all[1](1) instanceof all[1]);\n')

# ---- S2: what lies on a function, and code that reads under keys nobody knows
head3 = attempt + 'function Ok(v) { this.v = v; }\nOk.of = function (v) { return new Ok(typeof v === "string" ? v.length : v); };\nOk.tag = { kind: "ok", n: 1 };\nconst say = (x) => console.log(typeof x === "object" && x ? JSON.stringify(x) : String(x));\n'
s2 = {
 'values': 'const vs = Object.values(Ok); say(vs.length); say(vs[0]("text").v); vs[1].n = "changed"; say(Ok.tag.n);',
 'entries': 'for (const [k, v] of Object.entries(Ok)) { if (typeof v === "function") say(k + v("four").v); else { v.n = [1]; say(Ok.tag.n); } }',
 'assign': 'const copy = Object.assign({}, Ok); say(copy.of("abc").v); copy.tag.n = "s"; say(Ok.tag.n);',
 'spread': 'const copy = { ...Ok }; say(copy.of("abcd").v); copy.tag.n = null; say(Ok.tag.n);',
 'descriptor': 'const d = Object.getOwnPropertyDescriptor(Ok, "of"); say(d.value("ab").v); const t = Object.getOwnPropertyDescriptor(Ok, "tag"); t.value.n = "x"; say(Ok.tag.n);',
 'descriptors': 'const ds = Object.getOwnPropertyDescriptors(Ok); say(ds.of.value("abcde").v); ds.tag.value.n = true; say(Ok.tag.n);',
 'reflect-get': 'say(Reflect.get(Ok, "of")("abcdef").v); Reflect.get(Ok, "tag").n = "r"; say(Ok.tag.n);',
 'for-in': 'for (const k in Ok) { const v = Ok[k]; if (typeof v === "function") say(v("q").v); else { v.n = "f"; say(Ok.tag.n); } }',
 'own-keys': 'for (const k of Reflect.ownKeys(Ok)) { const v = Ok[k]; if (k === "of") say(v("qq").v); if (k === "tag") { v.n = 7.5; say(Ok.tag.n); } }',
 'to-json': 'Ok.toJSON = function () { return { from: this.tag.kind }; }; say(JSON.stringify({ a: Ok }));',
 'inspect': 'const { inspect } = require("node:util"); Ok.tag[inspect.custom] = function () { this.n = "seen"; return "T"; }; say(inspect(Ok).includes("T")); say(Ok.tag.n);',
 'printed': 'Ok.tag.toString = function () { this.n = "printed"; return "T"; }; console.log(Ok); say(Ok.tag.n);',
 'thrown-and-printed': 'Ok.tag.n = 2; process.on("uncaughtException", () => { say(Ok.tag.n); }); throw Ok;',
 'from-entries': 'const o = Object.fromEntries(Object.entries(Ok)); say(o.of("fe").v); o.tag.n = "z"; say(Ok.tag.n);',
 'it-meets-an-object': 'const x = process.argv.length < 99 ? Ok : { of(v) { return { v: "object" }; } }; say(x.of("meets").v);',
 'it-meets-an-object-under-a-key': 'const x = [Ok, { of(v) { return { v: "object" }; } }][process.argv.length < 99 ? 0 : 1]; say(x["o" + "f"]("meets!").v);',
 'an-object-with-the-name-read-under-a-key': 'const o = { of: function (v) { return { v: "mine" }; } }; say(o["o" + "f"](1).v); say(Ok.of(2).v);',
 'an-unknown-object-read-under-the-name': 'const o = JSON.parse(\'{"of":5}\'); say(o.of); say(Ok.of("three").v);',
 'handed-to-unseen-code': 'globalThis["ke" + "pt"] = Ok; say(globalThis["ke" + "pt"].of("unseen").v);',
 'a-map-holds-it': 'const m = new Map([["k", Ok]]); say(m.get("k").of("mapped").v);',
 'a-list-holds-it': 'const l = [Ok]; say(l[0].of("listed").v); l[0].tag.n = "l"; say(Ok.tag.n);',
 'a-weak-ref-holds-it': 'const w = new WeakRef(Ok); say(w.deref().of("weak").v);',
 'with-an-error-thrown-beside': 'function check(x) { if (!(x instanceof Ok)) throw new TypeError("no"); return x; } say(check(Ok.of(4)).v); say(attempt(() => check({ })));',
}
for name, text in s2.items():
    write(f'lies-on-a-function--{name}', head3 + text + '\n')
# ---- D1 where the definition is NO store: the value lies under the name of some other holder, where anybody may read it
head4 = attempt + 'const first = function first(v) { return typeof v === "string" ? v.length : v + 1; };\n'
holders = {
 'a-class': 'class H { }',
 'the-prototype-object-of-a-class': 'class C { } const H = C.prototype;',
 'a-literal': 'const H = { w: 1 };',
 'an-empty-literal': 'const H = { };',
 'a-list': 'const H = [1];',
 'a-map': 'const H = new Map();',
 'an-arrow': 'const H = () => 1;',
 'a-bound-function': 'const H = function () { }.bind(null);',
 'an-object-without-a-prototype': 'const H = Object.create(null);',
 'an-object-below-a-function': 'function F() { } const H = new F();',
 'an-error': 'const H = new Error("e");',
 'the-global-object': 'const H = globalThis;',
 'a-parameter': 'function take(H) { Object.defineProperty(H, "of", { value: first, ' + full + ' }); return H; } const H = take({ w: 1 });',
 'what-a-call-gives': 'function give() { return { w: 1 }; } const H = give();',
 'either-of-two-kinds': 'function F() { } const H = process.argv.length < 99 ? { w: 1 } : F;',
}
lookers = {
 'called-by-name': 'console.log(H.of("text"), H.of(1));',
 'called-under-a-key': 'console.log(H["o" + "f"]("text"));',
 'taken-by-its-description': 'console.log(Object.getOwnPropertyDescriptor(H, "of").value("text"));',
 'called-from-below': 'console.log(Object.create(H).of("text"));',
}
for hn, h in holders.items():
    for ln, l in lookers.items():
        define = '' if hn == 'a-parameter' else 'Object.defineProperty(H, "of", { value: first, ' + full + ' });\n'
        write(f'elsewhere--{hn}--{ln}', head4 + h + '\n' + define + l + '\n')
print(n, 'programs')
