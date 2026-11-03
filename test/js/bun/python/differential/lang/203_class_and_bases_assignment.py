# Assignment to __class__ and to __bases__: which layouts go together, and an mro() that interferes.
def t(label, f):
    try:
        print(label, 'ok', f())
    except Exception as e:
        print(label, type(e).__name__, e)

def set_class(obj, cls):
    obj.__class__ = cls
    return type(obj).__name__

class A: pass
class B: pass
class S1: __slots__ = ('x',)
class S2: __slots__ = ('x',)
class S3: __slots__ = ('y',)
class S4: __slots__ = ('x', 'y')
class SD1: __slots__ = ('x', '__dict__')
class SD2: __slots__ = ('x', '__dict__')
class SW: __slots__ = ('x', '__weakref__')
class I1(int): pass
class I2(int): pass
class IS(int): __slots__ = ()
class L1(list): pass
class L2(list): pass
class D1(dict): pass
class AS1(A): __slots__ = ('x',)
class BS1(B): __slots__ = ('x',)
class AS2(A): __slots__ = ('x',)

t('A->B', lambda: set_class(A(), B))
t('S1->S2', lambda: set_class(S1(), S2))
t('S1->S3', lambda: set_class(S1(), S3))
t('S1->S4', lambda: set_class(S1(), S4))
t('S1->A', lambda: set_class(S1(), A))
t('A->S1', lambda: set_class(A(), S1))
t('SD1->SD2', lambda: set_class(SD1(), SD2))
t('SD1->S1', lambda: set_class(SD1(), S1))
t('SW->S1', lambda: set_class(SW(), S1))
t('I1->I2', lambda: set_class(I1(), I2))
t('I1->IS', lambda: set_class(I1(), IS))
t('I1->int', lambda: set_class(I1(), int))
t('int->I1', lambda: set_class(1, I1))
t('L1->L2', lambda: set_class(L1(), L2))
t('L1->D1', lambda: set_class(L1(), D1))
t('L1->A', lambda: set_class(L1(), A))
t('AS1->AS2', lambda: set_class(AS1(), AS2))
t('AS1->BS1', lambda: set_class(AS1(), BS1))
t('A->1', lambda: set_class(A(), 1))
t('object->A', lambda: set_class(object(), A))
def delete_class():
    del A().__class__
t('del', delete_class)
s = S1(); s.x = 5; s.__class__ = S2; print(s.x, type(s).__name__)

import types
class M1(types.ModuleType): pass
class M2(types.ModuleType): __slots__ = ()
m = types.ModuleType('m')
t('module->M1', lambda: set_class(m, M1))
t('M1->module', lambda: set_class(m, types.ModuleType))
t('module->M2', lambda: set_class(m, M2))

def set_bases(cls, *bases):
    cls.__bases__ = bases
    return [c.__name__ for c in cls.__mro__]

class P: pass
class Q: pass
class R(P): pass
class T(R): pass
t('R(Q)', lambda: set_bases(R, Q))
print([c.__name__ for c in T.__mro__], [c.__name__ for c in P.__subclasses__()], [c.__name__ for c in Q.__subclasses__()])
t('R(P, Q)', lambda: set_bases(R, P, Q))
t('R()', lambda: set_bases(R))
t('R(R)', lambda: set_bases(R, R))
t('R(T)', lambda: set_bases(R, T))
t('R(int)', lambda: set_bases(R, int))
t('R(S1)', lambda: set_bases(R, S1))
t('R(object)', lambda: set_bases(R, object))
t('R(1)', lambda: set_bases(R, 1))
t('R(P, P)', lambda: set_bases(R, P, P))
t('R(bool)', lambda: set_bases(R, bool))
def not_a_tuple():
    R.__bases__ = [P]
t('list', not_a_tuple)
def delete_bases():
    del R.__bases__
t('del', delete_bases)
t('int', lambda: set_bases(int, object))
print([c.__name__ for c in R.__mro__], [c.__name__ for c in T.__mro__])

