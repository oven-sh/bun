# The iterators can be neither copied nor pickled (since 3.14), but for tee's.
import itertools
from itertools import *
import copy


def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)


samples = [accumulate([1]), batched('ab', 1), chain('a'), combinations('ab', 1), combinations_with_replacement('ab', 1), compress('a', [1]), count(),
           cycle('a'), dropwhile(bool, []), filterfalse(bool, []), groupby('a'), islice('a', 1), pairwise('ab'), permutations('a'), product('a'),
           repeat(1), starmap(pow, []), takewhile(bool, []), zip_longest('a'), next(groupby('a'))[1]]
for it in samples:
    print(type(it).__name__)
    for name in ('__reduce__', '__setstate__', '__copy__', '__deepcopy__', '__getstate__'):
        print('  ', name, name in vars(type(it)))
    t(lambda: it.__reduce_ex__(2))
    t(lambda: it.__reduce_ex__(4))
    t(lambda: it.__reduce__())
    t(lambda: copy.copy(it))
    t(lambda: copy.deepcopy(it))

a, b = tee('abc')
next(a)
c = copy.copy(a)
t(lambda: (type(c).__name__, list(c), list(a), list(b)))
t(lambda: copy.deepcopy(a))
t(lambda: a.__reduce_ex__(4))
