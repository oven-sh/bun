# How the arguments of a call get to the parameters: every signature here is called in every way here.
import gc


def show(function, *args, **kwargs):
    try:
        return repr(function(*args, **kwargs))
    except TypeError as e:
        return 'TypeError: %s' % e


SIGNATURES = [
    '',
    'a',
    'a, b',
    'a, b=20',
    'a=10, b=20',
    'a, b, c, d',
    'a, b=20, c=30, d=40',
    'a, /',
    'a, /, b',
    'a, b=20, /, c=30',
    'a, /, b=20, *, c=30',
    '*, a',
    '*, a=10',
    'a, *, b',
    'a, *, b=20, c',
    'a, b=20, *, c=30, d=40',
    '*args',
    'a, *args',
    'a, b=20, *args',
    'a, *args, b',
    'a, *args, b=20, c=30',
    '**kw',
    'a, **kw',
    'a, b=20, **kw',
    'a, /, **kw',
    'a, *, b=20, **kw',
    '*args, **kw',
    'a, *args, **kw',
    'a, b=20, *args, c=30, **kw',
    'a, b, c, d, e, f, g, h, i, j',
    'a=1, b=2, c=3, d=4, e=5, f=6, g=7, h=8, i=9, j=10',
    'a, *, b=2, c=3, d=4, e=5, f=6, g=7, h=8, i=9, j=10, k=11',
]

CALLS = [
    '',
    '1',
    '1, 2',
    '1, 2, 3',
    '1, 2, 3, 4',
    '1, 2, 3, 4, 5',
    'a=1',
    'b=2',
    'a=1, b=2',
    'b=2, a=1',
    '1, a=1',
    '1, b=2',
    '1, c=3',
    '1, b=2, c=3',
    '1, c=3, b=2',
    '1, d=4, c=3, b=2',
    '1, b=2, d=4, c=3',
    '1, 2, b=2',
    '1, 2, c=3',
    '1, 2, d=4, c=3',
    '1, 2, 3, d=4',
    '1, 2, 3, 4, d=4',
    'd=4, c=3, b=2, a=1',
    'a=1, b=2, c=3, d=4',
    'a=1, c=3',
    'z=26',
    '1, z=26',
    '1, 2, z=26, y=25',
    'z=26, a=1',
    'a=1, z=26, b=2',
    'aa=1',
    '1, 2, 3, 4, 5, 6, 7, 8, 9, 10',
    '1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11',
    '1, 2, 3, 4, 5, 6, 7, 8, 9, j=10',
    'j=10, i=9, h=8, g=7, f=6, e=5, d=4, c=3, b=2, a=1',
    'a=1, b=2, c=3, d=4, e=5, f=6, g=7, h=8, i=9, j=10',
    '1, j=10, i=9, h=8, g=7, f=6, e=5, d=4, c=3, b=2',
    '1, k=11, j=10, i=9, h=8, g=7, f=6, e=5, d=4, c=3, b=2',
    '1, b=2, c=3, d=4, e=5, f=6, g=7, h=8, i=9, j=10, k=11',
    '1, 2, j=10, c=3',
    '*(1, 2)',
    '*(1, 2), **{"c": 3}',
    '1, *(2, 3), d=4',
    '**{"b": 2, "a": 1}',
    '1, **{}',
    '*(), **{}',
]


def parameters(signature):
    return [p.split('=')[0].strip('* ') for p in signature.split(',') if p.strip(' */')]


for signature in SIGNATURES:
    names = parameters(signature)
    namespace = {}
    exec('def f(%s): return (%s)' % (signature, ''.join(n + ', ' for n in names)), namespace)
    for call in CALLS:
        namespace['show'] = show
        # The call is compiled as it stands, and made twice from the same place.
        exec('def caller(f):\n    try:\n        return repr(f(%s))\n    except TypeError as e:\n        return "TypeError: %%s" %% e' % call, namespace)
        first = namespace['caller'](namespace['f'])
        second = namespace['caller'](namespace['f'])
        print('f(%s)  <-  (%s):  %s%s' % (signature, call, first, '' if first == second else '  THEN  ' + second))


print('--- the same place calls functions with other parameters in turn')


def p1(a, b=2, c=3): return ('p1', a, b, c)
def p2(a, c=3, b=2): return ('p2', a, b, c)
def p3(a, *, c, b=2): return ('p3', a, b, c)
def p4(a, **kw): return ('p4', a, kw)
def p5(*args, c): return ('p5', args, c)
def p6(c, a=0): return ('p6', a, c)


