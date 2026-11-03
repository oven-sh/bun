# _functools.reduce, _functools.cmp_to_key
import _functools
from _functools import reduce, cmp_to_key


def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)


def add(a, b):
    return a + b


print('--- reduce')
t(lambda: reduce(add, [1, 2, 3, 4]))
t(lambda: reduce(add, [1, 2, 3, 4], 100))
t(lambda: reduce(add, [1, 2, 3, 4], initial=100))
t(lambda: reduce(add, [], 100))
t(lambda: reduce(add, [], None))
t(lambda: reduce(add, [], initial=None))
t(lambda: reduce(add, [7]))
t(lambda: reduce(add, 'abc'))
t(lambda: reduce(add, ['a', 'b'], ''))
t(lambda: reduce(add, [[1], [2], [3]], []))
t(lambda: reduce(add, iter(range(5))))
t(lambda: reduce(add, (x for x in range(5))))
t(lambda: reduce(add, {1: 'a', 2: 'b'}))
t(lambda: reduce(lambda a, b: a * b, range(1, 21)))
t(lambda: reduce(lambda a, b: (a, b), 'abcd'))
t(lambda: reduce(lambda a, b: (a, b), 'abcd', None))
t(lambda: reduce(max, [3, 1, 4, 1, 5]))
t(lambda: reduce(42, [1]))
t(lambda: reduce(42, [], 1))
t(lambda: reduce(None, [5]))
t(lambda: reduce(add, range(1000)))

print('--- reduce errors')
t(lambda: reduce())
t(lambda: reduce(add))
t(lambda: reduce(add, [], 1, 2))
t(lambda: reduce(add, 1))
t(lambda: reduce(add, None))
t(lambda: reduce(add, 1, 2))
t(lambda: reduce(add, []))
t(lambda: reduce(add, ''))
t(lambda: reduce(add, iter([])))
t(lambda: reduce(42, [1, 2]))
t(lambda: reduce(add, [1, 'a']))
t(lambda: reduce(function=add, iterable=[]))
t(lambda: reduce(add, iterable=[]))
t(lambda: reduce(add, [], x=1))
t(lambda: reduce(add, [], 1, initial=2))
t(lambda: reduce(add, [], initia=2))


class BadIter:
    def __iter__(self):
        raise ValueError('bad iter')


class BadIterType:
    def __iter__(self):
        raise TypeError('my own type error')


class BadNext:
    def __iter__(self):
        return self

    def __next__(self):
        raise ZeroDivisionError('bad next')


class Seq:
    def __getitem__(self, i):
        if i < 3:
            return i + 1
        raise IndexError


t(lambda: reduce(add, BadIter()))
t(lambda: reduce(add, BadIterType()))
t(lambda: reduce(add, BadNext()))
t(lambda: reduce(add, BadNext(), 1))
t(lambda: reduce(add, Seq()))
t(lambda: reduce(lambda a, b: 1 / 0, [1, 2]))
t(lambda: (reduce.__name__, reduce.__qualname__, reduce.__module__, type(reduce).__name__, repr(reduce)))

print('--- cmp_to_key')


def cmp(a, b):
    return (a > b) - (a < b)


K = cmp_to_key(cmp)
t(lambda: sorted([3, 1, 2], key=K))
t(lambda: sorted([3, 1, 2], key=cmp_to_key(lambda a, b: cmp(b, a))))
t(lambda: sorted('the quick brown fox'.split(), key=cmp_to_key(lambda a, b: cmp(len(a), len(b)) or cmp(a, b))))
t(lambda: sorted(range(20), key=cmp_to_key(lambda a, b: cmp(a % 3, b % 3))))
t(lambda: max([3, 1, 2], key=K))
t(lambda: min([3, 1, 2], key=K))
t(lambda: cmp_to_key(mycmp=cmp)(1) < cmp_to_key(mycmp=cmp)(2))
for a, b in ((1, 2), (2, 1), (1, 1)):
    print(a, b, K(a) < K(b), K(a) <= K(b), K(a) == K(b), K(a) != K(b), K(a) > K(b), K(a) >= K(b))
t(lambda: K(5).obj)
t(lambda: K(obj=5).obj)
t(lambda: K.obj)
t(lambda: K(None).obj)
t(lambda: type(K) is type(K(1)))
t(lambda: K(1)(2).obj)
t(lambda: callable(K))
# Whatever the function returns is compared with 0.
t(lambda: cmp_to_key(lambda a, b: -0.5)(1) < cmp_to_key(lambda a, b: 1)(2))
t(lambda: cmp_to_key(lambda a, b: True)(1) > K(2))
t(lambda: cmp_to_key(lambda a, b: 'x')(1) < K(2))
t(lambda: cmp_to_key(lambda a, b: 'x')(1) == K(2))
t(lambda: cmp_to_key(lambda a, b: None)(1) != K(2))
t(lambda: cmp_to_key(lambda a, b: [])(1) >= K(2))


class Odd:
    def __lt__(self, other):
        return 'odd lt %r' % (other,)

    def __eq__(self, other):
        return 'odd eq %r' % (other,)


t(lambda: cmp_to_key(lambda a, b: Odd())(1) < K(2))
t(lambda: cmp_to_key(lambda a, b: Odd())(1) == K(2))

print('--- cmp_to_key errors')
t(lambda: cmp_to_key())
t(lambda: cmp_to_key(cmp, 1))
t(lambda: cmp_to_key(x=cmp))
t(lambda: cmp_to_key(cmp, mycmp=cmp))
t(lambda: cmp_to_key(mycm=cmp))
t(lambda: type(cmp_to_key(1)).__name__)
t(lambda: cmp_to_key(1)(1) < cmp_to_key(1)(2))
t(lambda: K())
t(lambda: K(1, 2))
t(lambda: K(x=1))
t(lambda: K(1, obj=2))
t(lambda: K(1, x=2))
t(lambda: K(1) < 1)
t(lambda: K(1) == 1)
t(lambda: K(1) != None)
t(lambda: 1 < K(1))
t(lambda: 1 == K(1))
t(lambda: K(1) < K)
t(lambda: K < K(1))
t(lambda: K == K)
t(lambda: K(1) < K('a'))
t(lambda: cmp_to_key(lambda a, b: 1 / 0)(1) < K(1))
t(lambda: cmp_to_key(lambda a: 0)(1) < K(1))
t(lambda: sorted([1, 2], key=cmp_to_key(lambda a, b: 1 / 0)))
t(lambda: hash(K(1)) and None)
t(lambda: {K(1)} and None)
t(lambda: type(K).__hash__)

print('--- obj')
k = K(1)
k.obj = 10
t(lambda: (k.obj, k > K(5)))
del k.obj
t(lambda: k.obj)
t(lambda: k < K(5))
t(lambda: K(5) < k)
del k.obj
t(lambda: k.obj)


def set_other():
    k.other = 1


t(lambda: hasattr(k, '__dict__'))
t(lambda: k.__text_signature__)

print('--- the type')
T = type(K)
t(lambda: (T.__name__, T.__qualname__, T.__module__, repr(T)))
t(lambda: sorted(n for n in vars(T) if n not in ('__doc__', '__module__', '__getattribute__')))


def derive():
    class X(T):
        pass


t(lambda: (cmp_to_key.__name__, cmp_to_key.__module__, type(cmp_to_key).__name__))

print('--- sort stability')
data = [(i % 3, i) for i in range(10)]
t(lambda: sorted(data, key=cmp_to_key(lambda a, b: cmp(a[0], b[0]))))
