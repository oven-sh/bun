# itemgetter, attrgetter, methodcaller
import _operator as op
from _operator import itemgetter, attrgetter, methodcaller


def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)


print('--- itemgetter')
t(lambda: itemgetter(1)('abc'))
t(lambda: itemgetter(1)([1, 2, 3]))
t(lambda: itemgetter(1)((1, 2, 3)))
t(lambda: itemgetter(-1)((1, 2, 3)))
t(lambda: itemgetter(0)(range(5, 8)))
t(lambda: itemgetter('k')({'k': 'v'}))
t(lambda: itemgetter(slice(1, 3))('abcdef'))
t(lambda: itemgetter(slice(None, None, -1))([1, 2, 3]))
t(lambda: itemgetter(1, 0)('abc'))
t(lambda: itemgetter(2, 2, 2)('abc'))
t(lambda: itemgetter('a', 'b')({'a': 1, 'b': 2}))
t(lambda: itemgetter(0, slice(1, None))('abc'))
t(lambda: itemgetter(*range(10))(list(range(100, 120))))
t(lambda: itemgetter((1, 2))({(1, 2): 'tuple key'}))
t(lambda: itemgetter(None)({None: 1}))
t(lambda: itemgetter(True)('ab'))
t(lambda: itemgetter(int)(list))
t(lambda: type(itemgetter(1, 0)('abc')).__name__)
t(lambda: sorted([('b', 2), ('a', 3), ('c', 1)], key=itemgetter(1)))
t(lambda: sorted([('b', 2), ('a', 3), ('a', 1)], key=itemgetter(0, 1)))
t(lambda: list(map(itemgetter(0), ['ab', 'cd'])))
t(lambda: max({'a': 1, 'b': 5}.items(), key=itemgetter(1)))
t(lambda: itemgetter(5)('abc'))
t(lambda: itemgetter(5)((1, 2)))
t(lambda: itemgetter(-5)((1, 2)))
t(lambda: itemgetter('x')({}))
t(lambda: itemgetter(0, 5)('abc'))
t(lambda: itemgetter('a')('abc'))
t(lambda: itemgetter(0)(5))
t(lambda: itemgetter(0)(None))
t(lambda: itemgetter(0, 1)(5))
t(lambda: itemgetter(2 ** 70)((1,)))
t(lambda: itemgetter(2 ** 70)({2 ** 70: 'big'}))
t(lambda: itemgetter([])({}))


class T(tuple):
    def __getitem__(self, i):
        return 'overridden', i


class G:
    def __getitem__(self, key):
        return 'got', key


t(lambda: itemgetter(0)(T((1, 2))))
t(lambda: itemgetter(0)(G()))
t(lambda: itemgetter(0, 'a', None)(G()))

print('--- attrgetter')


class O:
    def __init__(self, **kw):
        self.__dict__.update(kw)

    def __repr__(self):
        return 'O(%s)' % ', '.join('%s=%r' % p for p in sorted(self.__dict__.items()))


o = O(a=1, b=O(c=2, d=O(e=3)), name='n')
t(lambda: attrgetter('a')(o))
t(lambda: attrgetter('b')(o))
t(lambda: attrgetter('b.c')(o))
t(lambda: attrgetter('b.d.e')(o))
t(lambda: attrgetter('a', 'name')(o))
t(lambda: attrgetter('a', 'b.c', 'b.d.e')(o))
t(lambda: attrgetter('a', 'a')(o))
t(lambda: type(attrgetter('a', 'a')(o)).__name__)
t(lambda: attrgetter('real')(5))
t(lambda: attrgetter('real', 'imag')(3 + 4j))
t(lambda: attrgetter('__class__.__name__')(5))
t(lambda: attrgetter('__class__.__mro__')(True))
t(lambda: attrgetter('upper')('a')())
t(lambda: sorted([O(n=2), O(n=1)], key=attrgetter('n')))
t(lambda: attrgetter('x')(o))
t(lambda: attrgetter('b.x')(o))
t(lambda: attrgetter('a.x')(o))
t(lambda: attrgetter('a', 'x')(o))
t(lambda: attrgetter('')(o))
t(lambda: attrgetter('.')(o))
t(lambda: attrgetter('a.')(o))
t(lambda: attrgetter('.a')(o))
t(lambda: attrgetter('b..c')(o))
t(lambda: attrgetter('a b')(o))
t(lambda: attrgetter('\xe9')(O(**{'\xe9': 'accent'})))
t(lambda: attrgetter('b.\xe9')(O(b=O(**{'\xe9': 'accent'}))))


