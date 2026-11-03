# islice, batched
from itertools import islice, batched, count, repeat, chain
import sys


def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)


def drain(it, n=10):
    out = []
    for i in range(n):
        try:
            out.append(next(it))
        except BaseException as e:
            out.append(type(e).__name__)
    return out


def raiser(n, exc=ValueError):
    for i in range(n):
        yield i
    raise exc('after %d' % n)


class Index:
    def __init__(self, v):
        self.v = v

    def __index__(self):
        return self.v


print('--- islice against slices')
for args in [(10,), (0,), (3,), (100,), (None,), (2, 8), (2, None), (None, 5), (None, None), (0, 0), (5, 5), (8, 2), (20, 30),
             (2, 8, 1), (2, 8, 2), (2, 8, 3), (2, 9, 3), (None, None, 3), (1, None, 4), (None, 7, 2), (0, 10, 100), (3, 4, 100),
             (None, None, None), (2, 8, None), (9, 10), (10, 11), (0, 1, 1)]:
    got = list(islice(range(10), *args))
    want = list(range(10))[slice(*args)]
    print(args, got, got == want)

print('--- islice arguments')
t(lambda: list(islice('abcdef', Index(2))))
t(lambda: list(islice('abcdef', Index(1), Index(5), Index(2))))
t(lambda: list(islice('abcdef', True)))
t(lambda: list(islice('abcdef', sys.maxsize)))
t(lambda: list(islice('abcdef', 1, sys.maxsize, sys.maxsize)))
t(lambda: list(islice('abcdef', sys.maxsize, sys.maxsize)))
t(lambda: list(islice(count(), 3, 10, sys.maxsize)))
t(lambda: islice())
t(lambda: islice('a'))
t(lambda: islice('a', 1, 2, 3, 4))
t(lambda: islice('a', stop=1))
t(lambda: islice(1, 1))
t(lambda: islice('a', -1))
t(lambda: islice('a', 'a'))
t(lambda: islice('a', 1.0))
t(lambda: islice('a', sys.maxsize + 1))
t(lambda: islice('a', -1, 1))
t(lambda: islice('a', 'a', 1))
t(lambda: islice('a', 1.0, 1))
t(lambda: islice('a', sys.maxsize + 1, 1))
t(lambda: islice('a', 1, -1))
t(lambda: islice('a', 1, -2))
t(lambda: islice('a', 1, 'a'))
t(lambda: islice('a', 1, 2, 0))
t(lambda: islice('a', 1, 2, -1))
t(lambda: islice('a', 1, 2, 'a'))
t(lambda: islice('a', 1, 2, 1.0))
t(lambda: islice('a', 1, 2, sys.maxsize + 1))
t(lambda: islice('a', None, None, 0))
t(lambda: islice(1, -1))
t(lambda: islice('a', -1, -1, -1))


class BadIndex:
    def __index__(self):
        raise ZeroDivisionError('bad index')


t(lambda: islice('a', BadIndex()))
t(lambda: islice('a', BadIndex(), 1))
t(lambda: islice('a', 0, 1, BadIndex()))

print('--- islice consumption')
it = iter(range(10))
t(lambda: (list(islice(it, 3)), list(it)))
it = iter(range(10))
t(lambda: (list(islice(it, 2, 4)), list(it)))
it = iter(range(10))
t(lambda: (list(islice(it, 2, 7, 3)), list(it)))
it = iter(range(10))
t(lambda: (list(islice(it, 0)), list(it)))
it = iter(range(10))
t(lambda: (list(islice(it, 3, 3)), list(it)))
it = iter(range(10))
t(lambda: (list(islice(it, 5, 3)), list(it)))
it = iter(range(10))
t(lambda: (list(islice(it, 20, 30)), list(it)))
it = iter(range(10))
s = islice(it, 1, 8, 3)
t(lambda: (next(s), next(it), next(s), list(it)))
t(lambda: drain(islice(raiser(3), 10), 6))
t(lambda: drain(islice(raiser(3), 5, 10), 3))
t(lambda: drain(islice(raiser(3), 2), 4))
t(lambda: drain(islice(range(3), 2), 4))
c = count()
t(lambda: (list(islice(c, 1, 3, 50)), next(c)))
s = islice('abc', 2)
t(lambda: iter(s) is s)

print('--- batched')
for n in range(1, 8):
    print(n, list(batched('ABCDEFG', n)))
t(lambda: list(batched('', 3)))
t(lambda: list(batched('A', 3)))
t(lambda: list(batched(range(6), 2)))
t(lambda: list(batched(range(6), 2, strict=True)))
t(lambda: list(batched(range(7), 2, strict=True)))
t(lambda: list(batched(range(7), 2, strict=False)))
t(lambda: list(batched(range(7), 2, strict=0)))
t(lambda: list(batched(range(7), 2, strict='yes')))
t(lambda: list(batched([], 2, strict=True)))
t(lambda: list(batched(iterable='abc', n=2)))
t(lambda: list(batched('abc', n=2)))
t(lambda: list(batched(n=2, iterable='abc', strict=False)))
t(lambda: list(batched('abcde', Index(2))))
t(lambda: list(batched('abcde', True)))
t(lambda: list(islice(batched(count(), 3), 3)))
t(lambda: list(batched(range(25), 12)))
t(lambda: [type(b).__name__ for b in batched('abc', 2)])
t(lambda: batched())
t(lambda: batched('a'))
t(lambda: batched('a', 1, True))
t(lambda: batched('a', 1, 2, 3))
t(lambda: batched('a', 0))
t(lambda: batched('a', -1))
t(lambda: batched('a', 'b'))
t(lambda: batched('a', 1.0))
t(lambda: batched('a', None))
t(lambda: batched('a', 2 ** 70))
t(lambda: batched('a', -2 ** 70))
t(lambda: batched(1, 1))
t(lambda: batched(1, 0))
t(lambda: batched(None, 1))
t(lambda: batched('a', 1, x=1))
t(lambda: batched('a', 1, iterable='a'))
t(lambda: batched('a', n=1, strictly=1))
t(lambda: drain(batched(raiser(5), 2), 6))
t(lambda: drain(batched(raiser(4), 2), 6))
t(lambda: drain(batched(raiser(0), 2), 3))
t(lambda: drain(batched(range(5), 2, strict=True), 6))
t(lambda: drain(batched(range(5), 2), 6))
b = batched('abcd', 2)
t(lambda: iter(b) is b)
x = next(b)
y = next(b)
t(lambda: (x, y))


class BadBool:
    def __bool__(self):
        raise RuntimeError('bad bool')


t(lambda: batched('a', 1, strict=BadBool()))
