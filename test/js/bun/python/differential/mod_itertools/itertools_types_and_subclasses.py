# The types themselves, and classes derived from them.
import itertools
from itertools import *


def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)


names = ['accumulate', 'batched', 'chain', 'combinations', 'combinations_with_replacement', 'compress', 'count', 'cycle', 'dropwhile',
         'filterfalse', 'groupby', 'islice', 'pairwise', 'permutations', 'product', 'repeat', 'starmap', 'takewhile', 'zip_longest',
         '_grouper', '_tee', '_tee_dataobject']
print(sorted(n for n in dir(itertools) if not n.startswith('__')))
print(itertools.__name__, type(itertools).__name__)
for name in names:
    cls = getattr(itertools, name)
    print(name, type(cls).__name__, cls.__name__, cls.__qualname__, cls.__module__, cls.__mro__ == (cls, object), repr(cls),
          sorted(k for k in vars(cls) if k not in ('__doc__', '__getattribute__', '__module__')))
print(type(tee).__name__, tee.__name__, tee.__qualname__, tee.__module__, repr(tee))

samples = {
    'accumulate': lambda c: c([1, 2, 3]),
    'batched': lambda c: c('abcde', 2),
    'chain': lambda c: c('ab', 'c'),
    'combinations': lambda c: c('abc', 2),
    'combinations_with_replacement': lambda c: c('ab', 2),
    'compress': lambda c: c('abc', [1, 0, 1]),
    'count': lambda c: c(5),
    'cycle': lambda c: c('ab'),
    'dropwhile': lambda c: c(lambda x: x < 2, [1, 2, 3]),
    'filterfalse': lambda c: c(None, [0, 1, 2, 0]),
    'groupby': lambda c: c('aab'),
    'islice': lambda c: c('abcdef', 1, 4),
    'pairwise': lambda c: c('abc'),
    'permutations': lambda c: c('ab'),
    'product': lambda c: c('ab', 'c'),
    'repeat': lambda c: c('x', 3),
    'starmap': lambda c: c(pow, [(2, 3)]),
    'takewhile': lambda c: c(lambda x: x < 2, [1, 2, 3]),
    'zip_longest': lambda c: c('ab', 'c'),
}


def show(it):
    out = []
    for x in islice(it, 4):
        if isinstance(x, tuple) and len(x) == 2 and type(x[1]) is itertools._grouper:
            x = (x[0], list(x[1]))
        out.append(x)
    return out


print('--- instances')
for name, make in samples.items():
    cls = getattr(itertools, name)
    it = make(cls)
    print(name, type(it) is cls, isinstance(it, cls), iter(it) is it, hasattr(it, '__next__'), hasattr(it, '__dict__'), show(it))
    try:
        it.attribute = 1
        print('  attribute set')
    except AttributeError:
        print('  no attributes')
    print('  hash', hash(it) == hash(it), it == it, it != make(cls), bool(it))

print('--- subclasses')
for name, make in samples.items():
    base = getattr(itertools, name)

    class Sub(base):
        extra = 'extra'

        def double(self):
            return [next(self), next(self, 'end')]

    it = make(Sub)
    it.attribute = 1
    print(name, type(it) is Sub, isinstance(it, base), it.extra, it.attribute, it.__dict__, iter(it) is it, Sub.__mro__ == (Sub, base, object))
    first = it.double()
    if name != 'groupby':
        print('  ', first)

print('--- final types')
for name in ('_grouper', '_tee', '_tee_dataobject'):
    try:
        type('Sub', (getattr(itertools, name),), {})
        print(name, 'can be derived from')
    except TypeError:
        print(name, 'is final')

print('--- __next__ overridden')


class Doubling(count):
    def __next__(self):
        return super().__next__() * 2


t(lambda: list(islice(Doubling(1), 4)))
t(lambda: repr(Doubling(3)))
t(lambda: repr(Doubling(3, 2)))
t(lambda: repr(Doubling(1.5)))


class R(repeat):
    pass


t(lambda: repr(R('a')))
t(lambda: repr(R('a', 2)))

print('--- keywords for the __init__ of a subclass')
for name, args in (('chain', ('ab',)), ('cycle', ('ab',)), ('dropwhile', (bool, [1, 0])), ('takewhile', (bool, [1, 0])), ('starmap', (pow, [(1, 2)])),
                   ('filterfalse', (bool, [1, 0])), ('islice', ('abc', 2)), ('pairwise', ('abc',))):
    base = getattr(itertools, name)

    class WithInit(base):
        def __init__(self, *args, tag=None):
            self.tag = tag

    class WithoutInit(base):
        pass

    it = WithInit(*args, tag='t')
    print(name, it.tag, list(islice(it, 3)))
    t(lambda: WithoutInit(*args, tag='t'))

print('--- __new__ called directly')
t(lambda: list(chain.__new__(chain, 'ab', 'c')))
t(lambda: list(islice(count.__new__(count, 3), 2)))
t(lambda: chain.__new__(count))
t(lambda: chain.__new__(int))
t(lambda: chain.__new__())
t(lambda: chain.__new__(1))
t(lambda: object.__new__(chain))


class C2(chain):
    pass


t(lambda: type(chain.__new__(C2, 'ab')) is C2)
t(lambda: type(C2.from_iterable(['ab'])) is C2)
t(lambda: list(C2.from_iterable(['ab', 'c'])))
t(lambda: C2[int].__origin__ is C2)

print('--- methods through the type')
t(lambda: chain.__next__(chain('ab')))
t(lambda: chain.__iter__(1))
t(lambda: chain.__next__(count()))
t(lambda: count.__repr__(count(2)))
t(lambda: next(chain()))
t(lambda: chain().__next__())

print('--- with the built-in consumers')
t(lambda: sum(islice(count(), 10)))
t(lambda: max(chain([1, 5], [3])))
t(lambda: sorted(chain('cb', 'a')))
t(lambda: tuple(repeat(1, 3)))
t(lambda: set(cycle_ for cycle_ in islice(cycle('ab'), 5)) == {'a', 'b'})
t(lambda: dict(zip_longest('ab', [1])))
t(lambda: [*chain('ab', 'c')])
t(lambda: (lambda *a: a)(*repeat(0, 2)))
t(lambda: 'b' in chain('ab', 'c'))
t(lambda: 'z' in chain('ab', 'c'))
t(lambda: list(map(list, batched(range(5), 2))))
t(lambda: list(enumerate(pairwise('abc'))))
t(lambda: list(zip(count(), 'ab', strict=False)))
t(lambda: ''.join(chain.from_iterable(['ab', 'cd'])))
t(lambda: list(reversed(list(accumulate([1, 2, 3])))))
a, b, *c = count_ = islice(count(), 5)
t(lambda: (a, b, c))
t(lambda: len(chain()))
t(lambda: chain()[0])
t(lambda: reversed(chain()))
