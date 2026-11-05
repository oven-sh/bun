# One place in the program calls whatever it is given: functions made by one def, other functions, functions and types written in C, methods,
# objects with a __call__, what cannot be called. What a call does must not depend on what the place has called before.
import functools
import gc
import re
import sys
import traceback
import warnings

warnings.simplefilter('ignore')  # A coroutine that nobody awaits is noticed when it goes.


def plain(a, b): return ('plain', a, b)
def defaults(a, b=2, c=3): return ('defaults', a, b, c)
def star(*args): return ('star', args)
def keywords(**kw): return ('keywords', sorted(kw.items()))
def both(a, *args, k=0, **kw): return ('both', a, args, k, sorted(kw.items()))
def only(a, /, b, *, c=1): return ('only', a, b, c)
def none(): return ('none',)
def generator(a, b=0):
    yield a
    yield b
async def coroutine(a, b=0): return a
def raises(a, b=0): raise ValueError((a, b))
def recursive(a, b=0): return a if a <= 0 else recursive(a - 1, b) + 1


def closure(n):
    def inner(a, b=0): return ('inner', n, a, b)
    return inner


class Plain:
    def __init__(self, a, b=0): self.ab = (a, b)
    def __repr__(self): return 'Plain%r' % (self.ab,)
    def method(self, a, b=0): return ('method', a, b)
    @classmethod
    def of_class(cls, a, b=0): return ('of_class', cls.__name__, a, b)
    @staticmethod
    def static(a, b=0): return ('static', a, b)


class WithNew:
    def __new__(cls, a, b=0): return ('new', a, b)


class Callable:
    def __call__(self, a, b=0): return ('called', a, b)


class CallableList(list):
    def __call__(self, a, b=0): return ('list called', len(self), a, b)


class Meta(type):
    def __call__(cls, a, b=0): return ('meta', cls.__name__, a, b)


class OfMeta(metaclass=Meta):
    pass


class Slotted:
    __slots__ = ('ab',)
    def __init__(self, a, b=0): self.ab = (a, b)
    def __repr__(self): return 'Slotted%r' % (self.ab,)


def show(value):
    if type(value).__name__ in ('generator',):
        return ('generator', list(value))
    if type(value).__name__ == 'coroutine':
        value.close()
        return 'coroutine'
    if isinstance(value, (map, zip, filter, enumerate, range)):
        return (type(value).__name__, list(value))
    if isinstance(value, (set, frozenset)):
        return (type(value).__name__, sorted(value, key=repr))
    return value


callees = [
    plain, defaults, star, keywords, both, only, none, generator, coroutine, raises, recursive, closure(1), closure(2), closure(3),
    lambda a, b: ('lambda', a, b), lambda *a: ('lambda star', a),
    Plain, WithNew, Callable(), CallableList([1, 2]), OfMeta, Slotted, Plain(0).method, Plain.method, Plain.of_class, Plain(0).of_class, Plain.static,
    Plain.__dict__['static'], Plain.__dict__['of_class'], functools.partial(plain, 7), functools.partial(defaults, c=9), functools.partial(closure(4)),
    len, abs, max, min, divmod, pow, isinstance, getattr, hasattr, repr, print.__call__, sorted, sum, round, id.__class__, callable,
    int, float, str, list, tuple, dict, set, frozenset, bytes, complex, range, slice, type, object, ValueError, KeyError, zip, map, enumerate,
    'abc'.upper, 'abc'.startswith, 'a,b'.split, str.upper, str.startswith, [3, 1].index, list.append, {}.get, dict.fromkeys, (1, 2).count, int.bit_length, (5).__add__, int.__add__,
    functools.reduce, functools.lru_cache(plain), functools.wraps(plain)(lambda *a, **k: plain(*a, **k)),
    None, 1, 'text', 2.5, (), [], {}, NotImplemented, Ellipsis, sys, object(),
]


def name_of(callee):
    return getattr(callee, '__qualname__', None) or type(callee).__name__


def at0(f): return f()
def at1(f): return f(3)
def at2(f): return f(3, 4)
def at3(f): return f(3, 4, 5)
def at_text(f): return f('abc')
def at_text2(f): return f('abc', 'a')
def at_list(f): return f([3, 1, 2])
def at_keyword(f): return f(3, b=4)
def at_keywords(f): return f(a=3, b=4)
def at_other_keyword(f): return f(3, zz=4)
def at_star(f): return f(*(3, 4))
def at_star_list(f): return f(*[3])
def at_star_star(f): return f(**{'a': 3, 'b': 4})
def at_all(f): return f(3, *(4,), **{'k': 5})
def at_float(f): return f(2.0, 1.5)
def ignoring(f):
    f(3, 4)
    return 'ignored'


sites = [at0, at1, at2, at3, at_text, at_text2, at_list, at_keyword, at_keywords, at_other_keyword, at_star, at_star_list, at_star_star, at_all, at_float, ignoring]


def outcome(site, callee):
    try:
        return re.sub('0x[0-9a-f]+', 'ADDRESS', repr(show(site(callee))))
    except Exception as error:
        return '%s: %s' % (type(error).__name__, error)


