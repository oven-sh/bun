# product, permutations, combinations, combinations_with_replacement
from itertools import product, permutations, combinations, combinations_with_replacement, islice, count
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


# Straightforward definitions to compare with.

def product_ref(*pools, repeat=1):
    result = [()]
    for pool in [tuple(p) for p in pools] * repeat:
        result = [x + (y,) for x in result for y in pool]
    return result


def permutations_ref(iterable, r=None):
    pool = tuple(iterable)
    n = len(pool)
    r = n if r is None else r
    return [tuple(pool[i] for i in ix) for ix in product_ref(range(n), repeat=r) if len(set(ix)) == r]


def combinations_ref(iterable, r):
    pool = tuple(iterable)
    return [tuple(pool[i] for i in ix) for ix in permutations_ref(range(len(pool)), r) if sorted(ix) == list(ix)]


def cwr_ref(iterable, r):
    pool = tuple(iterable)
    return [tuple(pool[i] for i in ix) for ix in product_ref(range(len(pool)), repeat=r) if sorted(ix) == list(ix)]


print('--- product')
t(lambda: list(product()))
t(lambda: list(product('')))
t(lambda: list(product('ab')))
t(lambda: list(product('ab', 'cd')))
t(lambda: list(product('ab', '', 'cd')))
t(lambda: list(product('ab', range(3))))
t(lambda: list(product('ab', repeat=2)))
t(lambda: list(product('ab', repeat=0)))
t(lambda: list(product(repeat=3)))
t(lambda: list(product('', repeat=0)))
t(lambda: list(product('ab', 'c', repeat=2)))
t(lambda: list(product([1, 2], repeat=True)))
t(lambda: len(list(product(range(3), repeat=5))))
t(lambda: list(product(iter('ab'), iter('cd'))))
t(lambda: list(product({1: 2, 3: 4}, (5,))))
t(lambda: list(islice(product(range(1000), repeat=10), 3)))
for pools, rep in [((), 1), (('abc',), 1), (('abc',), 2), (('ab', 'cde'), 1), (('ab', 'c', 'de'), 1), (('ab', 'c'), 2), (('a',), 4), (('', 'a'), 1),
                   (('abc', 'de', 'f', 'gh'), 1), (('ab',), 4)]:
    print(pools, rep, list(product(*pools, repeat=rep)) == product_ref(*pools, repeat=rep))
