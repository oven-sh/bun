# concat, iconcat, contains, countOf, indexOf, length_hint, call, _compare_digest
import _operator as op
import sys


def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)


class Seq:
    "A sequence written in Python."

    def __init__(self, *items):
        self.items = list(items)

    def __getitem__(self, i):
        return self.items[i]

    def __len__(self):
        return len(self.items)

    def __repr__(self):
        return 'Seq%r' % (tuple(self.items),)


class Adds(Seq):
    def __add__(self, other):
        return Adds(*self.items, *other)


class IAdds(Adds):
    def __iadd__(self, other):
        self.items.extend(other)
        return self


class Declines(Seq):
    def __add__(self, other):
        return NotImplemented

    def __iadd__(self, other):
        return NotImplemented


class RAdds(Seq):
    def __radd__(self, other):
        return 'radd', other


class NotSeq:
    def __add__(self, other):
        return 'not a sequence'

    __iadd__ = __add__


print('--- concat')
t(lambda: op.concat([1], [2]))
t(lambda: op.concat((1,), (2,)))
t(lambda: op.concat('a', 'b'))
t(lambda: op.concat(b'a', b'b'))
t(lambda: op.concat(bytearray(b'a'), b'b'))
t(lambda: op.concat(b'a', bytearray(b'b')))
t(lambda: op.concat([], []))
t(lambda: op.concat([1], (2,)))
t(lambda: op.concat((1,), [2]))
t(lambda: op.concat('a', b'b'))
t(lambda: op.concat('a', 1))
t(lambda: op.concat([1], None))
t(lambda: op.concat(1, 2))
t(lambda: op.concat(1.5, 2.5))
t(lambda: op.concat(None, None))
t(lambda: op.concat({}, {}))
t(lambda: op.concat({1}, {2}))
t(lambda: op.concat(range(2), range(2)))
t(lambda: op.concat(1, [2]))
t(lambda: op.concat(Adds(1), Adds(2)))
t(lambda: op.concat(Adds(1), [2]))
t(lambda: op.concat(Adds(1), 'ab'))
t(lambda: op.concat(Adds(1), 2))
t(lambda: op.concat(Adds(1), {2: 3}))
t(lambda: op.concat(Adds(1), {2}))
t(lambda: op.concat(Seq(1), Seq(2)))
t(lambda: op.concat(Declines(1), Declines(2)))
t(lambda: op.concat(Declines(1), RAdds(2)))
t(lambda: op.concat(Seq(1), RAdds(2)))
t(lambda: op.concat([1], RAdds(2)))
t(lambda: op.concat(NotSeq(), NotSeq()))
t(lambda: op.concat(NotSeq(), [1]))


class MyList(list):
    pass


class MyListAdd(list):
    def __add__(self, other):
        return 'my add'

    def __iadd__(self, other):
        return 'my iadd'


t(lambda: (op.concat(MyList([1]), [2]), type(op.concat(MyList([1]), [2])).__name__))
t(lambda: op.concat([1], MyList([2])))
t(lambda: op.concat(MyListAdd([1]), [2]))

print('--- iconcat')
l = [1]
t(lambda: (op.iconcat(l, [2]) is l, l))
t(lambda: (op.iconcat(l, (3,)) is l, l))
t(lambda: (op.iconcat(l, 'ab') is l, l))
t(lambda: (op.iconcat(l, iter([9])) is l, l))
t(lambda: op.iconcat(l, 1))
t(lambda: op.iconcat((1,), (2,)))
t(lambda: op.iconcat((1,), [2]))
t(lambda: op.iconcat('a', 'b'))
t(lambda: op.iconcat('a', 1))
t(lambda: op.iconcat(b'a', b'b'))
t(lambda: op.iconcat(1, 2))
t(lambda: op.iconcat(None, []))
t(lambda: op.iconcat({}, {}))
t(lambda: op.iconcat({1}, {2}))
a = IAdds(1)
t(lambda: (op.iconcat(a, [2]) is a, a))
t(lambda: op.iconcat(a, 2))
b = Adds(1)
t(lambda: (op.iconcat(b, [2]), b))
t(lambda: op.iconcat(Seq(1), Seq(2)))
t(lambda: op.iconcat(Declines(1), Declines(2)))
t(lambda: op.iconcat(Declines(1), RAdds(2)))
t(lambda: op.iconcat(NotSeq(), NotSeq()))
m = MyList([1])
t(lambda: (op.iconcat(m, [2]) is m, m))