for function in [p1, p2, p3, p4, p5, p6] * 2:
    try:
        print(function(1, c=30), function(1, c=30, **{}), end=' ')
    except TypeError as e:
        print('TypeError: %s' % e, end=' ')
    print(show(function, 1, b=20, c=30), show(function, c=30, a=1))


print('--- methods, and objects that are called')


class C:
    def m(self, a, b=2, *args, c=3, **kw): return (a, b, args, c, kw)
    def d(self, a=1, b=2): return (a, b)
    def __call__(self, a=1, b=2, *, c=3): return (a, b, c)
    @classmethod
    def cm(cls, a, b=2, *, c=3): return (cls.__name__, a, b, c)
    @staticmethod
    def sm(a, b=2, *, c=3): return (a, b, c)


c = C()
bound = c.m
for _ in range(2):
    print(c.m(1), c.m(1, 20), c.m(1, b=20), c.m(1, c=30), c.m(1, 20, 21, 22, c=30, z=26), c.m(a=1, z=26), c.m(b=20, a=1))
    print(bound(1), bound(1, 20), bound(1, b=20), bound(1, c=30), bound(1, 20, 21, c=30, z=26), bound(b=20, a=1))
    print(c.d(), c.d(10), c.d(b=20), c.d(10, 20), c.d(b=20, a=10))
    print(c(), c(10), c(b=20), c(c=30), c(10, c=30, b=20))
    print(C.cm(1), C.cm(1, c=30), c.cm(a=1, b=20), C.sm(1), C.sm(1, c=30), c.sm(b=20, a=1))
    print(show(c.m), show(c.m, self=1), show(c.m, 1, a=1), show(c.d, 1, 2, 3), show(c, 1, 2, 3), show(C.m), show(C.d, b=1))


print('--- the defaults are those the function has when it is called')


def g(a, b=2, c=3, *, d=4, e=5): return (a, b, c, d, e)


print(g(1), g(1, e=50))
g.__defaults__ = (20, 30)
print(g(1), show(g))
g.__defaults__ = (10, 20, 30)
print(g(), g(1), g(c=300))
g.__defaults__ = (0, 10, 20, 30)
print(g(), g(1), g(1, 2), g(1, 2, 3))
g.__defaults__ = (30,)
print(show(g), show(g, 1), g(1, 2), show(g, b=2), show(g, 1, c=3), g(b=2, a=1))
g.__defaults__ = None
print(show(g), show(g, 1), show(g, 1, 2), g(1, 2, 3), show(g, c=3))
del g.__defaults__
print(show(g, 1, 2), g(1, 2, 3))
g.__kwdefaults__ = {'e': 500}
print(show(g, 1, 2, 3), g(1, 2, 3, d=400), show(g, 1, 2, 3, e=1))
g.__kwdefaults__ = None
print(show(g, 1, 2, 3), show(g, 1, 2, 3, d=4), g(1, 2, 3, e=5, d=4))
g.__kwdefaults__ = {'d': 4, 'e': 5, 'f': 6, 1: 2}
print(g(1, 2, 3))
defaults = g.__kwdefaults__
defaults['d'] = 44
print(g(1, 2, 3))
del defaults['d']
print(show(g, 1, 2, 3))


print('--- the function is given other code')


def h(a, b=2): return ('h', a, b)
def other(x, y, z=3, *rest, w=4): return ('other', x, y, z, rest, w)


def call_h(*args, **kwargs):
    return show(h, *args, **kwargs)


def direct():
    return [show(lambda: h(1)), show(lambda: h(1, 2)), show(lambda: h(1, b=2)), show(lambda: h(1, y=2)), show(lambda: h(1, 2, 3, 4, w=5))]


print(direct())
code = h.__code__
h.__code__ = other.__code__
print(direct())
h.__kwdefaults__ = {'w': 40}
print(direct())
h.__code__ = code
print(direct())


print('--- names that are not plain strs')


class Name(str):
    log = []
    def __eq__(self, o):
        Name.log.append('eq %s %s' % (str(self), str(o)))
        return str(self) == str(o)
    def __hash__(self):
        return hash(str(self))


def n(a, b=2, *, c=3, **kw): return (a, b, c, sorted(kw.items()))


