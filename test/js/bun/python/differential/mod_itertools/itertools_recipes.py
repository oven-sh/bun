# The tools put together, after the recipes in the documentation of itertools.
from itertools import *
import operator
import collections
import functools


def take(n, iterable):
    return list(islice(iterable, n))


def prepend(value, iterable):
    return chain([value], iterable)


def tabulate(function, start=0):
    return map(function, count(start))


def repeatfunc(function, times=None, *args):
    if times is None:
        return starmap(function, repeat(args))
    return starmap(function, repeat(args, times))


def flatten(list_of_lists):
    return chain.from_iterable(list_of_lists)


def ncycles(iterable, n):
    return chain.from_iterable(repeat(tuple(iterable), n))


def tail(n, iterable):
    return iter(collections.deque(iterable, maxlen=n))


def consume(iterator, n=None):
    if n is None:
        collections.deque(iterator, maxlen=0)
    else:
        next(islice(iterator, n, n), None)


def nth(iterable, n, default=None):
    return next(islice(iterable, n, None), default)


def quantify(iterable, predicate=bool):
    return sum(map(predicate, iterable))


def first_true(iterable, default=False, predicate=None):
    return next(filter(predicate, iterable), default)


def all_equal(iterable, key=None):
    return len(take(2, groupby(iterable, key))) <= 1


def unique_justseen(iterable, key=None):
    if key is None:
        return map(operator.itemgetter(0), groupby(iterable))
    return map(next, map(operator.itemgetter(1), groupby(iterable, key)))


def unique_everseen(iterable, key=None):
    seen = set()
    if key is None:
        for element in filterfalse(seen.__contains__, iterable):
            seen.add(element)
            yield element
    else:
        for element in iterable:
            k = key(element)
            if k not in seen:
                seen.add(k)
                yield element


def sliding_window(iterable, n):
    iterator = iter(iterable)
    window = collections.deque(islice(iterator, n - 1), maxlen=n)
    for x in iterator:
        window.append(x)
        yield tuple(window)


def grouper(iterable, n, *, incomplete='fill', fillvalue=None):
    iterators = [iter(iterable)] * n
    if incomplete == 'fill':
        return zip_longest(*iterators, fillvalue=fillvalue)
    if incomplete == 'strict':
        return zip(*iterators, strict=True)
    return zip(*iterators)


def roundrobin(*iterables):
    iterators = map(iter, iterables)
    for num_active in range(len(iterables), 0, -1):
        iterators = cycle(islice(iterators, num_active))
        yield from map(next, iterators)


def subslices(seq):
    slices = starmap(slice, combinations(range(len(seq) + 1), 2))
    return map(operator.getitem, repeat(seq), slices)


def iter_index(iterable, value, start=0, stop=None):
    iterator = islice(iterable, start, stop)
    for i, element in enumerate(iterator, start):
        if element is value or element == value:
            yield i


def iter_except(function, exception, first=None):
    try:
        if first is not None:
            yield first()
        while True:
            yield function()
    except exception:
        pass


def partition(predicate, iterable):
    t1, t2 = tee(iterable)
    return filterfalse(predicate, t1), filter(predicate, t2)


def powerset(iterable):
    s = list(iterable)
    return chain.from_iterable(combinations(s, r) for r in range(len(s) + 1))


def sum_of_squares(iterable):
    return sum(map(operator.mul, *tee(iterable)))


def reshape(matrix, columns):
    return batched(chain.from_iterable(matrix), columns, strict=True)


def transpose(matrix):
    return zip(*matrix, strict=True)


def matmul(m1, m2):
    n = len(m2[0])
    return batched(starmap(lambda a, b: sum(map(operator.mul, a, b)), product(m1, transpose(m2))), n)


def convolve(signal, kernel):
    kernel = tuple(kernel)[::-1]
    n = len(kernel)
    padded_signal = chain(repeat(0, n - 1), signal, repeat(0, n - 1))
    windowed_signal = sliding_window(padded_signal, n)
    return map(lambda w: sum(map(operator.mul, kernel, w)), windowed_signal)


def polynomial_from_roots(roots):
    factors = zip(repeat(1), map(operator.neg, roots))
    return list(functools.reduce(convolve, factors, [1]))