# A conflict further down undoes everything.
class X1: pass
class X2: pass
class Y(X1, X2): pass
class Z(Y, X1, X2): pass
t('Y(X2, X1)', lambda: set_bases(Y, X2, X1))
print([c.__name__ for c in Y.__mro__], [c.__name__ for c in Z.__mro__], [c.__name__ for c in Y.__bases__])

# An mro() that raises: nothing changes.
class Meta(type):
    fail = False
    def mro(cls):
        if Meta.fail and cls.__name__ == 'W2':
            raise RuntimeError('no MRO for ' + cls.__name__)
        return super().mro()
class V1(metaclass=Meta): pass
class V2(metaclass=Meta): pass
class W1(V1): pass
class W2(W1): pass
Meta.fail = True
t('W1(V2)', lambda: set_bases(W1, V2))
print([c.__name__ for c in W1.__mro__], [c.__name__ for c in W2.__mro__], [c.__name__ for c in W1.__bases__], [c.__name__ for c in V1.__subclasses__()], [c.__name__ for c in V2.__subclasses__()])
Meta.fail = False
t('W1(V2)', lambda: set_bases(W1, V2))
print([c.__name__ for c in W2.__mro__], [c.__name__ for c in V1.__subclasses__()], [c.__name__ for c in V2.__subclasses__()])

# An mro() that assigns to __bases__ itself.
class Meta2(type):
    again = None
    def mro(cls):
        if Meta2.again and cls.__name__ == 'N':
            bases, Meta2.again = Meta2.again, None
            cls.__bases__ = bases
        return super().mro()
class N1(metaclass=Meta2): pass
class N2(metaclass=Meta2): pass
class N3(metaclass=Meta2): pass
class N(N1): pass
Meta2.again = (N3,)
t('N(N2)', lambda: set_bases(N, N2))
print([c.__name__ for c in N.__bases__], [c.__name__ for c in N.__mro__])
print([[c.__name__ for c in k.__subclasses__()] for k in (N1, N2, N3)])

# What mro() returns is checked.
class Meta3(type):
    result = None
    def mro(cls):
        return Meta3.result if Meta3.result is not None else super().mro()
def make(result):
    Meta3.result = result
    try:
        return [getattr(c, '__name__', c) for c in Meta3('C', (), {}).__mro__]
    finally:
        Meta3.result = None
t('mro 1', lambda: make(1))
t('mro [1]', lambda: make([1]))
t('mro [int]', lambda: make([int]))
t('mro [object]', lambda: make([object]))
t('mro []', lambda: make([]))
t('mro (A, object)', lambda: make((A, object)))

# A class in an MRO that the type does not derive from: what it has is found, as it is now.
class Lender:
    value = 1
class Meta4(type):
    def mro(cls):
        return (cls, Lender, object)
class Borrower(metaclass=Meta4): pass
class SubBorrower(Borrower): pass
print(Borrower.value, SubBorrower.value, Borrower().value)
Lender.value = 2
print(Borrower.value, SubBorrower.value, Borrower().value)
Lender.other = 'new'
print(Borrower.other, SubBorrower().other)
del Lender.other
print(hasattr(Borrower, 'other'), [c.__name__ for c in Lender.__subclasses__()], [c.__name__ for c in Borrower.__subclasses__()], issubclass(Borrower, Lender), isinstance(Borrower(), Lender))
# Two that name each other.
class Meta5(type):
    partner = {}
    def mro(cls):
        other = Meta5.partner.get(cls.__name__)
        return (cls, other, object) if other else (cls, object)
class Left(metaclass=Meta5): left = 1
class Right(metaclass=Meta5): right = 1
class Spare: pass
Meta5.partner = {'Left': Right, 'Right': Left}
Left.__bases__ = (Spare,)
Right.__bases__ = (Spare,)
print([c.__name__ for c in Left.__mro__], [c.__name__ for c in Right.__mro__], Left.right, Right.left)
Left.left = 2; Right.right = 3
print(Left.right, Right.left)
