# groupby, _grouper, tee, _tee, _tee_dataobject
import itertools
from itertools import groupby, tee, islice, count, chain, repeat


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


print('--- groupby')
t(lambda: [(k, list(g)) for k, g in groupby('')])
t(lambda: [(k, list(g)) for k, g in groupby('a')])
t(lambda: [(k, list(g)) for k, g in groupby('AAAABBBCCDAABBB')])
t(lambda: [(k, ''.join(g)) for k, g in groupby('AAAABBBCCD')])
t(lambda: [k for k, g in groupby('AAAABBBCCDAABBB')])
t(lambda: [(k, list(g)) for k, g in groupby(range(10), lambda x: x // 3)])
t(lambda: [(k, list(g)) for k, g in groupby(range(10), key=lambda x: x // 3)])
t(lambda: [(k, list(g)) for k, g in groupby(iterable=range(4), key=None)])
t(lambda: [(k, list(g)) for k, g in groupby(key=lambda x: x % 2, iterable=[1, 3, 2, 4, 5])])
t(lambda: [(k, list(g)) for k, g in groupby([1, 1.0, True, 2, 2.0])])
t(lambda: [(k, list(g)) for k, g in groupby(['a', 'A', 'b', 'B', 'a'], str.lower)])
t(lambda: [(k, list(g)) for k, g in groupby([None, None, 0, None])])
t(lambda: [(k, len(list(g))) for k, g in groupby(sorted('the quick brown fox jumps'.split(), key=len), len)])

print('--- groups are views on the groupby')
# A group is over once the groupby has moved on.
groups = [g for k, g in groupby('aabbc')]
t(lambda: [list(g) for g in groups])
gb = groupby('aabbcc')
k1, g1 = next(gb)
t(lambda: (k1, next(g1)))
k2, g2 = next(gb)
t(lambda: (k2, list(g1), list(g2)))
t(lambda: [(k, list(g)) for k, g in gb])
# A group partly used.
gb = groupby('aaabbb')
k, g = next(gb)
next(g)
t(lambda: [(k, list(g)) for k, g in gb])
# The group goes on to the end of the data.
gb = groupby('aaa')
k, g = next(gb)
t(lambda: (list(g), next(gb, 'end'), list(g)))
# The groupby has ended: so has the group.
gb = groupby('ab')
k, g = next(gb)
k, h = next(gb)
t(lambda: (next(gb, 'end'), list(g), list(h)))
gb = groupby('aab')
t(lambda: iter(gb) is gb)
k, g = next(gb)
t(lambda: iter(g) is g)
t(lambda: type(g) is itertools._grouper)
t(lambda: type(g).__name__)
# Nested
data = [(1, 'a'), (1, 'a'), (1, 'b'), (2, 'b'), (2, 'b'), (2, 'c')]
t(lambda: [(k, [(k2, len(list(g2))) for k2, g2 in groupby(g, lambda p: p[1])]) for k, g in groupby(data, lambda p: p[0])])

print('--- groupby errors')
t(lambda: groupby())
t(lambda: groupby(1))
t(lambda: groupby('a', None, 1))
t(lambda: groupby('a', x=1))
t(lambda: groupby('a', iterable='b'))
t(lambda: groupby(key=None))
t(lambda: list(groupby('a', 1)))
t(lambda: drain(groupby(raiser(0)), 3))
t(lambda: [x if isinstance(x, str) else x[0] for x in drain(groupby(raiser(2)), 5)])
t(lambda: [x if isinstance(x, str) else x[0] for x in drain(groupby([1, 2, 0, 3], lambda x: 1 // x), 6)])


class BadEq:
    def __init__(self, n):
        self.n = n

    def __eq__(self, other):
        if self.n == 2 or other.n == 2:
            raise RuntimeError('bad eq')
        return self.n == other.n

    def __repr__(self):
        return 'BadEq(%d)' % self.n


t(lambda: [x if isinstance(x, str) else x[0] for x in drain(groupby([BadEq(1), BadEq(1), BadEq(2), BadEq(3)]), 5)])


def group_error():
    gb = groupby([BadEq(1), BadEq(1), BadEq(2), BadEq(3)])
    k, g = next(gb)
    return drain(g, 5)


t(group_error)


def group_source_error():
    gb = groupby(chain([0, 0], raiser(0)))
    k, g = next(gb)
    return drain(g, 5)


t(group_source_error)

print('--- _grouper')
t(lambda: itertools._grouper())
t(lambda: itertools._grouper(1, 2))
t(lambda: itertools._grouper(None, 2))
t(lambda: itertools._grouper(groupby('a')))
t(lambda: itertools._grouper(groupby('a'), 1, 2))
t(lambda: itertools._grouper(parent=groupby('a'), tgtkey=1))
gb = groupby('aab')
t(lambda: list(itertools._grouper(gb, 'a')))
t(lambda: list(itertools._grouper(gb, 'a')))
t(lambda: list(itertools._grouper(gb, 'b')))
gb = groupby('aab')
t(lambda: list(itertools._grouper(gb, 'x')))
t(lambda: [(k, list(g)) for k, g in gb])

print('--- tee')
t(lambda: tee('abc', 0))
t(lambda: len(tee('abc')))
t(lambda: len(tee('abc', 1)))
t(lambda: len(tee('abc', 5)))
t(lambda: [list(x) for x in tee('abc')])
t(lambda: [list(x) for x in tee('abc', 3)])
t(lambda: [list(x) for x in tee('', 3)])
t(lambda: [list(x) for x in tee(iter(range(4)), True)])
a, b = tee(range(5))
t(lambda: (next(a), next(a), next(b), list(a), list(b)))
a, b = tee(range(200))
t(lambda: (list(a) == list(range(200)), list(b) == list(range(200))))
a, b = tee(range(200))
out = []
for i in range(100):
    out.append(next(a))
    out.append(next(a))
    out.append(next(b))
t(lambda: (out[:9], out[-3:], next(a, 'end'), next(b), len(list(b))))
a, b, c = tee(count(), 3)
t(lambda: (list(islice(a, 60)) == list(range(60)), next(b), list(islice(c, 58, 61)), next(a), next(b)))
t(lambda: type(tee('a')[0]) is itertools._tee)
t(lambda: type(tee('a')[0]).__name__)
a, b = tee('ab')
t(lambda: iter(a) is a)
t(lambda: a is not b)

print('--- tee of a tee')
a, b = tee('abcdef')
next(a)
c, d = tee(a)
t(lambda: (c is not a, d is not a))
t(lambda: (next(c), next(a), list(d), list(b), list(c), list(a)))
a, = tee('abc', 1)
b, = tee(a, 1)
t(lambda: (next(a), next(b), a is b))

print('--- copies')
a, b = tee('abcdef')
next(a)
c = a.__copy__()
t(lambda: (type(c) is type(a), c is not a))
t(lambda: (next(c), next(c), next(a), list(c), list(a), list(b)))
t(lambda: a.__copy__(1))

print('--- _tee')
t(lambda: list(itertools._tee('abc')))
t(lambda: list(itertools._tee(iter('abc'))))
x = itertools._tee('abc')
next(x)
y = itertools._tee(x)
t(lambda: (y is not x, list(y), list(x)))
t(lambda: itertools._tee())
t(lambda: itertools._tee(1))
t(lambda: itertools._tee('a', 'b'))
t(lambda: itertools._tee(iterable='a'))

print('--- tee errors')
t(lambda: tee())
t(lambda: tee(1))
t(lambda: tee(1, 0))
t(lambda: tee('a', -1))
t(lambda: tee('a', 'b'))
t(lambda: tee('a', 1.0))
t(lambda: tee('a', None))
t(lambda: tee('a', 2 ** 70))
t(lambda: tee('a', 1, 2))
t(lambda: tee('a', n=1))
t(lambda: tee(iterable='a'))
a, b = tee(raiser(2))
t(lambda: (drain(a, 5), drain(b, 5)))


def reenter():
    def gen():
        yield 1
        yield next(b)
        yield 3

    a, b = tee(gen())
    return drain(a, 4), drain(b, 4)


t(reenter)

print('--- _tee_dataobject')
D = itertools._tee_dataobject
t(lambda: type(D(iter('a'), [], None)).__name__)
t(lambda: D())
t(lambda: D(1, 2, 3))
t(lambda: D(1, (), None))
t(lambda: D(1, None, None))
t(lambda: D(1, [], 3))
t(lambda: D(1, [0] * 58, None))
t(lambda: D(1, [0] * 57, 3))
t(lambda: type(D(1, [0] * 57, None)).__name__)
t(lambda: type(D(1, [0] * 57, D(1, [], None))).__name__)
t(lambda: D(1, [0] * 56, D(1, [], None)))
t(lambda: D(it=1, values=[], next=None))
t(lambda: hasattr(D(1, [], None), '__iter__'))