def sieve(n):
    if n > 2:
        yield 2
    data = bytearray((0, 1)) * (n // 2)
    for p in iter_index(data, 1, start=3, stop=int(n ** 0.5) + 1):
        data[p * p: n: p + p] = bytes(len(range(p * p, n, p + p)))
    yield from iter_index(data, 1, start=3)


def triplewise(iterable):
    for (a, _), (b, c) in pairwise(pairwise(iterable)):
        yield a, b, c


def nth_combination(iterable, r, index):
    pool = tuple(iterable)
    return nth(combinations(pool, r), index)


def running_median_like(iterable):
    return accumulate(iterable, lambda a, b: (a + b) / 2)


print(take(3, count(10)))
print(list(prepend(1, [2, 3])))
print(take(4, tabulate(lambda x: x * x)))
print(list(repeatfunc(pow, 3, 2, 5)))
print(take(2, repeatfunc(list)))
print(list(flatten([[1, 2], [], [3]])))
print(list(ncycles('ab', 3)))
print(list(tail(3, 'ABCDEFG')))
it = iter(range(10)); consume(it, 3); print(next(it)); consume(it); print(next(it, 'empty'))
print(nth('abcdef', 2), nth('abc', 10, 'default'))
print(quantify([0, 1, 2, 0, 3]), quantify(range(10), lambda x: x % 2))
print(first_true([0, '', 5, 6]), first_true([0, ''], 'none'), first_true(range(10), predicate=lambda x: x > 6))
print(all_equal('aaaa'), all_equal('aaab'), all_equal(''), all_equal('aAaA', str.lower))
print(list(unique_justseen('AAAABBBCCDAABBB')), list(unique_justseen('ABBcCAD', str.casefold)))
print(list(unique_everseen('AAAABBBCCDAABBB')), list(unique_everseen('ABBcCAD', str.casefold)))
print(list(sliding_window('ABCDEFG', 4)), list(sliding_window('AB', 4)))
print(list(grouper('ABCDEFG', 3, fillvalue='x')), list(grouper('ABCDEFG', 3, incomplete='ignore')))
try:
    print(list(grouper('ABCDEFG', 3, incomplete='strict')))
except ValueError as e:
    print('ValueError', e)
print(list(roundrobin('ABC', 'D', 'EF')))
print(list(subslices('ABCD')))
print(list(iter_index('AABCADEAF', 'A')), list(iter_index('AABCADEAF', 'A', 2, 6)))
d = collections.deque('abc')
print(list(iter_except(d.popleft, IndexError)))
s = {1}
print(list(iter_except(s.pop, KeyError, first=lambda: 'first')))
no, yes = partition(lambda x: x % 2, range(10)); print(list(no), list(yes))
print(list(powerset([1, 2, 3])))
print(sum_of_squares([10, 20, 30]))
print(list(reshape([(0, 1), (2, 3), (4, 5)], 3)))
print(list(transpose([(1, 2, 3), (11, 22, 33)])))
print(list(matmul([(7, 5), (3, 5)], [(2, 5), (7, 9)])))
print(list(convolve([1, -1, -20], [1, -3])))
print(polynomial_from_roots([5, -4, 3]))
print(list(sieve(60)))
print(list(triplewise('ABCDEFG')))
print(nth_combination('abcde', 3, 5))
print(list(running_median_like([1, 3, 5, 7])))

# Long chains of iterators
it = iter(range(100000))
for i in range(50):
    it = islice(it, 1, None)
print(next(it))
it = count()
for i in range(30):
    it = chain(it)
print(take(3, it))
a = iter(range(5))
for i in range(20):
    a, b = tee(a)
print(list(a), list(b))
print(sum(1 for _ in product(range(10), repeat=4)))
print(sum(1 for _ in permutations(range(7))))
print(sum(1 for _ in combinations(range(20), 4)))
print(sum(islice(accumulate(count()), 1000)))
print(len(list(zip(cycle('ab'), range(10000)))))
print(collections.Counter(map(len, (list(g) for k, g in groupby(x // 7 for x in range(100))))).most_common())
