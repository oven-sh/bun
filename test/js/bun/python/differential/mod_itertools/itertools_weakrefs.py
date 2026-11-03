# Which instances can be referred to weakly.
import _weakref
import itertools
import _functools
import _operator

a, b = itertools.tee('abc')
r = _weakref.ref(a)
print(r() is a, next(r()))
p = _functools.partial(int)
print(_weakref.ref(p)() is p)
w = _functools._lru_cache_wrapper(int, None, False, tuple)
print(_weakref.ref(w)() is w)


class Chain(itertools.chain):
    pass


c = Chain('ab')
print(_weakref.ref(c)() is c)
for make in (lambda: itertools.chain(), lambda: itertools.count(), lambda: itertools.repeat(1), lambda: itertools.groupby(''), lambda: itertools.product(),
             lambda: _operator.itemgetter(1), lambda: _operator.attrgetter('a'), lambda: _operator.methodcaller('a'),
             lambda: _functools.cmp_to_key(int), lambda: _functools.Placeholder):
    o = make()
    try:
        _weakref.ref(o)
        print(type(o).__name__, 'yes')
    except TypeError as e:
        print(type(o).__name__, 'no')