print('--- contains')
t(lambda: (op.contains([1, 2], 1), op.contains([1, 2], 3)))
t(lambda: (op.contains('abc', 'bc'), op.contains('abc', 'x')))
t(lambda: (op.contains({1: 2}, 1), op.contains({1: 2}, 2)))
t(lambda: (op.contains({1}, 1), op.contains(range(5), 3), op.contains((1,), 1.0)))
t(lambda: op.contains(iter([1, 2, 3]), 2))
t(lambda: op.contains(Seq(1, 2), 2))
t(lambda: op.contains('abc', 1))
t(lambda: op.contains(1, 1))
t(lambda: op.contains(None, 1))
t(lambda: op.contains({}, []))


class Has:
    def __contains__(self, x):
        return x


t(lambda: (op.contains(Has(), 1), op.contains(Has(), 0), op.contains(Has(), 'a'), op.contains(Has(), [])))

print('--- countOf, indexOf')
t(lambda: op.countOf([1, 2, 1, 3, 1], 1))
t(lambda: op.countOf([1, 2, 1, 3, 1], 5))
t(lambda: op.countOf([], 5))
t(lambda: op.countOf('banana', 'a'))
t(lambda: op.countOf('banana', 'an'))
t(lambda: op.countOf((1, 1.0, True, 1j), 1))
t(lambda: op.countOf({1: 'a', 2: 'b'}, 1))
t(lambda: op.countOf({1: 'a', 2: 'b'}.values(), 'a'))
t(lambda: op.countOf(iter([1, 1]), 1))
t(lambda: op.countOf(Seq(1, 2, 1), 1))
t(lambda: op.countOf(range(10), 3))
t(lambda: op.countOf((x % 3 for x in range(10)), 0))
t(lambda: op.countOf(1, 1))
t(lambda: op.countOf(None, 1))
t(lambda: op.indexOf([1, 2, 3], 2))
t(lambda: op.indexOf([1, 2, 3, 2], 2))
t(lambda: op.indexOf([1, 2, 3], 5))
t(lambda: op.indexOf([], 5))
t(lambda: op.indexOf('banana', 'n'))
t(lambda: op.indexOf('banana', 'na'))
t(lambda: op.indexOf((0, 1.0), 1))
t(lambda: op.indexOf({5: 1, 6: 2}, 6))
t(lambda: op.indexOf(Seq(1, 2, 1), 2))
t(lambda: op.indexOf(1, 1))
it = iter([1, 2, 3, 4])
t(lambda: (op.indexOf(it, 2), list(it)))
nan = float('nan')
t(lambda: (op.countOf([nan], nan), op.indexOf([nan], nan)))


class BadEq:
    def __eq__(self, other):
        raise ZeroDivisionError('bad eq')


class BadIter:
    def __iter__(self):
        raise ValueError('bad iter')


class BadIterType:
    def __iter__(self):
        raise TypeError('mine')


def raiser():
    yield 1
    raise KeyError('mid')


t(lambda: op.countOf([1, BadEq()], 2))
t(lambda: op.indexOf([1, BadEq()], 2))
t(lambda: op.indexOf([1, BadEq()], 1))
t(lambda: op.countOf(BadIter(), 2))
t(lambda: op.countOf(BadIterType(), 2))
t(lambda: op.indexOf(BadIterType(), 2))
t(lambda: op.countOf(raiser(), 2))
t(lambda: op.indexOf(raiser(), 2))
t(lambda: op.indexOf(raiser(), 1))


class EqOrder:
    "Says which operand is on the left."

    def __init__(self, name):
        self.name = name

    def __eq__(self, other):
        print('  eq', self.name, getattr(other, 'name', other))
        return False


t(lambda: op.countOf([EqOrder('item')], EqOrder('value')))

print('--- length_hint')


class Hint:
    def __init__(self, v):
        self.v = v

    def __length_hint__(self):
        if isinstance(self.v, BaseException):
            raise self.v
        return self.v


class LenRaises:
    def __init__(self, e):
        self.e = e

    def __len__(self):
        raise self.e

    def __length_hint__(self):
        return 11


