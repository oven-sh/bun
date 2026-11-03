# chain, compress, dropwhile, takewhile, filterfalse, starmap, pairwise, accumulate, zip_longest
from itertools import *
import operator


def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)


def raiser(n, exc=ValueError):
    for i in range(n):
        yield i
    raise exc('after %d' % n)


def drain(it, n=10):
    "What next() gives, n times: values, or the names of the exceptions."
    out = []
    for i in range(n):
        try:
            out.append(next(it))
        except BaseException as e:
            out.append(type(e).__name__)
    return out


print('--- chain')
t(lambda: list(chain()))
t(lambda: list(chain('')))
t(lambda: list(chain('abc')))
t(lambda: list(chain('abc', 'def')))
t(lambda: list(chain('abc', [], (1, 2), {3: 4}, range(2))))
t(lambda: list(chain(*['ab'] * 3)))
t(lambda: list(chain.from_iterable(['abc', 'def'])))
t(lambda: list(chain.from_iterable([])))
t(lambda: list(chain.from_iterable('abc')))
t(lambda: list(chain.from_iterable(iter([[1], [2, 3]]))))
t(lambda: list(islice(chain.from_iterable(repeat(range(3))), 8)))
t(lambda: list(chain(1)))
t(lambda: list(chain([1], 2)))
t(lambda: drain(chain([1], 2, [3]), 4))
t(lambda: drain(chain.from_iterable([[1], 2, [3]]), 4))
t(lambda: chain.from_iterable(1))
t(lambda: drain(chain(raiser(2), [7]), 6))
t(lambda: drain(chain.from_iterable(raiser(0)), 3))
t(lambda: drain(chain.from_iterable([x] for x in raiser(2)), 5))
t(lambda: chain[int])
t(lambda: chain[int, str].__origin__ is chain)
t(lambda: type(chain.from_iterable([])) is chain)
t(lambda: chain.from_iterable())
t(lambda: chain.from_iterable([], []))
t(lambda: chain.from_iterable(iterable=[]))
t(lambda: chain(x=1))
c = chain('ab', 'c')
t(lambda: iter(c) is c)
t(lambda: (next(c), list(c), list(c), next(c, 'end')))

print('--- compress')
t(lambda: list(compress('ABCDEF', [1, 0, 1, 0, 1, 1])))
t(lambda: list(compress('ABCDEF', [])))
t(lambda: list(compress('', [1, 1])))
t(lambda: list(compress('ABCDEF', [1, 1])))
t(lambda: list(compress('AB', [1, 1, 1, 1])))
t(lambda: list(compress('ABC', ['', 'x', None])))
t(lambda: list(compress(data='ABC', selectors=[0, 1, 1])))
t(lambda: list(compress(selectors=[0, 1, 1], data='ABC')))
t(lambda: list(compress('ABC', selectors=[0, 1, 1])))
t(lambda: list(compress(count(), [1, 0, 1])))
t(lambda: list(islice(compress(count(), cycle([0, 0, 1])), 4)))
t(lambda: compress())
t(lambda: compress('a'))
t(lambda: compress('a', 'b', 'c'))
t(lambda: compress(1, []))
t(lambda: compress([], 1))
t(lambda: compress(None, None))
t(lambda: compress('a', 'b', x=1))
t(lambda: compress('a', data='b'))


class BadBool:
    def __bool__(self):
        raise RuntimeError('bad bool')


t(lambda: drain(compress('abcd', [1, BadBool(), 0, 1]), 5))
# The data is taken before the selector.
d = iter('abc')
t(lambda: (list(compress(d, [1])), list(d)))

print('--- dropwhile')
t(lambda: list(dropwhile(lambda x: x < 5, [1, 4, 6, 3, 8])))
t(lambda: list(dropwhile(lambda x: x < 5, [])))
t(lambda: list(dropwhile(lambda x: True, [1, 2])))
t(lambda: list(dropwhile(lambda x: False, [1, 2])))
t(lambda: list(dropwhile(bool, [1, 1, 0, 1, 0])))
t(lambda: list(dropwhile(None, [1])))
t(lambda: dropwhile())
t(lambda: dropwhile(None))
t(lambda: dropwhile(None, 1))
t(lambda: dropwhile(None, [], 1))
t(lambda: dropwhile(predicate=None, iterable=[]))
t(lambda: drain(dropwhile(lambda x: 1 / (x - 1), [0, 1, 2, 3]), 5))
t(lambda: drain(dropwhile(lambda x: BadBool(), [0, 1]), 3))
t(lambda: drain(dropwhile(lambda x: x < 1, raiser(3)), 5))
calls = []
t(lambda: (list(dropwhile(lambda x: calls.append(x) or x < 2, range(5))), calls))