class Dyn:
    def __getattr__(self, name):
        if name == 'stop':
            raise AttributeError('no stop here')
        if name == 'boom':
            raise ZeroDivisionError('boom')
        return 'dyn:' + name


t(lambda: attrgetter('anything')(Dyn()))
t(lambda: attrgetter('x.upper')(Dyn())())
t(lambda: attrgetter('stop')(Dyn()))
t(lambda: attrgetter('boom')(Dyn()))
t(lambda: attrgetter('ok', 'boom')(Dyn()))


class MyStr(str):
    pass


t(lambda: attrgetter(MyStr('a'))(o))
t(lambda: attrgetter(MyStr('b.c'))(o))

print('--- methodcaller')
t(lambda: methodcaller('upper')('abc'))
t(lambda: methodcaller('split')('a b c'))
t(lambda: methodcaller('split', ' ', 1)('a b c'))
t(lambda: methodcaller('split', sep=' ', maxsplit=1)('a b c'))
t(lambda: methodcaller('split', ' ', maxsplit=1)('a b c'))
t(lambda: methodcaller('get', 'x', 'default')({}))
t(lambda: methodcaller('format', 1, 2, c=3)('{} {} {c}'))
t(lambda: methodcaller('__len__')([1, 2]))
t(lambda: methodcaller('bit_length')(255))
t(lambda: list(map(methodcaller('strip', 'x'), ['xax', 'bx'])))


class M:
    def method(self, *a, **k):
        return 'method', a, k

    @staticmethod
    def static(*a, **k):
        return 'static', a, k

    @classmethod
    def cls(cls, *a, **k):
        return 'cls', cls.__name__, a, k

    attribute = 5

    def __getattr__(self, name):
        if name.startswith('dyn'):
            return lambda *a, **k: (name, a, k)
        raise AttributeError(name)


m = M()
m.instance = lambda *a, **k: ('instance', a, k)
for name in ('method', 'static', 'cls', 'instance', 'dynamic'):
    t(lambda: methodcaller(name)(m))
    t(lambda: methodcaller(name, 1, 2)(m))
    t(lambda: methodcaller(name, x=1)(m))
    t(lambda: methodcaller(name, 1, 2, x=3, y=4)(m))
t(lambda: methodcaller('method', *range(20), **{'k%d' % i: i for i in range(5)})(m))
t(lambda: methodcaller('method', name='n', self='s')(m))
t(lambda: methodcaller('attribute')(m))
t(lambda: methodcaller('missing')(m))
t(lambda: methodcaller('upper')(5))
t(lambda: methodcaller('upper', 1)('a'))
t(lambda: methodcaller('upper', x=1)('a'))
t(lambda: methodcaller('a.b')(m))
t(lambda: methodcaller('')(m))
t(lambda: methodcaller(MyStr('upper'))('a'))
t(lambda: methodcaller('method')(M))
t(lambda: methodcaller('cls', 1)(M))
# The arguments are the same objects each time.
l = []
mc = methodcaller('method', l)
t(lambda: mc(m)[1][0] is l)

