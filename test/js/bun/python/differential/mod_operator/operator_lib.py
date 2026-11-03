# Lib/operator.py on top of _operator
import operator
import _operator


def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)


print(operator.__all__)
print(sorted(n for n in dir(operator) if not n.startswith('__') or n in ('__add__', '__call__', '__not__')))
# Everything comes from _operator.
for name in operator.__all__:
    if getattr(operator, name) is not getattr(_operator, name):
        print('not from _operator:', name)
print(operator.__doc__ == _operator.__doc__)
print(operator._compare_digest is _operator._compare_digest if hasattr(operator, '_compare_digest') else 'not there')

# The names with underscores
for name in ('lt', 'le', 'eq', 'ne', 'ge', 'gt', 'not_', 'abs', 'add', 'and_', 'call', 'floordiv', 'index', 'inv', 'invert', 'lshift', 'mod', 'mul',
             'matmul', 'neg', 'or_', 'pos', 'pow', 'rshift', 'sub', 'truediv', 'xor', 'concat', 'contains', 'delitem', 'getitem', 'setitem',
             'iadd', 'iand', 'iconcat', 'ifloordiv', 'ilshift', 'imod', 'imul', 'imatmul', 'ior', 'ipow', 'irshift', 'isub', 'itruediv', 'ixor'):
    dunder = '__%s__' % name.strip('_')
    print(dunder, getattr(operator, dunder) is getattr(operator, name))

t(lambda: operator.add(1, 2))
t(lambda: operator.__add__('a', 'b'))
t(lambda: operator.itemgetter(1)('abc'))
t(lambda: operator.attrgetter('real')(1))
t(lambda: operator.methodcaller('upper')('a'))
t(lambda: operator.itemgetter)
t(lambda: operator.itemgetter(1, 2))
t(lambda: operator.length_hint(iter('abc')))
t(lambda: operator.countOf('abca', 'a'))
t(lambda: operator.indexOf('abca', 'c'))
t(lambda: operator.is_none(None))
t(lambda: operator.is_not_none(None))
t(lambda: operator.call(max, 1, 2))
t(lambda: operator.__call__(max, 1, 2))
t(lambda: operator.__not__(1))

import copy
for g in (operator.itemgetter(1), operator.itemgetter(1, 2), operator.attrgetter('a.b', 'c'), operator.methodcaller('m', 1, k=[2])):
    c = copy.copy(g)
    d = copy.deepcopy(g)
    print(repr(c), repr(d), c is not g, type(c) is type(g))

import functools
t(lambda: functools.reduce(operator.add, range(5)))
t(lambda: functools.reduce(operator.mul, range(1, 6)))
t(lambda: functools.reduce(operator.concat, ['a', 'b', 'c']))
t(lambda: functools.partial(operator.mul, 3)(4))
t(lambda: sorted([(2, 'b'), (1, 'c')], key=operator.itemgetter(0)))
import itertools
t(lambda: list(itertools.accumulate(range(1, 6), operator.mul)))
t(lambda: list(itertools.starmap(operator.pow, [(2, 3), (3, 2)])))
t(lambda: [k for k, g in itertools.groupby([(1, 'a'), (1, 'b'), (2, 'c')], operator.itemgetter(0))])
t(lambda: list(map(operator.neg, range(3))))
