# The functions of _operator
import _operator as op


def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)


print(sorted(n for n in dir(op) if not n.startswith('__')))
print(op.__name__, op.__doc__.splitlines()[0])

binary = ['add', 'sub', 'mul', 'matmul', 'truediv', 'floordiv', 'mod', 'pow', 'lshift', 'rshift', 'and_', 'or_', 'xor',
          'iadd', 'isub', 'imul', 'imatmul', 'itruediv', 'ifloordiv', 'imod', 'ipow', 'ilshift', 'irshift', 'iand', 'ior', 'ixor',
          'lt', 'le', 'eq', 'ne', 'gt', 'ge', 'is_', 'is_not', 'concat', 'iconcat', 'contains', 'countOf', 'indexOf', 'getitem', 'delitem',
          '_compare_digest']
unary = ['neg', 'pos', 'abs', 'inv', 'invert', 'not_', 'truth', 'index', 'is_none', 'is_not_none']

print('--- every function on a few operands')
pairs = [(7, 2), (7.5, 2), (-7, 2), (2, -1), (7, 0), (1j, 2), (True, 3), ('ab', 2), ('ab', 'b'), ([1, 2], [2]), ([1, 2], 1), ((1, 2), (2,)), ({1, 2}, {2, 3}),
         ({1: 2}, 1), (b'ab', b'b'), (None, None), (2 ** 70, 3), (3, 2 ** 70), ('a', None), (1.5, 'x')]
for name in binary:
    f = getattr(op, name)
    print('-', name)
    for a, b in pairs:
        if isinstance(a, (list, dict, set)):
            a = a.copy()
        if b == 2 ** 70 and name in ('pow', 'ipow', 'lshift', 'ilshift'):
            continue
        if (name == 'imul' and b == [2]) or (name == 'delitem' and a == 'ab' and b == 2):
            continue  # See operator_inplace_and_items.py.
        t(lambda: f(a, b))
for name in unary:
    f = getattr(op, name)
    print('-', name)
    for a in (5, -5, 0, 2.5, -0.0, 1j, True, 'a', '', [], [0], None, 2 ** 70, -2 ** 70, b'', {1}):
        t(lambda: f(a))

print('--- how many arguments')
for name in binary:
    f = getattr(op, name)
    t(lambda: f())
    t(lambda: f(1))
    t(lambda: f(1, 2, 3))
    t(lambda: f(a=1, b=2))
for name in unary:
    f = getattr(op, name)
    t(lambda: f())
    t(lambda: f(1, 2))
    t(lambda: f(a=1))
t(lambda: op.setitem())
t(lambda: op.setitem(1, 2))
t(lambda: op.setitem(1, 2, 3, 4))
t(lambda: op.setitem(a=1, b=2, c=3))

print('--- the functions themselves')
for name in ('add', 'is_', 'length_hint', 'call', '_compare_digest', 'countOf'):
    f = getattr(op, name)
    print(f.__name__, f.__qualname__, f.__module__, type(f).__name__, repr(f), f.__self__ is op)
print(op.inv is op.invert, op.inv.__name__, op.invert.__name__)

print('--- classes with the special methods')


class V:
    def __init__(self, name):
        self.name = name

    def __repr__(self):
        return 'V(%s)' % self.name


def install(cls, names):
    for n in names:
        def method(self, *others, _n=n):
            return (_n, self) + others
        setattr(cls, n, method)


install(V, ['__add__', '__sub__', '__mul__', '__matmul__', '__truediv__', '__floordiv__', '__mod__', '__pow__', '__lshift__', '__rshift__', '__and__',
            '__or__', '__xor__', '__neg__', '__pos__', '__abs__', '__invert__', '__lt__', '__le__', '__eq__', '__ne__', '__gt__', '__ge__',
            '__getitem__', '__radd__', '__rsub__', '__rmul__', '__rmatmul__', '__rtruediv__', '__rfloordiv__', '__rmod__', '__rpow__',
            '__rlshift__', '__rrshift__', '__rand__', '__ror__', '__rxor__'])
v, w = V('v'), V('w')
for name in ['add', 'sub', 'mul', 'matmul', 'truediv', 'floordiv', 'mod', 'pow', 'lshift', 'rshift', 'and_', 'or_', 'xor',
             'iadd', 'isub', 'imul', 'imatmul', 'itruediv', 'ifloordiv', 'imod', 'ipow', 'ilshift', 'irshift', 'iand', 'ior', 'ixor',
             'lt', 'le', 'eq', 'ne', 'gt', 'ge', 'getitem']:
    f = getattr(op, name)
    print(name, f(v, w), f(v, 1), f(1, v) if name != 'getitem' else '')
for name in ['neg', 'pos', 'abs', 'inv', 'invert']:
    print(name, getattr(op, name)(v))


class I(V):
    pass


install(I, ['__iadd__', '__isub__', '__imul__', '__imatmul__', '__itruediv__', '__ifloordiv__', '__imod__', '__ipow__', '__ilshift__', '__irshift__',
            '__iand__', '__ior__', '__ixor__'])