t(lambda: op.length_hint([1, 2, 3]))
t(lambda: op.length_hint('abc', 10))
t(lambda: op.length_hint(iter([1, 2, 3])))
t(lambda: op.length_hint(iter('abc')))
t(lambda: op.length_hint(iter(range(5))))
t(lambda: op.length_hint(iter((1, 2))))
t(lambda: op.length_hint(reversed([1, 2])))
t(lambda: op.length_hint(iter({1: 2})))
t(lambda: op.length_hint((x for x in 'abc')))
t(lambda: op.length_hint((x for x in 'abc'), 7))
t(lambda: op.length_hint(1))
t(lambda: op.length_hint(1, 7))
t(lambda: op.length_hint(None, 7))
t(lambda: op.length_hint(1, -7))
t(lambda: op.length_hint(1, True))
t(lambda: op.length_hint(1, sys.maxsize))
t(lambda: op.length_hint(Hint(4)))
t(lambda: op.length_hint(Hint(4), 7))
t(lambda: op.length_hint(Hint(0), 7))
t(lambda: op.length_hint(Hint(True), 7))
t(lambda: op.length_hint(Hint(NotImplemented), 7))
t(lambda: op.length_hint(Hint(NotImplemented)))
t(lambda: op.length_hint(Hint(-1), 7))
t(lambda: op.length_hint(Hint('a'), 7))
t(lambda: op.length_hint(Hint(1.0), 7))
t(lambda: op.length_hint(Hint(None), 7))
t(lambda: op.length_hint(Hint(2 ** 70), 7))
t(lambda: op.length_hint(Hint(TypeError('t')), 7))
t(lambda: op.length_hint(Hint(ValueError('v')), 7))
t(lambda: op.length_hint(LenRaises(TypeError('t')), 7))
t(lambda: op.length_hint(LenRaises(ValueError('v')), 7))
t(lambda: op.length_hint())
t(lambda: op.length_hint(1, 2, 3))
t(lambda: op.length_hint(1, 'a'))
t(lambda: op.length_hint(1, 1.5))
t(lambda: op.length_hint(1, None))
t(lambda: op.length_hint(1, 2 ** 70))
t(lambda: op.length_hint(obj=1))
t(lambda: op.length_hint(1, default=2))
it = iter([1, 2, 3])
next(it)
t(lambda: op.length_hint(it))
list(it)
t(lambda: op.length_hint(it))

print('--- call')
t(lambda: op.call(int))
t(lambda: op.call(int, '12'))
t(lambda: op.call(int, '12', 8))
t(lambda: op.call(int, '12', base=16))
t(lambda: op.call(lambda *a, **k: (a, k), 1, 2, x=3, obj=4))
t(lambda: op.call(dict, a=1))
t(lambda: op.call(op.call, op.call, len, 'abc'))
t(lambda: op.call('abc'.upper))
t(lambda: op.call())
t(lambda: op.call(1))
t(lambda: op.call(None, 1))
t(lambda: op.call(obj=int))
t(lambda: op.call(lambda: 1, 2))
t(lambda: op.call(lambda: 1 / 0))
t(lambda: op.call(*[max, 1, 2, 3]))

print('--- _compare_digest')
cd = op._compare_digest
t(lambda: cd(b'', b''))
t(lambda: cd(b'abc', b'abc'))
t(lambda: cd(b'abc', b'abd'))
t(lambda: cd(b'abc', b'ab'))
t(lambda: cd(b'ab', b'abc'))
t(lambda: cd(b'', b'a'))
t(lambda: cd(b'a', b''))
t(lambda: cd(bytearray(b'abc'), b'abc'))
t(lambda: cd(b'abc', bytearray(b'abc')))
t(lambda: cd(bytearray(b'abc'), bytearray(b'abd')))
t(lambda: cd(bytes(range(256)), bytes(range(256))))
t(lambda: cd(b'\x00' * 100, b'\x00' * 99 + b'\x01'))
t(lambda: cd('', ''))
t(lambda: cd('abc', 'abc'))
t(lambda: cd('abc', 'abd'))
t(lambda: cd('abc', 'ab'))
t(lambda: cd('a' * 1000, 'a' * 1000))
t(lambda: cd('a' + 'b', 'ab'))
t(lambda: cd('\x7f', '\x7f'))
t(lambda: cd('\x80', '\x80'))
t(lambda: cd('a', '\xe9'))
t(lambda: cd('€', 'a'))
t(lambda: cd('\U0001f600', '\U0001f600'))
t(lambda: cd('abc', b'abc'))
t(lambda: cd(b'abc', 'abc'))
t(lambda: cd(1, 1))
t(lambda: cd(None, None))
t(lambda: cd([], ()))
t(lambda: cd('a', 1))
t(lambda: cd(1, 'a'))
t(lambda: cd(b'a', 1))
t(lambda: cd(1, b'a'))
t(lambda: cd(b'a', None))
t(lambda: cd())
t(lambda: cd(b'a'))
t(lambda: cd(b'a', b'a', b'a'))
t(lambda: cd(a=b'a', b=b'a'))


class MyStr(str):
    def __eq__(self, other):
        return False


class MyBytes(bytes):
    def __eq__(self, other):
        return False


t(lambda: cd(MyStr('abc'), 'abc'))
t(lambda: cd('abc', MyStr('abc')))
t(lambda: cd(MyStr('abc'), MyStr('abd')))
t(lambda: cd(MyBytes(b'abc'), b'abc'))
t(lambda: cd(MyBytes(b'abc'), MyBytes(b'abd')))