print('--- each place for itself, each callee three times running, then all in turn, twice')
first = {}
for site in sites:
    for callee in callees:
        results = [outcome(site, callee) for _ in range(3)]
        if results[0] != results[1] or results[1] != results[2]:
            print('differs', site.__name__, name_of(callee), results)
        first[site, id(callee)] = results[0]
for turn in range(2):
    for callee in reversed(callees):
        for site in sites:
            result = outcome(site, callee)
            if result != first[site, id(callee)]:
                print('differs later', site.__name__, name_of(callee), result, first[site, id(callee)])
for site in sites:
    print(site.__name__)
    for callee in callees:
        print('   ', name_of(callee), first[site, id(callee)])

print('--- functions that are made, called once and dropped')


def fresh(n):
    total = 0
    for i in range(n):
        def f(a, b=i): return a + b
        total += f(1)
        total += (lambda x: x * 2)(i)
        total += sum(j for j in range(3))
        if not i % 1000:
            gc.collect()
    return total


print(fresh(5000))

print('--- a function that has never run, at a place that has seen many')
for i in range(5):
    namespace = {}
    exec('def new%d(a, b=%d): return ("new", a, b)' % (i, i), namespace)
    print(at1(namespace['new%d' % i]), at2(namespace['new%d' % i]), outcome(at3, namespace['new%d' % i]))

print('--- what is raised, and where')


def deep(f):
    try:
        return at2(f)
    except Exception as error:
        return [(entry.name, entry.lineno - deep.__code__.co_firstlineno > -400) for entry in traceback.extract_tb(error.__traceback__)]


for callee in (raises, none, len, None, Plain(0).method, Callable(), int.bit_length):
    print(name_of(callee), deep(callee))

print('--- how deep')
limit = sys.getrecursionlimit()
sys.setrecursionlimit(200)


def down(f, n): return f(f, n + 1)
def down_too(f, n): return down(down_too if n % 2 else down, n + 1)


for start in (down, down_too):
    try:
        start(start, 0)
    except RecursionError as error:
        print(type(error).__name__, error)
sys.setrecursionlimit(limit)

print('--- methods of many classes at one place')
classes = [type('K%d' % i, (), {'m': (lambda i: lambda self, a=0: (i, a))(i)}) for i in range(20)]
classes += [type('N%d' % i, (base,), {}) for i, base in enumerate((list, dict, str, int, tuple))]
objects = [cls() for cls in classes]


def call_m(o):
    return o.m(1)


def call_len(o):
    return o.__len__()


for turn in range(3):
    print([outcome(call_m, o)[:40] for o in objects][turn * 8:turn * 8 + 9], [outcome(call_len, o)[:30] for o in objects][18:])

print('--- who is told of the calls')
events = []


def profiler(frame, event, argument):
    if event in ('call', 'c_call'):
        events.append((event, frame.f_code.co_name if event == 'call' else argument.__name__))


sys.setprofile(profiler)
for callee in (plain, closure(5), len, Plain, Plain(0).method, Callable(), max):
    outcome(at2, callee)
sys.setprofile(None)
print([event for event in events if event[1] not in ('outcome', 'show', 'repr', 'setprofile', 'isinstance', '__repr__')])

print('--- how deep, by way of methods and objects')


class Deep:
    def __init__(self):
        self.reached = 0
        self.again = self.method

    def method(self, n):
        self.reached = n
        again = self.again
        return again(n + 1)

    def __call__(self, n):
        self.reached = n
        return self(n + 1)


sys.setrecursionlimit(150)
for start in ('method', '__call__'):
    deep_one = Deep()
    try:
        (deep_one.again if start == 'method' else deep_one)(0)
    except RecursionError as error:
        print(start, deep_one.reached, error)
sys.setrecursionlimit(limit)

import weakref


class Thing:
    pass

print('--- what was dropped before a call is gone within it, whatever is called')
dropped = None


def is_gone(*args, **kw):
    gc.collect()
    return dropped() is None


def holds(x, n):
    a = b = c = d = e = f = g = h = i = j = k = l = m = o = p = q = r = s = t = u = v = w = y = z = x
    return holds(x, n - 1) if n else None


class ByStatic:
    __call__ = staticmethod(is_gone)


class ByClassMethod:
    __call__ = classmethod(is_gone)


class ByFunction:
    def __call__(self): return is_gone()


class ByDict(dict):
    def __call__(self): return is_gone()


class ByList(list):
    def __call__(self): return is_gone()


class Getter:
    def __get__(self, instance, owner): return is_gone


class ByDescriptor:
    __call__ = Getter()


def after_dropping(f, depth):
    global dropped
    x = Thing()
    dropped = weakref.ref(x)
    holds(x, depth)
    del x
    return f()


for f in (is_gone, ByStatic(), ByClassMethod(), ByFunction(), ByFunction().__call__, ByDict(), ByList(), ByDescriptor()):
    print(type(f).__name__, [after_dropping(f, depth) for depth in (0, 1, 2, 3, 5, 8) for _ in range(3)].count(True))
