# Lib/functools.py on top of _functools
import functools
import _functools
from functools import (partial, reduce, cmp_to_key, lru_cache, cache, wraps, update_wrapper, total_ordering, partialmethod,
                       cached_property, Placeholder, WRAPPER_ASSIGNMENTS, WRAPPER_UPDATES)


def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)


print('--- what comes from _functools')
for name in ('partial', 'reduce', 'cmp_to_key', '_lru_cache_wrapper', 'Placeholder', '_PlaceholderType'):
    print(name, getattr(functools, name) is getattr(_functools, name))

print('--- lru_cache')


@lru_cache
def plain(x):
    "the doc"
    return x * 2


t(lambda: [plain(i) for i in (1, 2, 1)])
t(lambda: plain.cache_info())
t(lambda: plain.cache_parameters())
t(lambda: (plain.__name__, plain.__qualname__, plain.__doc__, plain.__module__))
t(lambda: plain.__wrapped__(5))
t(lambda: type(plain).__name__)
t(lambda: type(plain.cache_info()).__name__)
t(lambda: plain.cache_info().hits)
t(lambda: tuple(plain.cache_info()))
plain.cache_clear()
t(lambda: plain.cache_info())


@lru_cache(maxsize=2)
def two(x):
    return x


t(lambda: [two(i) for i in (1, 2, 3, 1, 3)])
t(lambda: two.cache_info())
t(lambda: two.cache_parameters())


@lru_cache(maxsize=None, typed=True)
def typed(x):
    return type(x).__name__


t(lambda: [typed(i) for i in (1, 1.0, True, 1)])
t(lambda: typed.cache_info())
t(lambda: typed.cache_parameters())


@lru_cache(0)
def none(x):
    return x


t(lambda: (none(1), none(1), none.cache_info()))
t(lambda: lru_cache(-1)(lambda: 0).cache_info())
t(lambda: lru_cache('a'))
t(lambda: lru_cache(1.5))
t(lambda: lru_cache(maxsize=10, typed=False)(1))


@cache
def fact(n):
    return n * fact(n - 1) if n else 1


t(lambda: fact(20))
t(lambda: fact.cache_info())
t(lambda: fact(25))
t(lambda: fact.cache_info())
t(lambda: fact.cache_parameters())


@lru_cache(maxsize=32)
def kw(a, b=2, *c, **d):
    return a, b, c, d


t(lambda: (kw(1), kw(1, 2), kw(1, b=2), kw(a=1), kw(1, 2, 3, z=4)))
t(lambda: kw.cache_info())
t(lambda: kw())
t(lambda: kw([]))


class WithCachedMethod:
    def __init__(self, n):
        self.n = n

    @lru_cache(maxsize=None)
    def method(self, x):
        return self.n + x

    @staticmethod
    @cache
    def static(x):
        return x * 3

    @classmethod
    @cache
    def cls(cls, x):
        return cls.__name__, x


w = WithCachedMethod(10)
t(lambda: (w.method(1), w.method(1), WithCachedMethod(20).method(1)))
t(lambda: WithCachedMethod.method.cache_info())
t(lambda: (w.static(2), WithCachedMethod.static(2), WithCachedMethod.static.cache_info()))
t(lambda: (w.cls(2), WithCachedMethod.cls(2)))

import copy
t(lambda: copy.copy(plain) is plain)
t(lambda: copy.deepcopy(plain) is plain)
t(lambda: plain.__reduce__())

print('--- wraps')


def original(a, b: int = 1) -> str:
    "original doc"


original.attr = 'attr'


@wraps(original)
def wrapper(*a, **k):
    return original(*a, **k)


t(lambda: (wrapper.__name__, wrapper.__qualname__, wrapper.__doc__, wrapper.__module__, wrapper.attr))
t(lambda: wrapper.__wrapped__ is original)
t(lambda: wrapper.__annotations__)
t(lambda: WRAPPER_ASSIGNMENTS)
t(lambda: WRAPPER_UPDATES)
p = partial(original, 1)
t(lambda: update_wrapper(p, original) is p)
t(lambda: (p.__name__, p.__doc__, p.attr, p.__wrapped__ is original))
t(lambda: sorted(p.__dict__))
t(lambda: wraps(partial(original))(lambda: 0).__wrapped__.func is original)
t(lambda: wraps(original, assigned=('__name__',), updated=())(lambda: 0).__name__)
t(lambda: wraps(1)(lambda: 0).__wrapped__)

print('--- total_ordering')


@total_ordering
class Version:
    def __init__(self, n):
        self.n = n

    def __eq__(self, other):
        return self.n == other.n

    def __lt__(self, other):
        return self.n < other.n


a, b = Version(1), Version(2)
t(lambda: (a < b, a <= b, a > b, a >= b, a == b, a != b, a <= a, a >= a))
t(lambda: sorted([Version(3), Version(1), Version(2)])[0].n)


def no_order():
    @total_ordering
    class X:
        pass


t(no_order)

print('--- partialmethod')


class Cell:
    def __init__(self):
        self.alive = False

    def set_state(self, state, *more, **kw):
        self.alive = state
        return state, more, kw

    set_alive = partialmethod(set_state, True)
    set_dead = partialmethod(set_state, False, 'x', k=1)
    nested = partialmethod(set_alive, 'n')
    with_placeholder = partialmethod(set_state, Placeholder, 'second')
    from_partial = partialmethod(partial(lambda *a: a, 'p'))


c = Cell()
t(lambda: (c.set_alive(), c.alive))
t(lambda: (c.set_dead(2, z=3), c.alive))
t(lambda: c.nested())
t(lambda: c.with_placeholder('first'))
t(lambda: c.with_placeholder())
t(lambda: c.from_partial(1)[0])
t(lambda: Cell.set_alive(c))
t(lambda: type(c.set_alive).__name__)
t(lambda: partialmethod())
t(lambda: partialmethod(1))
t(lambda: partialmethod(print, Placeholder))
t(lambda: repr(partialmethod(int, 1, base=2)))

print('--- cached_property')


class Data:
    computed = 0

    @cached_property
    def value(self):
        "value doc"
        Data.computed += 1
        return [1, 2, 3]


d = Data()
t(lambda: (d.value, d.value is d.value, Data.computed, d.__dict__))
del d.value
t(lambda: (d.value, Data.computed))
t(lambda: type(Data.value).__name__)
t(lambda: Data.value.__doc__)
t(lambda: Data.value.attrname)

print('--- partial through functools')
t(lambda: partial(int, base=2))
t(lambda: partial(partial(max, 1), 2)(3))
t(lambda: functools.partial.__module__)
t(lambda: reduce(lambda a, b: a + b, range(5), 10))
t(lambda: sorted('bca', key=cmp_to_key(lambda a, b: (a > b) - (a < b))))
t(lambda: copy.copy(partial(int, '1', base=2))())
q = copy.deepcopy(partial(dict, [(1, [2])], a=[3]))
t(lambda: q())
t(lambda: copy.copy(Placeholder) is Placeholder)
t(lambda: copy.deepcopy(Placeholder) is Placeholder)