for mapping in [{Name('a'): 1}, {Name('b'): 20, 'a': 1}, {'a': 1, Name('c'): 30}, {'a': 1, Name('z'): 26}, {Name('a'): 1, Name('b'): 2, Name('c'): 3, Name('d'): 4}]:
    Name.log.clear()
    print(show(n, **mapping), len(Name.log) > 0)
print(show(n, 1, **{Name('a'): 1}), show(k := (lambda a, /, b=2: (a, b)), 1, **{Name('a'): 1}), show(k, **{Name('a'): 1}))


class Raises(str):
    def __eq__(self, o): raise ZeroDivisionError
    def __hash__(self): return hash(str(self))


try:
    n(**{Raises('a'): 1})
except ZeroDivisionError:
    print('ZeroDivisionError')
print(show(lambda: n(**{1: 2})), show(lambda: n(1, **{'b': 2, 3: 4})))


print('--- names that are equal and not the same object')
for name in ['a', 'b', 'c', 'zz']:
    made = ''.join([name, ''][:1]) + ''
    made = (made + '!')[:-1]
    print(show(n, **{made: 7}), show(n, 1, **{made: 7}))


print('--- generators, coroutines, lambdas, nested functions')


def gen(a, b=2, *args, c=3, **kw):
    yield (a, b, args, c, kw)


async def co(a, b=2, *, c=3):
    return (a, b, c)


def run(coroutine):
    try:
        coroutine.send(None)
    except StopIteration as e:
        return e.value


print(list(gen(1)), list(gen(1, c=30)), list(gen(1, 20, 21, z=26)), list(gen(b=20, a=1)), show(gen), show(gen, 1, a=1))
print(run(co(1)), run(co(1, c=30)), run(co(b=20, a=1)), show(co), show(co, 1, 2, 3))
print((lambda a, b=2, *c, d=4, **e: (a, b, c, d, e))(1, d=40), (lambda *a, **k: (a, k))(), (lambda a=1: a)())


def outer(x):
    def inner(a, b=x, *, c=x): return (a, b, c, x)
    return inner


print(outer(5)(1), outer(5)(1, c=6), outer(5)(b=7, a=1), show(outer(5)))


print('--- what is passed is let go of when the parameter is given something else')


class Noisy:
    def __init__(self, name): self.name = name
    def __del__(self): print('  del', self.name)


def drops(a, b=None, *args, c=None, **kw):
    a = None
    gc.collect()
    print(' a gone')
    b = None
    gc.collect()
    print(' b gone')
    args = None
    gc.collect()
    print(' args gone')
    c = None
    gc.collect()
    print(' c gone')
    kw = None
    gc.collect()
    print(' kw gone')


drops(Noisy('a'), Noisy('b'), Noisy('args'), c=Noisy('c'), z=Noisy('kw'))
drops(c=Noisy('c'), b=Noisy('b'), z=Noisy('kw'), a=Noisy('a'))
drops(Noisy('a'), z=Noisy('kw'), c=Noisy('c'), b=Noisy('b'))


print('--- many at a time')
for count in (7, 8, 9, 10, 17, 40):
    names = ['p%d' % i for i in range(count)]
    namespace = {}
    exec('def many(%s): return (%s,)' % (', '.join(names), ', '.join(names)), namespace)
    exec('def manyd(%s): return (%s,)' % (', '.join(n + '=-1' for n in names), ', '.join(names)), namespace)
    exec('def manyk(*, %s): return (%s,)' % (', '.join(n + '=-1' for n in names), ', '.join(names)), namespace)
    exec('def backwards(f): return f(%s)' % ', '.join('%s=%d' % (n, i) for i, n in reversed(list(enumerate(names)))), namespace)
    exec('def forwards(f): return f(%s)' % ', '.join('%s=%d' % (n, i) for i, n in enumerate(names)), namespace)
    exec('def half(f): return f(%s, %s)' % (', '.join(str(i) for i in range(count // 2)), ', '.join('%s=%d' % (n, i) for i, n in reversed(list(enumerate(names))[count // 2:]))), namespace)
    exec('def odd(f): return f(%s)' % ', '.join('%s=%d' % (n, i) for i, n in list(enumerate(names))[1::2]), namespace)
    expected = tuple(range(count))
    for f in ('many', 'manyd', 'manyk'):
        for caller in ('backwards', 'forwards', 'half', 'odd'):
            result = show(namespace[caller], namespace[f])
            print(count, f, caller, 'as expected' if result == repr(expected) else result[:150])