print('--- how they are made and called')
for cls in (itemgetter, attrgetter, methodcaller):
    print('-', cls.__name__)
    t(lambda: cls())
    t(lambda: cls(x=1))
    t(lambda: cls('a', x=1))
    t(lambda: cls(1))
    t(lambda: cls(None))
    t(lambda: cls('a', 1))
    t(lambda: cls(b'a'))
    g = cls('a')
    t(lambda: g())
    t(lambda: g(1, 2))
    t(lambda: g(x=1))
    t(lambda: g(1, x=1))
    t(lambda: g(1, 2, x=1))
    t(lambda: g(obj=1))
    t(lambda: callable(g))
    t(lambda: cls.__call__(g, {'a': 1}) if cls is itemgetter else None)

print('--- repr')
for g in (itemgetter(1), itemgetter('a'), itemgetter(1, 2), itemgetter('a', 'b', 'c'), itemgetter((1, 2)), itemgetter((1,), 2), itemgetter(slice(1, 2)),
          itemgetter(None), itemgetter([1], {2: 3}), itemgetter(-1), itemgetter(2 ** 70), itemgetter(1.5),
          attrgetter('a'), attrgetter('a', 'b'), attrgetter('a.b'), attrgetter('a.b.c', 'd'), attrgetter(''), attrgetter('.'), attrgetter('a..b'),
          attrgetter("it's"), attrgetter('\xe9'),
          methodcaller('a'), methodcaller('a', 1), methodcaller('a', 1, 'b'), methodcaller('a', x=1), methodcaller('a', 1, x=2, y='z'),
          methodcaller('a', (1, 2)), methodcaller('a', None), methodcaller('a.b'), methodcaller("it's")):
    print(repr(g), str(g) == repr(g))
l = []
g = itemgetter(l)
l.append(g)
t(lambda: g)
l = []
g = itemgetter(l, 1)
l.append(g)
t(lambda: g)
l = []
g = methodcaller('m', l)
l.append(g)
t(lambda: g)
l = []
g = methodcaller('m', k=l)
l.append(g)
t(lambda: g)


class BadRepr:
    def __repr__(self):
        raise RuntimeError('bad repr')


t(lambda: repr(itemgetter(BadRepr())))
t(lambda: repr(itemgetter(1, BadRepr())))
t(lambda: repr(methodcaller('a', BadRepr())))
t(lambda: repr(methodcaller('a', k=BadRepr())))

print('--- pickling support')
for g in (itemgetter(1), itemgetter(1, 2), itemgetter((1, 2)), itemgetter('a', None), attrgetter('a'), attrgetter('a', 'b'), attrgetter('a.b'),
          attrgetter('a.b', 'c.d.e'), methodcaller('a'), methodcaller('a', 1), methodcaller('a', 1, (2,))):
    r = g.__reduce__()
    print(r, repr(r[0](*r[1])) == repr(g))
t(lambda: itemgetter(1).__reduce__(1))
r = methodcaller('m', 1, 2, x=3, y=4).__reduce__()
t(lambda: (type(r[0]).__name__, r[0].func is methodcaller, r[0].args, r[0].keywords, r[1]))
t(lambda: r[0](*r[1]))
r = methodcaller('m', x=3).__reduce__()
t(lambda: (r[0].args, r[0].keywords, r[1], r[0](*r[1])))

print('--- the types')
for cls in (itemgetter, attrgetter, methodcaller):
    print(cls.__name__, cls.__qualname__, cls.__module__, repr(cls), type(cls).__name__, cls.__mro__ == (cls, object))
    print(sorted(n for n in vars(cls) if n not in ('__doc__', '__module__', '__getattribute__', '__vectorcalloffset__')))
    print(cls.__doc__.splitlines()[0])
    g = cls('a')
    print(g.__text_signature__, hasattr(g, '__dict__'), g == g, g == cls('a'), g != cls('a'), hash(g) == hash(g), bool(g))
    try:
        type('X', (cls,), {})
        print('can be derived from')
    except TypeError:
        print('is final')
    try:
        g.attribute = 1
        print('attribute set')
    except AttributeError:
        print('no attributes')