print('--- takewhile')
t(lambda: list(takewhile(lambda x: x < 5, [1, 4, 6, 3, 8])))
t(lambda: list(takewhile(lambda x: x < 5, [])))
t(lambda: list(takewhile(lambda x: True, [1, 2])))
t(lambda: list(takewhile(lambda x: False, [1, 2])))
t(lambda: list(takewhile(bool, [1, 1, 0, 1, 0])))
t(lambda: list(takewhile(None, [1])))
t(lambda: takewhile())
t(lambda: takewhile(None))
t(lambda: takewhile(None, 1))
t(lambda: takewhile(None, [], 1))
t(lambda: takewhile(predicate=None, iterable=[]))
t(lambda: drain(takewhile(lambda x: 1 / (x - 1), [0, 1, 2, 3]), 6))
t(lambda: drain(takewhile(lambda x: x < 2, [0, 1, 2, 0, 0]), 6))
src = iter([1, 2, 9, 3])
t(lambda: (list(takewhile(lambda x: x < 5, src)), list(src)))

print('--- filterfalse')
t(lambda: list(filterfalse(lambda x: x % 2, range(10))))
t(lambda: list(filterfalse(None, [0, 1, '', 'a', [], [0], None])))
t(lambda: list(filterfalse(bool, [0, 1, '', 'a', [], [0], None])))
t(lambda: list(filterfalse(lambda x: True, range(3))))
t(lambda: list(filterfalse(lambda x: False, range(3))))
t(lambda: list(filterfalse(None, [])))
t(lambda: filterfalse())
t(lambda: filterfalse(None))
t(lambda: filterfalse(None, 1))
t(lambda: filterfalse(None, [], 1))
t(lambda: filterfalse(function=None, iterable=[]))
t(lambda: list(filterfalse(1, [1])))
t(lambda: drain(filterfalse(lambda x: 1 / x, [1, 0, 2]), 4))
t(lambda: drain(filterfalse(None, [1, BadBool(), 0]), 4))

print('--- starmap')
t(lambda: list(starmap(pow, [(2, 5), (3, 2), (10, 3)])))
t(lambda: list(starmap(pow, [])))
t(lambda: list(starmap(lambda: 'none', [(), [], ''])))
t(lambda: list(starmap(lambda *a: a, ['ab', [1], (2, 3), range(3), {4: 5}])))
t(lambda: list(starmap(operator.add, zip(range(3), range(3)))))
t(lambda: list(starmap(pow, [1])))
t(lambda: list(starmap(pow, [None])))
t(lambda: list(starmap(1, [(1,)])))
t(lambda: list(starmap(pow, [(1,)])))
t(lambda: starmap())
t(lambda: starmap(pow))
t(lambda: starmap(pow, 1))
t(lambda: starmap(pow, [], 1))
t(lambda: starmap(function=pow, iterable=[]))
t(lambda: drain(starmap(lambda a: 1 / a, [(1,), (0,), (2,)]), 5))


class T(tuple):
    def __iter__(self):
        return iter((7, 8))


t(lambda: list(starmap(lambda *a: a, [T((1, 2))])))

print('--- pairwise')
t(lambda: list(pairwise('')))
t(lambda: list(pairwise('a')))
t(lambda: list(pairwise('ab')))
t(lambda: list(pairwise('abcde')))
t(lambda: list(pairwise(range(5))))
t(lambda: list(islice(pairwise(count()), 3)))
t(lambda: pairwise())
t(lambda: pairwise(1))
t(lambda: pairwise('a', 'b'))
t(lambda: pairwise(iterable='a'))
t(lambda: pairwise(None))
t(lambda: drain(pairwise(raiser(3)), 5))
t(lambda: drain(pairwise(raiser(0)), 3))
t(lambda: drain(pairwise(raiser(1)), 3))
p = pairwise('abc')
a = next(p)
b = next(p)
t(lambda: (a, b, a is not b))

