# f(*a) where a is an array of JS: of every kind that an array can be, empty, and of doubles up to where the interpreter copies them itself and beyond.
import re

import js


def fvk(*args, **kw): return (args, kw)


def attempt(function, *args):
    try:
        return re.sub('0x[0-9a-f]+', 'ADDRESS', str(function(*args)))
    except Exception as error:
        return '%s: %s' % (type(error).__name__, error)


forms = {
    'f(*p)': lambda f, p, k: f(*p),
    'f(0, *p)': lambda f, p, k: f(0, *p),
    'f(*p, **k)': lambda f, p, k: f(*p, **k),
    'f(*p, x=1)': lambda f, p, k: f(*p, x=1),
}

print('--- arrays with nothing in them, of every kind, and with doubles up to where the interpreter copies them and beyond')
kind_of = js.eval('(a => /\\}, (\\w+),/.exec(process.getBuiltinModule("bun:jsc").describe(a))?.[1])')
empties = {
    'never had an item': '[]', 'ints emptied': '(() => { const a = [1, 2, 3]; a.length = 0; return a })()', 'doubles emptied': '(() => { const a = [1.5, 2.5]; a.length = 0; return a })()',
    'doubles popped': '(() => { const a = [1.5]; a.pop(); return a })()', 'strs emptied': '(() => { const a = ["a", "b"]; a.length = 0; return a })()',
    'sparse, emptied': '(() => { const a = [1, 2]; a[5000000] = 1; a.length = 0; return a })()', 'sparse, of doubles, emptied': '(() => { const a = [1.5, 2.5]; a[5000000] = 1; a.length = 0; return a })()',
    # (In a realm of its own: all arrays of the realm are of that kind from then on.)
    'with a setter in a prototype': 'process.getBuiltinModule("node:vm").runInNewContext("Object.defineProperty(Array.prototype, 0, { set(v) {}, configurable: true }); const a = [1.5]; a.length = 0; a")',
    'frozen after emptying doubles': '(() => { const a = [1.5]; a.length = 0; return Object.freeze(a) })()',
}
for name, source in empties.items():
    a = js.eval(source)
    rows = [' | '.join(attempt(call, fvk, a, {}) for call in (forms['f(*p)'], forms['f(0, *p)'], forms['f(*p, **k)'], forms['f(*p, x=1)'])) for turn in range(3)]
    print(name, '|', kind_of(a), '|', rows[0], '' if rows[0] == rows[1] == rows[2] else 'AND THEN ' + rows[1] + ' AND THEN ' + rows[2])
for length in (1, 2, 3, 95, 96, 97, 127, 128, 129, 130, 300):
    for hole in (None, 0, length // 2, length - 1):
        a = js.eval('(() => { const a = []; for (let i = 0; i < %d; i++) a.push(i + 0.5); %s; return a })()' % (length, 'delete a[%d]' % hole if hole is not None else ''))
        expected = tuple(None if i == hole else i + 0.5 for i in range(length))
        got, after_two = fvk(*a)[0], fvk('x', 2.0, *a, **{})[0]
        print(length, hole, kind_of(a), got == expected, all(type(x) is type(y) for x, y in zip(got, expected)), after_two == ('x', 2.0, *expected))

print('--- what is in an array of doubles, or would be but for one item: each item comes through as a[i] gives it')
import struct


def told(items):
    return [(type(x).__name__, struct.pack('<d', x).hex() if type(x) is float else repr(x)) for x in items]


def f3(a, b, c): return (a, b, c)


sources = {
    'a literal (copied when written to)': '(() => [0.5, 1.5, 2.5])()', 'NaN': '[0.5, NaN, 2.5]', '0 / 0 stored': '(() => { const a = [0.5, 1.5, 2.5]; a[1] = Math.sqrt(-1); return a })()',
    'a NaN with other bits': '(() => { const a = [0.5, 1.5, 2.5]; a[1] = new Float64Array(new BigUint64Array([0x7ff8000000000001n]).buffer)[0]; return a })()',
    '-0': '[0.5, -0, 2.5]', 'infinities': '[Infinity, -Infinity, 2.5]', 'the smallest': '[5e-324, 2.2250738585072014e-308, 2.5]', 'whole numbers': '[0.5, 2, -3]',
    'whole numbers stored': '(() => { const a = [0.5, 1.5, 2.5]; a[0] = 7; a[2] = 4294967296; return a })()', 'after shift()': '(() => { const a = [9.5, 0.5, 1.5, 2.5]; a.shift(); return a })()',
    'after pop()': '(() => { const a = [0.5, 1.5, 2.5, 9.5]; a.pop(); return a })()', 'room for more': '(() => { const a = []; for (let i = 0; i < 50; i++) a.push(i + 0.5); a.length = 3; return a })()',
    'made longer': '(() => { const a = [0.5]; a.length = 3; return a })()', 'holes only': '(() => { const a = [0.5, 1.5, 2.5]; delete a[0]; delete a[1]; delete a[2]; return a })()',
    'a hole, and the index in the prototype': 'process.getBuiltinModule("node:vm").runInNewContext("Array.prototype[1] = 8.5; const a = [0.5, 1.5, 2.5]; delete a[1]; a")',
    'sealed': 'Object.seal([0.5, 1.5, 2.5])', 'not extensible': 'Object.preventExtensions([0.5, 1.5, 2.5])', 'with a property': 'Object.assign([0.5, 1.5, 2.5], { tag: 1 })',
    'of a class derived from Array': '(() => { class A extends Array {} const a = new A(); a.push(0.5, 1.5, 2.5); return a })()',
}
for name, source in sources.items():
    a = js.eval(source)
    want = told(a[i] for i in range(3))
    print(name, '|', kind_of(a), '|', [a[i] for i in range(3)], '|', *(told(got) == want for got in (fvk(*a)[0], fvk(7.5, *a)[0][1:], fvk(*a, **{})[0], fvk(*a, x=1)[0], f3(*a), tuple(a), [*a], list(a))))

print('--- sorted, and tuple, of arrays of every kind, with a key that changes the array')
for name, source in (('doubles', '[2.5, 0.5, 1.5]'), ('doubles and a hole', '(() => { const a = [2.5, 0.5, 1.5, 3.5]; delete a[1]; return a })()'), ('ints', '[3, 1, 2]'),
                     ('sparse', '(() => { const a = [2.5, 0.5, 1.5]; a[5000000] = 1; a.length = 3; return a })()'), ('frozen', 'Object.freeze([2.5, 0.5, 1.5])')):
    for action in ('nothing', 'append', 'clear', 'store'):
        a = js.eval(source)

        def key(x, a=a, action=action):
            if action == 'append': a.append(9.5)
            elif action == 'clear': a.clear()
            elif action == 'store': a[0] = 'x'
            return 0 if x is None else x
        print(name, '|', action, '|', attempt(lambda: sorted(a, key=key)), '|', attempt(lambda: tuple(a)), '|', attempt(lambda: a.sort(key=key) or tuple(a)))
