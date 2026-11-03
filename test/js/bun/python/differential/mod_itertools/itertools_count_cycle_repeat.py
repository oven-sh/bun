# count, cycle, repeat
from itertools import count, cycle, repeat, islice
import sys


def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)


def take(n, it):
    return list(islice(it, n))


class Num:
    def __init__(self, v):
        self.v = v

    def __add__(self, other):
        return Num(self.v + (other.v if isinstance(other, Num) else other))

    __radd__ = __add__

    def __index__(self):
        return self.v

    def __repr__(self):
        return 'Num(%r)' % self.v


class OnlyFloat:
    def __float__(self):
        return 1.5

    def __add__(self, other):
        return 'added %r' % (other,)


class MyInt(int):
    def __repr__(self):
        return 'MyInt(%d)' % int(self)


print('--- count')
t(lambda: take(5, count()))
t(lambda: take(5, count(3)))
t(lambda: take(5, count(3, 2)))
t(lambda: take(5, count(step=3)))
t(lambda: take(5, count(start=-2)))
t(lambda: take(5, count(10, -3)))
t(lambda: take(4, count(1.5)))
t(lambda: take(4, count(1, 0.25)))
t(lambda: take(4, count(0.5, 0.5)))
t(lambda: take(3, count(1j, 1)))
t(lambda: take(3, count(2, 0)))
t(lambda: take(3, count(True)))
t(lambda: take(3, count(False, True)))
t(lambda: take(3, count(True, 2)))
t(lambda: take(3, count(MyInt(5))))
t(lambda: take(3, count(MyInt(5), 2)))
t(lambda: take(3, count(1, MyInt(1))))
t(lambda: take(3, count(1, MyInt(2))))
t(lambda: take(3, count(Num(1))))
t(lambda: take(3, count(Num(1), Num(2))))
t(lambda: take(3, count(0, Num(2))))
t(lambda: take(2, count(OnlyFloat())))
t(lambda: take(3, count(sys.maxsize - 1)))
t(lambda: take(3, count(sys.maxsize)))
t(lambda: take(3, count(sys.maxsize + 1)))
t(lambda: take(3, count(-sys.maxsize - 2)))
t(lambda: take(3, count(-sys.maxsize - 1)))
t(lambda: take(3, count(sys.maxsize - 1, 2)))
t(lambda: take(3, count(2 ** 100, 2 ** 100)))
t(lambda: take(3, count(2 ** 53 - 1)))
t(lambda: take(3, count(0, sys.maxsize)))
t(lambda: [type(x).__name__ for x in take(3, count(True))])
t(lambda: [type(x).__name__ for x in take(3, count(MyInt(1)))])
t(lambda: [type(x).__name__ for x in take(3, count(MyInt(1), 2))])
t(lambda: [type(x).__name__ for x in take(3, count(1.0))])
t(lambda: [type(x).__name__ for x in take(3, count(1, 1.0))])

print('--- count repr')
for c in (count(), count(3), count(3, 1), count(3, 2), count(1.5), count(1, 1.0), count(1.0, 1), count(True), count(1, True),
          count(MyInt(4)), count(MyInt(4), 3), count(1, MyInt(1)), count(Num(1)), count(Num(1), Num(1)), count(-5), count(0, -1),
          count(sys.maxsize), count(sys.maxsize + 1), count(2 ** 70, 2), count(1j)):
    print(repr(c))
c = count(5)
next(c); next(c)
print(repr(c), str(c))
c = count(sys.maxsize - 1)
for i in range(4):
    print(repr(c), next(c))
c = count(1.5, 2)
next(c)
print(repr(c))

print('--- count errors')
t(lambda: count('a'))
t(lambda: count(1, 'a'))
t(lambda: count(None))
t(lambda: count(1, None))
t(lambda: count([]))
t(lambda: count(1, 2, 3))
t(lambda: count(1, start=2))
t(lambda: count(x=1))
t(lambda: count(stop=1))


class BadAdd:
    def __index__(self):
        return 1

    def __add__(self, other):
        raise ZeroDivisionError('bad add')


def bad():
    c = count(BadAdd())
    try:
        next(c)
    except ZeroDivisionError as e:
        print('caught', e)
    return type(next(c)).__name__


t(bad)

print('--- cycle')
t(lambda: take(7, cycle('abc')))
t(lambda: take(3, cycle('')))
t(lambda: take(5, cycle([1])))
t(lambda: take(10, cycle(iter(range(3)))))
t(lambda: take(5, cycle(x for x in (1, 2))))
t(lambda: next(cycle([])))
t(lambda: cycle())
t(lambda: cycle(1))
t(lambda: cycle([], []))
t(lambda: cycle(iterable=[]))


def gen_then_raise():
    yield 1
    yield 2
    raise ValueError('boom')


def cyc():
    c = cycle(gen_then_raise())
    out = []
    for i in range(6):
        try:
            out.append(next(c))
        except ValueError as e:
            out.append(str(e))
    return out


t(cyc)


def cyc_mutation():
    # What is saved does not depend on the list afterwards.
    l = [1, 2, 3]
    c = cycle(l)
    out = take(3, c)
    l.append(4)
    out += take(5, c)
    return out


t(cyc_mutation)

print('--- repeat')
t(lambda: list(repeat('a', 3)))
t(lambda: list(repeat('a', 0)))
t(lambda: list(repeat('a', -1)))
t(lambda: list(repeat('a', times=2)))
t(lambda: list(repeat(object='a', times=2)))
t(lambda: list(repeat(times=2, object=None)))
t(lambda: take(3, repeat(None)))
t(lambda: list(repeat('a', True)))
t(lambda: list(repeat('a', Num(2))))
for r in (repeat(1), repeat(1, 3), repeat('a', 0), repeat('a', -5), repeat([1, 2], 2), repeat(None), repeat(1, times=10 ** 12)):
    print(repr(r))
r = repeat('x', 3)
for i in range(5):
    print(repr(r), r.__length_hint__(), next(r, 'done'))
t(lambda: repeat(1).__length_hint__())
t(lambda: repeat(1, sys.maxsize).__length_hint__())
t(lambda: repeat())
t(lambda: repeat(1, 2, 3))
t(lambda: repeat(1, 'a'))
t(lambda: repeat(1, None))
t(lambda: repeat(1, 1.0))
t(lambda: repeat(1, 2 ** 70))
t(lambda: repeat(1, -2 ** 70))
t(lambda: repeat(times=1))
t(lambda: repeat(1, x=1))
t(lambda: repeat(1, object=2))
t(lambda: list(zip(range(3), repeat('z'))))
t(lambda: list(map(pow, range(5), repeat(2))))
l = []
r = repeat(l, 2)
l.append(r)
t(lambda: len(repr(r)) > 0)
