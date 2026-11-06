# f(x, *positional, **keywords) where the function, or what is after a star, is of JS.
import re

import js

describe = js.eval('''(function () { "use strict"; return typeof this + " " + arguments.length + ": " + Array.prototype.map.call(arguments, a =>
    a === null ? "null" : Array.isArray(a) ? "[" + a.join() + "]" : typeof a === "object" ? "{" + Object.keys(a).map(k => k + ":" + a[k]).join() + "}" : typeof a + ":" + a).join(" ") })''')
sloppy = js.eval('(function (a, b) { return (this === globalThis) + " " + arguments.length + " " + a + " " + b })')
arrow = js.eval('((a, b = "default", ...rest) => a + "/" + b + "/" + rest.length)')
Class = js.eval('(class Point { constructor(x, y) { this.x = x; this.y = y } toString() { return "Point(" + this.x + "," + this.y + ")" } })')
bound = js.eval('(function (a, b, c) { return [this.tag, a, b, c].join() }).bind({ tag: "bound" }, "first")')
trapped = js.eval('new Proxy(function () {}, { apply(target, self, args) { return "trapped " + args.length + " " + args.join() } })')
throws = js.eval('(function (a) { throw new RangeError("from JS " + a) })')
holder = js.eval('({ tag: "holder", method(a, b) { return this.tag + " " + arguments.length + " " + a + " " + b } })')
foreign = {'describe': describe, 'sloppy': sloppy, 'arrow': arrow, 'Class': Class, 'bound': bound, 'trapped': trapped, 'throws': throws, 'Math.max': js.Math.max, 'Array.of': js.Array.of}


def fvk(*args, **kw): return (args, kw)
def f2(a, b=2): return (a, b)


def attempt(function, *args):
    try:
        return re.sub('0x[0-9a-f]+', 'ADDRESS', str(function(*args)))
    except Exception as error:
        return '%s: %s' % (type(error).__name__, error)


forms = {
    'f(*p)': lambda f, p, k: f(*p),
    'f(0, *p)': lambda f, p, k: f(0, *p),
    'f(0, 1.0, *p)': lambda f, p, k: f(0, 1.0, *p),
    'f(**k)': lambda f, p, k: f(**k),
    'f(*p, **k)': lambda f, p, k: f(*p, **k),
    'f(0, *p, **k)': lambda f, p, k: f(0, *p, **k),
    'f(0, **k)': lambda f, p, k: f(0, **k),
    'f(*p, x=1)': lambda f, p, k: f(*p, x=1),
    'f(*p, *p)': lambda f, p, k: f(*p, *p),
}

print('--- functions of JS')
for name, f in foreign.items():
    for form, call in forms.items():
        rows = [' | '.join(attempt(call, f, p(), k) for p in (tuple, lambda: (7,), lambda: [7, 8.0], lambda: iter((7, 8.5, 'nine'))) for k in ({}, {'b': 8.0})) for turn in range(3)]
        print(name, form, '|', rows[0], '' if rows[0] == rows[1] == rows[2] else 'AND THEN ' + rows[1] + ' AND THEN ' + rows[2])
print(holder.method(*(1, 2)), holder.method(1, *(2,)), holder.method(*(), **{}), holder.method(*(1,), **{'b': 2}), attempt(lambda: holder.absent(*(1,))))

print('--- arrays and other things of JS after the star')
sources = {
    'ints': '[1, 2, 3]', 'doubles': '[1.5, 2.5]', 'mixed': '[1, "two", null, undefined, 3.5]', 'empty': '[]', 'a hole': '[1, , 3]', 'only holes': 'new Array(3)',
    'a hole among doubles': '[1.5, , 3.5]', 'sparse': '(() => { const a = [1]; a[5000] = 2; a.length = 4; return a })()', 'frozen': 'Object.freeze([1, 2])',
    'of a class': '(() => { class Mine extends Array {}; return Mine.of(1, 2) })()',
    'a set': 'new Set([1, 2])', 'a map': 'new Map([[1, 2]])', 'a generator': '(function* () { yield 1; yield 2 })()', 'a typed array': 'new Uint8Array([1, 2])', 'a string object': 'new String("ab")',
    'arguments': '(function () { return arguments })(1, 2)', 'an object': '({ a: 1 })', 'a function': '(function () {})', 'a generator that throws': '(function* () { yield 1; throw new TypeError("from the generator") })()',
}
for name, source in sources.items():
    rows = [' | '.join(attempt(call, f, js.eval(source), {}) for f in (fvk, describe) for call in (forms['f(*p)'], forms['f(0, *p)'], forms['f(*p, **k)'], forms['f(*p, x=1)'])) for turn in range(3)]
    print(name, '|', rows[0], '' if rows[0] == rows[1] == rows[2] else 'AND THEN ' + rows[1] + ' AND THEN ' + rows[2])

print('--- arrays that say they are longer than any call can take')
for length in ('4294967295', '4294967294', '1048577'):
    for form in ('f(*p)', 'f(0, *p)', 'f(0, 1.0, *p)', 'f(*p, **k)', 'f(0, *p, **k)', 'f(*p, x=1)'):
        print(length, form, '|', ' | '.join(attempt(forms[form], f, js.eval('(() => { const a = []; a.length = %s; return a })()' % length), k)[:14] for f in (fvk, f2, describe) for k in ({}, {'b': 1})))

print('--- a prototype that answers for the holes')
js.eval('Object.defineProperty(Array.prototype, 1, { get() { return "from the prototype" }, configurable: true })')
for source in ('[1, , 3]', 'new Array(2)', '[1.5, , 3.5]'):
    print(source, '|', ' | '.join(attempt(call, f, js.eval(source), {}) for f in (fvk, describe) for call in (forms['f(*p)'], forms['f(0, *p)'], forms['f(*p, x=1)'])))
js.eval('delete Array.prototype[1]')

print('--- things of JS after the two stars')
for name, source in {'an object': '({ a: 1, b: 2 })', 'empty': '({})', 'a map': 'new Map([["a", 1]])', 'null prototype': 'Object.assign(Object.create(null), { a: 1 })', 'an array': '[1]', 'a number key': '({ 1: 2 })',
        'a getter': '({ get a() { return "got" } })', 'of a class': 'new (class K { constructor() { this.a = 1 } })()', 'a function': '(function () {})'}.items():
    rows = [' | '.join(attempt(call, f, (5,), js.eval(source)) for f in (fvk, f2, describe) for call in (forms['f(**k)'], forms['f(*p, **k)'], forms['f(0, **k)'])) for turn in range(3)]
    print(name, '|', rows[0], '' if rows[0] == rows[1] == rows[2] else 'AND THEN ' + rows[1] + ' AND THEN ' + rows[2])

print('--- JS calls Python, which passes it on')
forward = js.eval('(function (f, ...rest) { return String(f(...rest)) })')


def passes_on(*args, **kw): return fvk(*args, **kw)
def passes_on_with_more(*args, **kw): return fvk('more', *args, **kw)
def passes_on_to_js(*args, **kw): return describe(*args, **kw)


for f in (passes_on, passes_on_with_more, passes_on_to_js):
    for turn in range(1):
        print(f.__name__, forward(f), forward(f, 1), forward(f, 1, 2.5, 'three'), forward(f, js.eval('[1, 2]')), forward(f, None))