print('--- accumulate')
t(lambda: list(accumulate([1, 2, 3, 4, 5])))
t(lambda: list(accumulate([])))
t(lambda: list(accumulate([7])))
t(lambda: list(accumulate('abc')))
t(lambda: list(accumulate([[1], [2], [3]])))
t(lambda: list(accumulate([1, 2, 3, 4, 5], operator.mul)))
t(lambda: list(accumulate([1, 2, 3, 4, 5], func=operator.mul)))
t(lambda: list(accumulate(iterable=[1, 2, 3], func=None)))
t(lambda: list(accumulate([3, 1, 4, 1, 5, 9, 2], max)))
t(lambda: list(accumulate([3, 1, 4, 1, 5, 9, 2], min)))
t(lambda: list(accumulate([1, 2, 3], initial=100)))
t(lambda: list(accumulate([], initial=100)))
t(lambda: list(accumulate([1, 2, 3], initial=None)))
t(lambda: list(accumulate([1, 2, 3], operator.sub, initial=0)))
t(lambda: list(accumulate([1, 2, 3], None, initial=0.5)))
t(lambda: list(accumulate(['a', 'b'], lambda a, b: b + a, initial='_')))
t(lambda: list(accumulate([1.5, 2, 3j])))
t(lambda: list(accumulate([1, 'a'])))
t(lambda: list(accumulate([1, 2], 5)))
t(lambda: list(accumulate([1], 5)))
t(lambda: accumulate())
t(lambda: accumulate(1))
t(lambda: accumulate([], None, 1))
t(lambda: accumulate([], None, None, None))
t(lambda: accumulate([], x=1))
t(lambda: accumulate([], iterable=[]))
t(lambda: accumulate(func=None))
t(lambda: drain(accumulate([1, 2, 'a', 3, 4]), 6))
t(lambda: drain(accumulate(raiser(3)), 6))
t(lambda: list(islice(accumulate(repeat(2), operator.mul), 6)))
t(lambda: list(accumulate([None, None], lambda a, b: (a, b))))

print('--- zip_longest')
t(lambda: list(zip_longest()))
t(lambda: list(zip_longest('')))
t(lambda: list(zip_longest('abc')))
t(lambda: list(zip_longest('abc', 'de')))
t(lambda: list(zip_longest('ab', 'cdef', 'g')))
t(lambda: list(zip_longest('abc', 'de', fillvalue='-')))
t(lambda: list(zip_longest('abc', '', fillvalue=0)))
t(lambda: list(zip_longest('', '', fillvalue=0)))
t(lambda: list(zip_longest(fillvalue=0)))
t(lambda: list(zip_longest('ab', range(4), fillvalue=None)))
t(lambda: list(zip_longest(range(3), range(3))))
t(lambda: list(islice(zip_longest(count(), 'ab'), 4)))
t(lambda: zip_longest(1))
t(lambda: zip_longest('a', 1))
t(lambda: zip_longest('a', fill=1))
t(lambda: zip_longest('a', fillvalue=1, x=2))
t(lambda: zip_longest('a', x=2, fillvalue=1))
t(lambda: drain(zip_longest(raiser(1), 'abc'), 5))
t(lambda: drain(zip_longest('abc', raiser(1)), 5))
t(lambda: drain(zip_longest('a', 'ab'), 5))
z = zip_longest('ab', 'c')
t(lambda: iter(z) is z)
a = next(z)
b = next(z)
t(lambda: (a, b, a is not b))


class Revive:
    "Stops, then goes on."

    def __init__(self):
        self.n = 0

    def __iter__(self):
        return self

    def __next__(self):
        self.n += 1
        if self.n % 2 == 0:
            raise StopIteration
        return self.n


t(lambda: drain(zip_longest(Revive(), range(4)), 6))
t(lambda: drain(chain(Revive(), Revive()), 5))
t(lambda: drain(pairwise(Revive()), 4))
t(lambda: drain(cycle(Revive()), 4))
t(lambda: drain(takewhile(lambda x: True, Revive()), 5))
t(lambda: drain(dropwhile(lambda x: False, Revive()), 5))
t(lambda: drain(accumulate(Revive()), 5))
t(lambda: drain(compress(Revive(), repeat(1)), 5))
t(lambda: drain(filterfalse(None, Revive()), 3))
t(lambda: drain(starmap(lambda *a: a, ([x] for x in Revive())), 4))
t(lambda: drain(batched(Revive(), 2), 4))
t(lambda: drain(islice(Revive(), 10), 5))
