# + and * on classes derived from list, tuple, str, bytes, bytearray, deque that have some of __add__, __radd__, __mul__, __rmul__, __iadd__,
# __imul__ of their own. list.__add__ is asked after the methods of numbers of both operands. But a class with one of the two methods
# of an operator takes part as a number, and then the other of the two is the one it inherits.
import collections
def show(tag, f):
    try: print(tag, '=', f())
    except Exception as e: print(tag, '!', type(e).__name__, e)

class R:
    def __repr__(self): return 'R()'
    def __radd__(self, o): return 'R.__radd__'
    def __rmul__(self, o): return 'R.__rmul__'
class T0(tuple): pass
class T1(tuple):
    def __radd__(self, o): return 'T1.__radd__'
    def __rmul__(self, o): return 'T1.__rmul__'
class T2(tuple):
    def __add__(self, o): return NotImplemented
    def __mul__(self, o): return NotImplemented
class T4(tuple):
    def __iadd__(self, o): return NotImplemented
    def __imul__(self, o): return NotImplemented
class T5(tuple):
    def __add__(self, o): return ('T5.__add__', o)
    def __mul__(self, o): return ('T5.__mul__', o)
class T6(T5): pass
class T7(tuple):
    def __radd__(self, o): return NotImplemented
    def __rmul__(self, o): return NotImplemented
class L0(list): pass
class L1(list):
    def __rmul__(self, o): return 'L1.__rmul__'
    def __radd__(self, o): return 'L1.__radd__'
class L2(list):
    def __add__(self, o): return NotImplemented
    def __mul__(self, o): return NotImplemented
class L7(list):
    def __radd__(self, o): return NotImplemented
    def __rmul__(self, o): return NotImplemented
class S1(str):
    def __rmul__(self, o): return 'S1.__rmul__'
    def __radd__(self, o): return 'S1.__radd__'
    def __rmod__(self, o): return 'S1.__rmod__'
class S2(str):
    def __add__(self, o): return NotImplemented
    def __mul__(self, o): return NotImplemented
class S7(str):
    def __rmul__(self, o): return NotImplemented
class B7(bytearray):
    def __rmul__(self, o): return NotImplemented
class Q7(collections.deque):
    def __rmul__(self, o): return NotImplemented
class B2(bytes):
    def __add__(self, o): return NotImplemented
    def __mul__(self, o): return NotImplemented
left = [('tuple', ()), ('T0', T0()), ('T1', T1()), ('T2', T2((1,))), ('T4', T4()), ('T5', T5((1,))), ('T6', T6((1,))), ('list', []), ('L0', L0()), ('L1', L1()), ('L2', L2([1])),
    ('str', ''), ('S1', S1()), ('S2', S2('ab')), ('B2', B2(b'ab')), ('T7', T7((1,))), ('L7', L7([1])), ('S7', S7('ab')), ('B7', B7(b'ab')), ('Q7', Q7([1]))]
right = [('R', R()), ('T0', T0()), ('T1', T1()), ('T5', T5()), ('L1', L1()), ('S1', S1()), ('int', 2), ('bool', True), ('float', 1.5), ('None', None), ('tuple', (1,)), ('list', [1]), ('str', 'x'), ('bytes', b'x')]
for _ in range(2):
    for name, a in left:
        for other, b in right:
            show('%s + %s' % (name, other), lambda: a + b)
            show('%s * %s' % (name, other), lambda: a * b)
            show('%s * %s' % (other, name), lambda: b * a)
            show('%s + %s' % (other, name), lambda: b + a)

# In place. A class derived from list finds list.__iadd__ before an __add__ of its own, but not list.__imul__ before its __mul__.
class ML(list):
    def __add__(self, other): return ('ML.__add__', list(self), other)
class ML2(list):
    def __mul__(self, other): return ('ML2.__mul__', list(self), other)
class MB(bytearray):
    def __add__(self, other): return ('MB.__add__', bytes(self), other)
class MB2(bytearray):
    def __mul__(self, other): return ('MB2.__mul__', bytes(self), other)
class MQ(collections.deque):
    def __add__(self, other): return ('MQ.__add__', list(self), other)
class MS(set):
    def __or__(self, other): return ('MS.__or__', sorted(self), other)
class MD(dict):
    def __or__(self, other): return ('MD.__or__', dict(self), other)
class Iterable:
    def __repr__(self): return 'Iterable()'
    def __iter__(self): return iter((7, 8))
    def __radd__(self, other): return 'Iterable.__radd__'
def iadd(a, b):
    alias = a
    a += b
    return a, a is alias, alias
def imul(a, b):
    alias = a
    a *= b
    return a, a is alias, alias
def ior(a, b):
    alias = a
    a |= b
    return a, a is alias, alias
for _ in range(2):
    for make in (lambda: [1], lambda: L0([1]), lambda: ML([1]), lambda: ML2([1]), lambda: L1([1]), lambda: L2([1]), lambda: L7([1]), lambda: MQ([1]), lambda: collections.deque([1])):
        for other, b in (('list', [2]), ('tuple', (2,)), ('int', 5), ('R', R()), ('Iterable', Iterable()), ('None', None), ('T7', T7((1,))), ('L7', L7([1]))):
            show('%s += %s' % (type(make()).__name__, other), lambda: iadd(make(), b))
            show('%s *= %s' % (type(make()).__name__, other), lambda: imul(make(), b))
    for make in (lambda: bytearray(b'a'), lambda: MB(b'a'), lambda: MB2(b'a')):
        for other, b in (('bytes', b'b'), ('int', 2), ('R', R()), ('str', 'x')):
            show('%s += %s' % (type(make()).__name__, other), lambda: iadd(make(), b))
            show('%s *= %s' % (type(make()).__name__, other), lambda: imul(make(), b))
    for make in (lambda: (1,), lambda: T0((1,)), lambda: T4((1,)), lambda: T5((1,)), lambda: 'a', lambda: S2('a')):
        for other, b in (('tuple', (2,)), ('int', 2), ('R', R()), ('str', 'x')):
            show('%s += %s' % (type(make()).__name__, other), lambda: iadd(make(), b))
            show('%s *= %s' % (type(make()).__name__, other), lambda: imul(make(), b))
    for name, x in (('int', 2), ('bool', True), ('float', 2.0), ('None', None), ('R', R())):
        for other, b in (('T7', T7((1,))), ('L7', L7([1])), ('S7', S7('ab')), ('T5', T5((1,)))):
            show('%s *= %s' % (name, other), lambda: imul(x, b))
            show('%s += %s' % (name, other), lambda: iadd(x, b))
    show('MS |= set', lambda: ior(MS([1]), {2}))
    show('MD |= dict', lambda: ior(MD(a=1), {'b': 2}))

# A method changes the class of the other operand: the next method is looked up in the class it has then.
class A:
    def __floordiv__(self, o):
        o.__class__ = A
        return NotImplemented
class B:
    def __rfloordiv__(self, o): return 'B.__rfloordiv__'
class C:
    def __truediv__(self, o): return 'C.__truediv__'
class D(C):
    def __rtruediv__(self, o):
        o.__class__ = E
        return NotImplemented
class E:
    def __truediv__(self, o): return 'E.__truediv__'
for _ in range(3):
    show('A // B', lambda: A() // B())
    show('C / D', lambda: C() / D())
