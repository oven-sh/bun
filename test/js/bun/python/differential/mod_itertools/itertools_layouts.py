# An instance of one type is never taken for an instance of another.
from itertools import *
import _functools, _operator
def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)
def multi():
    class X(chain, count): pass
t(multi)
def multi2():
    class X(chain, _functools.partial): pass
t(multi2)
def multi3():
    class X(chain, list): pass
t(multi3)
def multi4():
    class X(chain, Exception): pass
t(multi4)
class A(chain): pass
class B(groupby): pass
class C(chain): pass
def assign(o, c):
    o.__class__ = c
    return type(o).__name__
t(lambda: assign(chain(), count))
t(lambda: assign(A(), B))
t(lambda: assign(A(), C))
t(lambda: assign(A(), chain))
t(lambda: assign(A(), object))
class P: pass
t(lambda: assign(A(), P))
t(lambda: assign(P(), A))
t(lambda: chain.__next__(B('a')))
t(lambda: groupby.__next__(A('a')))
t(lambda: count.__new__(A))
t(lambda: chain.__new__(B))
t(lambda: _functools.partial.__call__(A()))
t(lambda: _functools.partial.__repr__(chain()))
t(lambda: _functools.partial.func.__get__(chain()))
t(lambda: _functools.partial.func.__get__(_functools.partial(int)))
t(lambda: type(_functools.cmp_to_key(int)).obj.__get__(chain()))
t(lambda: _operator.itemgetter.__call__(_operator.attrgetter('a'), 1))
t(lambda: _operator.itemgetter.__repr__(_operator.methodcaller('a')))
t(lambda: _functools._lru_cache_wrapper.cache_info(_functools.partial(int)))
t(lambda: repeat.__length_hint__(count()))
t(lambda: product.__sizeof__(permutations('a')))
t(lambda: combinations.__sizeof__(combinations_with_replacement('a', 1)))
t(lambda: combinations.__next__(combinations_with_replacement('a', 1)))