t(lambda: product(1))
t(lambda: product('a', 1))
t(lambda: product('a', repeat=-1))
t(lambda: product('a', repeat='a'))
t(lambda: product('a', repeat=1.0))
t(lambda: product('a', repeat=None))
t(lambda: product('a', repeat=2 ** 70))
t(lambda: product('a', repeat=sys.maxsize))
t(lambda: product('a', 'b', repeat=sys.maxsize // 8))
t(lambda: product('a', foo=1))
t(lambda: product('a', repeat=1, foo=1))
t(lambda: product('a', repea=1))
t(lambda: type(product(1, repeat=0)).__name__)
t(lambda: list(product(1, repeat=0)))
t(lambda: drain(product('ab'), 4))
t(lambda: drain(product(), 3))
t(lambda: drain(product(''), 3))
p = product('ab', 'cd')
t(lambda: iter(p) is p)
x = next(p)
y = next(p)
t(lambda: (x, y, x is not y))
l = [1, 2]
p = product(l, l)
l.append(3)
t(lambda: list(p))

print('--- permutations')
t(lambda: list(permutations('')))
t(lambda: list(permutations('a')))
t(lambda: list(permutations('ab')))
t(lambda: list(permutations('abc')))
t(lambda: list(permutations('abc', 2)))
t(lambda: list(permutations('abc', 0)))
t(lambda: list(permutations('abc', 1)))
t(lambda: list(permutations('abc', 3)))
t(lambda: list(permutations('abc', 4)))
t(lambda: list(permutations('', 0)))
t(lambda: list(permutations('', 1)))
t(lambda: list(permutations('abc', None)))
t(lambda: list(permutations('abc', r=2)))
t(lambda: list(permutations(iterable='ab', r=1)))
t(lambda: list(permutations(r=1, iterable='ab')))
t(lambda: list(permutations('aab', 2)))
t(lambda: list(permutations('ab', True)))
t(lambda: len(list(permutations(range(6)))))
t(lambda: list(permutations('abc', sys.maxsize)))
for n in range(6):
    for r in range(n + 2):
        got = list(permutations(range(n), r))
        if got != permutations_ref(range(n), r):
            print('MISMATCH', n, r)
    if list(permutations(range(n))) != permutations_ref(range(n)):
        print('MISMATCH', n)
print('compared')
t(lambda: permutations())
t(lambda: permutations(1))
t(lambda: permutations('a', 1, 2))
t(lambda: permutations('a', -1))
t(lambda: permutations('a', 'a'))
t(lambda: permutations('a', 1.0))
t(lambda: permutations('a', 2 ** 70))
t(lambda: permutations('a', -2 ** 70))
t(lambda: permutations('a', x=1))
t(lambda: permutations(None))
t(lambda: permutations(1, 'a'))
t(lambda: drain(permutations('ab'), 4))
t(lambda: drain(permutations(''), 3))
t(lambda: drain(permutations('a', 2), 3))


class Index:
    def __index__(self):
        return 1


t(lambda: permutations('ab', Index()))

print('--- combinations')
t(lambda: list(combinations('abcd', 2)))
t(lambda: list(combinations('abcd', 0)))
t(lambda: list(combinations('abcd', 1)))
t(lambda: list(combinations('abcd', 3)))
t(lambda: list(combinations('abcd', 4)))
t(lambda: list(combinations('abcd', 5)))
t(lambda: list(combinations('', 0)))
t(lambda: list(combinations('', 1)))
t(lambda: list(combinations(range(4), r=3)))
t(lambda: list(combinations(iterable='abc', r=2)))
t(lambda: list(combinations(r=2, iterable='abc')))
t(lambda: list(combinations('aab', 2)))
t(lambda: list(combinations('ab', True)))
t(lambda: list(combinations('ab', Index())))
t(lambda: list(combinations('abc', sys.maxsize)))
t(lambda: len(list(combinations(range(12), 6))))
for n in range(7):
    for r in range(n + 2):
        if list(combinations(range(n), r)) != combinations_ref(range(n), r):
            print('MISMATCH', n, r)
print('compared')
t(lambda: combinations())
t(lambda: combinations('a'))
t(lambda: combinations('a', 1, 2))
t(lambda: combinations('a', -1))
t(lambda: combinations('a', 'a'))
t(lambda: combinations('a', 1.0))
t(lambda: combinations('a', None))
t(lambda: combinations('a', 2 ** 70))
t(lambda: combinations(1, 1))
t(lambda: combinations(1, -1))
t(lambda: combinations('a', x=1))
t(lambda: combinations('a', 1, x=1))
t(lambda: drain(combinations('ab', 1), 4))
t(lambda: drain(combinations('ab', 0), 3))
t(lambda: drain(combinations('ab', 3), 3))

print('--- combinations_with_replacement')
cwr = combinations_with_replacement
t(lambda: list(cwr('abc', 2)))
t(lambda: list(cwr('abc', 0)))
t(lambda: list(cwr('abc', 1)))
t(lambda: list(cwr('ab', 3)))
t(lambda: list(cwr('a', 4)))
t(lambda: list(cwr('', 0)))
t(lambda: list(cwr('', 1)))
t(lambda: list(cwr('', sys.maxsize)))
t(lambda: list(cwr(range(3), r=2)))
t(lambda: list(cwr(iterable='ab', r=2)))
t(lambda: list(cwr('ab', True)))
for n in range(6):
    for r in range(6):
        if list(cwr(range(n), r)) != cwr_ref(range(n), r):
            print('MISMATCH', n, r)
print('compared')
t(lambda: cwr())
t(lambda: cwr('a'))
t(lambda: cwr('a', 1, 2))
t(lambda: cwr('a', -1))
t(lambda: cwr('a', 'a'))
t(lambda: cwr('a', None))
t(lambda: cwr('a', 2 ** 70))
t(lambda: cwr(1, 1))
t(lambda: cwr('a', x=1))
t(lambda: drain(cwr('ab', 1), 4))
t(lambda: drain(cwr('ab', 0), 3))
t(lambda: drain(cwr('', 2), 3))

print('--- results are separate tuples')
for it in (product('ab', 'cd'), permutations('abc', 2), combinations('abc', 2), cwr('abc', 2)):
    results = list(it)
    print(len(results), len({id(r) for r in results}) == len(results), all(type(r) is tuple for r in results))

print('--- sizes')
base = {}
for name, make in (('product', lambda n: product(*['ab'] * n)), ('combinations', lambda n: combinations('abcdefgh', n)),
                   ('cwr', lambda n: cwr('abcdefgh', n)), ('permutations', lambda n: permutations('abcdefgh', n))):
    print(name, [make(n).__sizeof__() - make(0).__sizeof__() for n in range(4)])
print(permutations('abc').__sizeof__() - permutations('').__sizeof__())
