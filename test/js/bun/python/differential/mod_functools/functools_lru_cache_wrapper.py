# _functools._lru_cache_wrapper
import _functools
from _functools import _lru_cache_wrapper as wrapper


def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)


def info(*a):
    return a


def make(function, maxsize, typed=False):
    return wrapper(function, maxsize, typed, info)


calls = []


def square(x):
    calls.append(x)
    return x * x


def anything(*a, **k):
    calls.append((a, k))
    return a, k


print('--- no bound')
f = make(square, None)
t(lambda: [f(i) for i in (1, 2, 1, 3, 2, 1)])
t(lambda: calls)
t(lambda: f.cache_info())
t(lambda: f.cache_clear())
t(lambda: f.cache_info())
t(lambda: (f(1), f.cache_info()))
t(lambda: [f(i) for i in range(1000)][-1])
t(lambda: f.cache_info())

print('--- nothing cached')
calls.clear()
f = make(square, 0)
t(lambda: [f(i) for i in (1, 2, 1, 1)])
t(lambda: calls)
t(lambda: f.cache_info())
f.cache_clear()
t(lambda: f.cache_info())
t(lambda: make(square, -5).cache_info())
t(lambda: make(square, -2 ** 62).cache_info())
t(lambda: f([]))

print('--- bounded')
calls.clear()
f = make(square, 2)
t(lambda: [f(i) for i in (1, 2, 1, 3, 2, 1, 1, 3)])
t(lambda: calls)
t(lambda: f.cache_info())
f.cache_clear()
t(lambda: f.cache_info())
calls.clear()
f = make(square, 1)
t(lambda: [f(i) for i in (1, 1, 2, 2, 1)])
t(lambda: (calls, f.cache_info()))
calls.clear()
f = make(square, 3)
for i in (1, 2, 3):
    f(i)
f(1)          # 2 is now the one used longest ago
f(4)          # and goes
calls.clear()
t(lambda: ([f(i) for i in (1, 3, 4)], calls))
t(lambda: (f(2), calls))
t(lambda: f.cache_info())
calls.clear()
f = make(square, 100)
t(lambda: sum(f(i % 150) for i in range(1000)))
t(lambda: (len(calls), f.cache_info()))
t(lambda: make(square, True).cache_info())
t(lambda: make(square, 2 ** 62).cache_info())


class Index:
    def __index__(self):
        return 2


t(lambda: make(square, Index()).cache_info())

print('--- keys')
for maxsize in (None, 10):
    calls.clear()
    f = make(anything, maxsize)
    f(1)
    f(1.0)
    f(True)
    f('a')
    f(('a',))
    f(1, 2)
    f((1, 2))
    f(a=1)
    f(a=1.0)
    f(a=1, b=2)
    f(b=2, a=1)
    f(1, a=1)
    f()
    f(None)
    f(*())
    f(**{})
    print(maxsize, f.cache_info())
    print(calls)

print('--- typed')
for maxsize in (None, 10):
    calls.clear()
    f = make(anything, maxsize, True)
    f(1)
    f(1.0)
    f(True)
    f(1)
    f(a=1)
    f(a=1.0)
    f(a=1)
    f((1,))
    f((1.0,))
    f('a')
    f('a')
    print(maxsize, f.cache_info())
    print(calls)
t(lambda: make(anything, None, 'yes')(1.0) is not None)
t(lambda: make(anything, None, [])(1.0) is not None)


class MyInt(int):
    pass


class MyStr(str):
    pass


calls.clear()
f = make(anything, None)
f(1); f(MyInt(1)); f('a'); f(MyStr('a'))
t(lambda: (f.cache_info(), len(calls)))
calls.clear()
f = make(anything, None, True)
f(1); f(MyInt(1)); f('a'); f(MyStr('a'))
t(lambda: (f.cache_info(), len(calls)))

print('--- the same result object')
f = make(lambda x: [x], None)
t(lambda: f(1) is f(1))
f = make(lambda x: [x], 5)
t(lambda: f(1) is f(1))
f = make(lambda x: [x], 0)
t(lambda: f(1) is f(1))
f = make(lambda: None, None)
t(lambda: (f(), f(), f.cache_info()))

print('--- what cannot be hashed')
for maxsize in (None, 2):
    f = make(anything, maxsize)
    t(lambda: f([]))
    t(lambda: f(1, {}))
    t(lambda: f(a=[]))
    t(lambda: f(set()))
    t(lambda: f.cache_info())


class HashCounter:
    def __init__(self):
        self.hashes = 0
        self.eqs = 0

    def __hash__(self):
        self.hashes += 1
        return 42

    def __eq__(self, other):
        self.eqs += 1
        return self is other


for maxsize in (None, 1, 2):
    f = make(lambda x: 0, maxsize)
    a, b = HashCounter(), HashCounter()
    f(a); f(a); f(b); f(b); f(a)
    print(maxsize, a.hashes, b.hashes, f.cache_info())


class BadHash:
    def __hash__(self):
        raise ZeroDivisionError('bad hash')


class BadEq:
    def __hash__(self):
        return 1

    def __eq__(self, other):
        raise ZeroDivisionError('bad eq')


for maxsize in (None, 2):
    f = make(anything, maxsize)
    t(lambda: f(BadHash()))
    t(lambda: f(BadEq()) is not None)
    t(lambda: f(BadEq()))
    t(lambda: f.cache_info())

print('--- exceptions are not cached')
for maxsize in (None, 0, 2):
    calls.clear()

    def failing(x):
        calls.append(x)
        raise KeyError(x)

    f = make(failing, maxsize)
    t(lambda: f(1))
    t(lambda: f(1))
    t(lambda: (calls, f.cache_info()))