i = I('i')
for name in ['iadd', 'isub', 'imul', 'imatmul', 'itruediv', 'ifloordiv', 'imod', 'ipow', 'ilshift', 'irshift', 'iand', 'ior', 'ixor',
             'add', 'sub']:
    print(name, getattr(op, name)(i, 1))

print('--- in place')
l = [1]
t(lambda: (op.iadd(l, [2]) is l, l))
t(lambda: (op.iadd(l, 'ab') is l, l))
t(lambda: (op.imul(l, 2) is l, l))
t(lambda: (op.iconcat(l, (9,)) is l, l))
s = {1}
t(lambda: (op.ior(s, {2}) is s, s))
t(lambda: (op.iand(s, {2}) is s, s))
t(lambda: (op.ixor(s, {3}) is s, sorted(s)))
t(lambda: (op.isub(s, {3}) is s, s))
d = {1: 1}
t(lambda: (op.ior(d, {2: 2}) is d, d))
tup = (1,)
t(lambda: (op.iadd(tup, (2,)), tup))
b = bytearray(b'a')
t(lambda: (op.iadd(b, b'b') is b, b))
t(lambda: (op.iconcat(b, b'c') is b, b))
t(lambda: (op.imul(b, 2) is b, b))

print('--- items')
l = [1, 2, 3, 4]
t(lambda: op.getitem(l, 1))
t(lambda: op.getitem(l, -1))
t(lambda: op.getitem(l, slice(1, 3)))
t(lambda: op.getitem(l, 10))
t(lambda: op.getitem(l, 'a'))
t(lambda: (op.setitem(l, 0, 'x'), l))
t(lambda: (op.setitem(l, slice(1, 3), 'yz'), l))
t(lambda: op.setitem(l, 10, 1))
t(lambda: (op.delitem(l, 0), l))
t(lambda: (op.delitem(l, slice(0, 2)), l))
t(lambda: op.delitem(l, 10))
d = {}
t(lambda: (op.setitem(d, 'k', 1), d, op.getitem(d, 'k'), op.delitem(d, 'k'), d))
t(lambda: op.getitem(d, 'k'))
t(lambda: op.delitem(d, 'k'))
t(lambda: op.setitem((1,), 0, 1))
t(lambda: op.getitem(list, int))

print('--- identity and truth')
x = []
t(lambda: (op.is_(x, x), op.is_(x, []), op.is_not(x, x), op.is_not(x, [])))
t(lambda: (op.is_(None, None), op.is_(1, 1.0), op.is_(True, 1), op.is_('a', 'a')))
t(lambda: [op.is_none(v) for v in (None, 0, '', [], False)])
t(lambda: [op.is_not_none(v) for v in (None, 0, '', [], False)])


class Truth:
    def __init__(self, v):
        self.v = v

    def __bool__(self):
        if isinstance(self.v, BaseException):
            raise self.v
        return self.v


class Len:
    def __len__(self):
        return 0


t(lambda: (op.truth(Truth(True)), op.truth(Truth(False)), op.not_(Truth(True)), op.not_(Truth(False))))
t(lambda: op.truth(Truth(1)))
t(lambda: op.not_(Truth(1)))
t(lambda: op.truth(Truth(ValueError('no truth'))))
t(lambda: op.not_(Truth(ValueError('no truth'))))
t(lambda: (op.truth(Len()), op.not_(Len())))

print('--- index')


class Ix:
    def __init__(self, v):
        self.v = v

    def __index__(self):
        return self.v


class MyInt(int):
    pass


t(lambda: op.index(Ix(5)))
t(lambda: op.index(Ix(2 ** 80)))
t(lambda: op.index(Ix('a')))
t(lambda: op.index(Ix(1.0)))
t(lambda: (op.index(MyInt(3)), type(op.index(MyInt(3))).__name__))
t(lambda: (op.index(True), type(op.index(True)).__name__))
t(lambda: op.index('1'))
t(lambda: op.index(None))

print('--- comparisons')
t(lambda: [f(1, 2) for f in (op.lt, op.le, op.eq, op.ne, op.gt, op.ge)])
t(lambda: [f('b', 'a') for f in (op.lt, op.le, op.eq, op.ne, op.gt, op.ge)])
t(lambda: [f([1], [1]) for f in (op.lt, op.le, op.eq, op.ne, op.gt, op.ge)])
t(lambda: [f(1, 1.0) for f in (op.lt, op.le, op.eq, op.ne, op.gt, op.ge)])
t(lambda: [f({1}, {1, 2}) for f in (op.lt, op.le, op.eq, op.ne, op.gt, op.ge)])
t(lambda: op.lt(1j, 2j))
t(lambda: op.ge(None, None))
t(lambda: op.eq(None, None))
t(lambda: op.lt([1], (1,)))
nan = float('nan')
t(lambda: [f(nan, nan) for f in (op.lt, op.le, op.eq, op.ne, op.gt, op.ge)])