print('--- recursion')
for maxsize in (None, 3, 100):
    def fib(n):
        return n if n < 2 else fib(n - 1) + fib(n - 2)

    fib = make(fib, maxsize)
    print(maxsize, fib(30), fib.cache_info())

# The function fills the cache with the same key while it runs.
for maxsize in (None, 1, 2):
    depth = []

    def again(x):
        if not depth:
            depth.append(1)
            return ('outer', g(x))
        return 'inner'

    g = make(again, maxsize)
    print(maxsize, g(1), g(1), g.cache_info())

# The function clears the cache while it runs.
for maxsize in (None, 1, 2):
    def clearing(x):
        h.cache_clear()
        return x

    h = make(clearing, maxsize)
    print(maxsize, [h(i) for i in (1, 2, 3, 1)], h.cache_info())

# The cache is full, and the function evicts what would have been evicted.
def nested(x):
    if x == 'outer':
        k('a'); k('b'); k('c')
    return x


k = make(nested, 2)
print([k(x) for x in ('x', 'y', 'outer', 'outer', 'c', 'b')], k.cache_info())

print('--- arguments')
t(lambda: wrapper())
t(lambda: wrapper(square))
t(lambda: wrapper(square, 1))
t(lambda: wrapper(square, 1, False))
t(lambda: wrapper(square, 1, False, info, 1))
t(lambda: wrapper(1, 1, False, info))
t(lambda: wrapper(None, 1, False, info))
t(lambda: wrapper(square, 'a', False, info))
t(lambda: wrapper(square, 1.0, False, info))
t(lambda: wrapper(square, [], False, info))
t(lambda: wrapper(square, 2 ** 70, False, info))
t(lambda: wrapper(square, -2 ** 70, False, info))
t(lambda: wrapper(user_function=square, maxsize=1, typed=False, cache_info_type=info).cache_info())
t(lambda: wrapper(square, 1, cache_info_type=info, typed=True).cache_info())
t(lambda: wrapper(square, 1, False, info, x=1))
t(lambda: wrapper(square, 1, False, x=1))
t(lambda: wrapper(square, 1, False, info, typed=1))
t(lambda: wrapper(square, 1, False, cache_info_typ=info))
t(lambda: wrapper(square, 1, False, None).cache_info())
t(lambda: wrapper(square, 1, False, 5).cache_info())
t(lambda: wrapper(square, 1, False, lambda: 0).cache_info())


class BadBool:
    def __bool__(self):
        raise RuntimeError('bad bool')


t(lambda: wrapper(1, 'a', BadBool(), info))
f = make(square, 2)
t(lambda: f.cache_info(1))
t(lambda: f.cache_clear(1))
t(lambda: f.cache_info(x=1))
t(lambda: f())
t(lambda: f(1, 2))
t(lambda: f.cache_info())

print('--- attributes')
f = make(square, 2)
t(lambda: f.__dict__)
f.__wrapped__ = square
f.__name__ = 'square'
f.__qualname__ = 'mod.square'
f.__doc__ = 'doc'
f.anything = 1
t(lambda: sorted(f.__dict__))
t(lambda: (f.__wrapped__ is square, f.__name__, f.__doc__, f.anything))
t(lambda: f.__reduce__())
t(lambda: f.__copy__() is f)
t(lambda: f.__deepcopy__({}) is f)
t(lambda: f.__deepcopy__() is f)
del f.anything
t(lambda: hasattr(f, 'anything'))
t(lambda: callable(f))
t(lambda: f == f)
t(lambda: f != make(square, 2))
t(lambda: hash(f) == hash(f))


def set_dict():
    g = make(square, 2)
    g.__dict__ = {'a': 1}
    return g.a


t(set_dict)


def del_dict():
    del make(square, 2).__dict__


def bad_dict():
    make(square, 2).__dict__ = []


t(del_dict)
t(bad_dict)

print('--- as a method')


class A:
    def __init__(self, n):
        self.n = n

    def __repr__(self):
        return 'A(%d)' % self.n

    def __hash__(self):
        return self.n

    def __eq__(self, other):
        return self.n == other.n

    method = make(lambda self, x: (self, x), None)
    static = staticmethod(make(lambda x: ('static', x), None))
    cls = classmethod(make(lambda cls, x: (cls.__name__, x), None))


a = A(1)
t(lambda: a.method(2))
t(lambda: A(1).method(2))
t(lambda: A(2).method(2))
t(lambda: A.method.cache_info())
t(lambda: A.method(a, 2))
t(lambda: a.static(3))
t(lambda: A.cls(4))
t(lambda: type(a.method).__name__)
t(lambda: a.method.__self__)
t(lambda: a.method.__func__ is A.__dict__['method'])
t(lambda: A.method is A.__dict__['method'])
t(lambda: a.method.cache_info())
f = make(square, 2)
t(lambda: f.__get__(None, A) is f)
t(lambda: f.__get__(3)())
t(lambda: f.__get__(3, int)())
t(lambda: f.__get__(None))
t(lambda: f.__get__())

print('--- the type')
t(lambda: (wrapper.__name__, wrapper.__qualname__, wrapper.__module__, repr(wrapper)))
t(lambda: sorted(n for n in vars(wrapper) if n not in ('__doc__', '__module__')))
t(lambda: wrapper.__mro__ == (wrapper, object))
t(lambda: wrapper.__doc__.splitlines()[0])


def derive():
    class X(wrapper):
        pass


try:
    derive()
    print('can be derived from')
except TypeError:
    print('is final')
print(sorted(n for n in dir(_functools) if not n.startswith('__')))
print(_functools.__name__, _functools.__doc__)
