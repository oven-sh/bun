# Assignment to __class__ and to __bases__: which layouts go together, and an mro() that interferes.
try:
    def t(label, f):
        try:
            print(label, 'ok', f())
        except Exception as e:
            print(label, type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(label, f):')

try:
    def set_class(obj, cls):
        obj.__class__ = cls
        return type(obj).__name__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def set_class(obj, cls):')

try:
    class A: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A: pass')
try:
    class B: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class B: pass')
try:
    class S1: __slots__ = ('x',)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class S1: __slots__ = ('x',)")
try:
    class S2: __slots__ = ('x',)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class S2: __slots__ = ('x',)")
try:
    class S3: __slots__ = ('y',)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class S3: __slots__ = ('y',)")
try:
    class S4: __slots__ = ('x', 'y')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class S4: __slots__ = ('x', 'y')")
try:
    class SD1: __slots__ = ('x', '__dict__')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class SD1: __slots__ = ('x', '__dict__')")
try:
    class SD2: __slots__ = ('x', '__dict__')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class SD2: __slots__ = ('x', '__dict__')")
try:
    class SW: __slots__ = ('x', '__weakref__')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class SW: __slots__ = ('x', '__weakref__')")
try:
    class I1(int): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class I1(int): pass')
try:
    class I2(int): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class I2(int): pass')
try:
    class IS(int): __slots__ = ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class IS(int): __slots__ = ()')
try:
    class L1(list): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class L1(list): pass')
try:
    class L2(list): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class L2(list): pass')
try:
    class D1(dict): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class D1(dict): pass')
try:
    class AS1(A): __slots__ = ('x',)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class AS1(A): __slots__ = ('x',)")
try:
    class BS1(B): __slots__ = ('x',)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class BS1(B): __slots__ = ('x',)")
try:
    class AS2(A): __slots__ = ('x',)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class AS2(A): __slots__ = ('x',)")

try: t('A->B', lambda: set_class(A(), B))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('A->B', lambda: set_class(A(), B))")
try: t('S1->S2', lambda: set_class(S1(), S2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('S1->S2', lambda: set_class(S1(), S2))")
try: t('S1->S3', lambda: set_class(S1(), S3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('S1->S3', lambda: set_class(S1(), S3))")
try: t('S1->S4', lambda: set_class(S1(), S4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('S1->S4', lambda: set_class(S1(), S4))")
try: t('S1->A', lambda: set_class(S1(), A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('S1->A', lambda: set_class(S1(), A))")
try: t('A->S1', lambda: set_class(A(), S1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('A->S1', lambda: set_class(A(), S1))")
try: t('SD1->SD2', lambda: set_class(SD1(), SD2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('SD1->SD2', lambda: set_class(SD1(), SD2))")
try: t('SD1->S1', lambda: set_class(SD1(), S1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('SD1->S1', lambda: set_class(SD1(), S1))")
try: t('SW->S1', lambda: set_class(SW(), S1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('SW->S1', lambda: set_class(SW(), S1))")
try: t('I1->I2', lambda: set_class(I1(), I2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('I1->I2', lambda: set_class(I1(), I2))")
try: t('I1->IS', lambda: set_class(I1(), IS))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('I1->IS', lambda: set_class(I1(), IS))")
try: t('I1->int', lambda: set_class(I1(), int))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('I1->int', lambda: set_class(I1(), int))")
try: t('int->I1', lambda: set_class(1, I1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('int->I1', lambda: set_class(1, I1))")
try: t('L1->L2', lambda: set_class(L1(), L2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('L1->L2', lambda: set_class(L1(), L2))")
try: t('L1->D1', lambda: set_class(L1(), D1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('L1->D1', lambda: set_class(L1(), D1))")
try: t('L1->A', lambda: set_class(L1(), A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('L1->A', lambda: set_class(L1(), A))")
try: t('AS1->AS2', lambda: set_class(AS1(), AS2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('AS1->AS2', lambda: set_class(AS1(), AS2))")
try: t('AS1->BS1', lambda: set_class(AS1(), BS1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('AS1->BS1', lambda: set_class(AS1(), BS1))")
try: t('A->1', lambda: set_class(A(), 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('A->1', lambda: set_class(A(), 1))")
try: t('object->A', lambda: set_class(object(), A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('object->A', lambda: set_class(object(), A))")
try:
    def delete_class():
        del A().__class__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def delete_class():')
try: t('del', delete_class)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('del', delete_class)")
try: s = S1()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s = S1()')
try: s.x = 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s.x = 5')
try: s.__class__ = S2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s.__class__ = S2')
try: print('s.x =>', s.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s.x')
try: print('type(s).__name__ =>', type(s).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(s).__name__')

try: import types
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import types')
try:
    class M1(types.ModuleType): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M1(types.ModuleType): pass')
try:
    class M2(types.ModuleType): __slots__ = ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M2(types.ModuleType): __slots__ = ()')
try: m = types.ModuleType('m')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: m = types.ModuleType('m')")
try: t('module->M1', lambda: set_class(m, M1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('module->M1', lambda: set_class(m, M1))")
try: t('M1->module', lambda: set_class(m, types.ModuleType))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('M1->module', lambda: set_class(m, types.ModuleType))")
try: t('module->M2', lambda: set_class(m, M2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('module->M2', lambda: set_class(m, M2))")

try:
    def set_bases(cls, *bases):
        cls.__bases__ = bases
        return [c.__name__ for c in cls.__mro__]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def set_bases(cls, *bases):')

try:
    class P: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class P: pass')
try:
    class Q: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Q: pass')
try:
    class R(P): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class R(P): pass')
try:
    class T(R): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class T(R): pass')
try: t('R(Q)', lambda: set_bases(R, Q))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('R(Q)', lambda: set_bases(R, Q))")
try: print('[c.__name__ for c in T.__mro__] =>', [c.__name__ for c in T.__mro__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in T.__mro__]')
try: print('[c.__name__ for c in P.__subclasses__()] =>', [c.__name__ for c in P.__subclasses__()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in P.__subclasses__()]')
try: print('[c.__name__ for c in Q.__subclasses__()] =>', [c.__name__ for c in Q.__subclasses__()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in Q.__subclasses__()]')
try: t('R(P, Q)', lambda: set_bases(R, P, Q))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('R(P, Q)', lambda: set_bases(R, P, Q))")
try: t('R()', lambda: set_bases(R))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('R()', lambda: set_bases(R))")
try: t('R(R)', lambda: set_bases(R, R))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('R(R)', lambda: set_bases(R, R))")
try: t('R(T)', lambda: set_bases(R, T))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('R(T)', lambda: set_bases(R, T))")
try: t('R(int)', lambda: set_bases(R, int))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('R(int)', lambda: set_bases(R, int))")
try: t('R(S1)', lambda: set_bases(R, S1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('R(S1)', lambda: set_bases(R, S1))")
try: t('R(object)', lambda: set_bases(R, object))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('R(object)', lambda: set_bases(R, object))")
try: t('R(1)', lambda: set_bases(R, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('R(1)', lambda: set_bases(R, 1))")
try: t('R(P, P)', lambda: set_bases(R, P, P))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('R(P, P)', lambda: set_bases(R, P, P))")
try: t('R(bool)', lambda: set_bases(R, bool))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('R(bool)', lambda: set_bases(R, bool))")
try:
    def not_a_tuple():
        R.__bases__ = [P]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def not_a_tuple():')
try: t('list', not_a_tuple)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('list', not_a_tuple)")
try:
    def delete_bases():
        del R.__bases__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def delete_bases():')
try: t('del', delete_bases)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('del', delete_bases)")
try: t('int', lambda: set_bases(int, object))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('int', lambda: set_bases(int, object))")
try: print('[c.__name__ for c in R.__mro__] =>', [c.__name__ for c in R.__mro__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in R.__mro__]')
try: print('[c.__name__ for c in T.__mro__] =>', [c.__name__ for c in T.__mro__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in T.__mro__]')

# A conflict further down undoes everything.
try:
    class X1: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class X1: pass')
try:
    class X2: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class X2: pass')
try:
    class Y(X1, X2): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Y(X1, X2): pass')
try:
    class Z(Y, X1, X2): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Z(Y, X1, X2): pass')
try: t('Y(X2, X1)', lambda: set_bases(Y, X2, X1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('Y(X2, X1)', lambda: set_bases(Y, X2, X1))")
try: print('[c.__name__ for c in Y.__mro__] =>', [c.__name__ for c in Y.__mro__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in Y.__mro__]')
try: print('[c.__name__ for c in Z.__mro__] =>', [c.__name__ for c in Z.__mro__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in Z.__mro__]')
try: print('[c.__name__ for c in Y.__bases__] =>', [c.__name__ for c in Y.__bases__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in Y.__bases__]')

# An mro() that raises: nothing changes.
try:
    class Meta(type):
        fail = False
        def mro(cls):
            if Meta.fail and cls.__name__ == 'W2':
                raise RuntimeError('no MRO for ' + cls.__name__)
            return super().mro()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Meta(type):')
try:
    class V1(metaclass=Meta): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class V1(metaclass=Meta): pass')
try:
    class V2(metaclass=Meta): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class V2(metaclass=Meta): pass')
try:
    class W1(V1): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class W1(V1): pass')
try:
    class W2(W1): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class W2(W1): pass')
try: Meta.fail = True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Meta.fail = True')
try: t('W1(V2)', lambda: set_bases(W1, V2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('W1(V2)', lambda: set_bases(W1, V2))")
try: print('[c.__name__ for c in W1.__mro__] =>', [c.__name__ for c in W1.__mro__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in W1.__mro__]')
try: print('[c.__name__ for c in W2.__mro__] =>', [c.__name__ for c in W2.__mro__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in W2.__mro__]')
try: print('[c.__name__ for c in W1.__bases__] =>', [c.__name__ for c in W1.__bases__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in W1.__bases__]')
try: print('[c.__name__ for c in V1.__subclasses__()] =>', [c.__name__ for c in V1.__subclasses__()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in V1.__subclasses__()]')
try: print('[c.__name__ for c in V2.__subclasses__()] =>', [c.__name__ for c in V2.__subclasses__()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in V2.__subclasses__()]')
try: Meta.fail = False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Meta.fail = False')
try: t('W1(V2)', lambda: set_bases(W1, V2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('W1(V2)', lambda: set_bases(W1, V2))")
try: print('[c.__name__ for c in W2.__mro__] =>', [c.__name__ for c in W2.__mro__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in W2.__mro__]')
try: print('[c.__name__ for c in V1.__subclasses__()] =>', [c.__name__ for c in V1.__subclasses__()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in V1.__subclasses__()]')
try: print('[c.__name__ for c in V2.__subclasses__()] =>', [c.__name__ for c in V2.__subclasses__()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in V2.__subclasses__()]')

# An mro() that assigns to __bases__ itself.
try:
    class Meta2(type):
        again = None
        def mro(cls):
            if Meta2.again and cls.__name__ == 'N':
                bases, Meta2.again = Meta2.again, None
                cls.__bases__ = bases
            return super().mro()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Meta2(type):')
try:
    class N1(metaclass=Meta2): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class N1(metaclass=Meta2): pass')
try:
    class N2(metaclass=Meta2): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class N2(metaclass=Meta2): pass')
try:
    class N3(metaclass=Meta2): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class N3(metaclass=Meta2): pass')
try:
    class N(N1): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class N(N1): pass')
try: Meta2.again = (N3,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Meta2.again = (N3,)')
try: t('N(N2)', lambda: set_bases(N, N2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('N(N2)', lambda: set_bases(N, N2))")
try: print('[c.__name__ for c in N.__bases__] =>', [c.__name__ for c in N.__bases__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in N.__bases__]')
try: print('[c.__name__ for c in N.__mro__] =>', [c.__name__ for c in N.__mro__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in N.__mro__]')
try: print([[c.__name__ for c in k.__subclasses__()] for k in (N1, N2, N3)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [[c.__name__ for c in k.__subclasses__()] for k in (N1, N2, N3)]')

# What mro() returns is checked.
try:
    class Meta3(type):
        result = None
        def mro(cls):
            return Meta3.result if Meta3.result is not None else super().mro()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Meta3(type):')
try:
    def make(result):
        Meta3.result = result
        try:
            return [getattr(c, '__name__', c) for c in Meta3('C', (), {}).__mro__]
        finally:
            Meta3.result = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def make(result):')
try: t('mro 1', lambda: make(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('mro 1', lambda: make(1))")
try: t('mro [1]', lambda: make([1]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('mro [1]', lambda: make([1]))")
try: t('mro [int]', lambda: make([int]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('mro [int]', lambda: make([int]))")
try: t('mro [object]', lambda: make([object]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('mro [object]', lambda: make([object]))")
try: t('mro []', lambda: make([]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('mro []', lambda: make([]))")
try: t('mro (A, object)', lambda: make((A, object)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('mro (A, object)', lambda: make((A, object)))")

# A class in an MRO that the type does not derive from: what it has is found, as it is now.
try:
    class Lender:
        value = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Lender:')
try:
    class Meta4(type):
        def mro(cls):
            return (cls, Lender, object)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Meta4(type):')
try:
    class Borrower(metaclass=Meta4): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Borrower(metaclass=Meta4): pass')
try:
    class SubBorrower(Borrower): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SubBorrower(Borrower): pass')
try: print('Borrower.value =>', Borrower.value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Borrower.value')
try: print('SubBorrower.value =>', SubBorrower.value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: SubBorrower.value')
try: print('Borrower().value =>', Borrower().value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Borrower().value')
try: Lender.value = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Lender.value = 2')
try: print('Borrower.value =>', Borrower.value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Borrower.value')
try: print('SubBorrower.value =>', SubBorrower.value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: SubBorrower.value')
try: print('Borrower().value =>', Borrower().value)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Borrower().value')
try: Lender.other = 'new'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Lender.other = 'new'")
try: print('Borrower.other =>', Borrower.other)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Borrower.other')
try: print('SubBorrower().other =>', SubBorrower().other)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: SubBorrower().other')
try: del Lender.other
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del Lender.other')
try: print("hasattr(Borrower, 'other') =>", hasattr(Borrower, 'other'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: hasattr(Borrower, 'other')")
try: print('[c.__name__ for c in Lender.__subclasses__()] =>', [c.__name__ for c in Lender.__subclasses__()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in Lender.__subclasses__()]')
try: print('[c.__name__ for c in Borrower.__subclasses__()] =>', [c.__name__ for c in Borrower.__subclasses__()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in Borrower.__subclasses__()]')
try: print('issubclass(Borrower, Lender) =>', issubclass(Borrower, Lender))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: issubclass(Borrower, Lender)')
try: print('isinstance(Borrower(), Lender) =>', isinstance(Borrower(), Lender))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(Borrower(), Lender)')
# Two that name each other.
try:
    class Meta5(type):
        partner = {}
        def mro(cls):
            other = Meta5.partner.get(cls.__name__)
            return (cls, other, object) if other else (cls, object)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Meta5(type):')
try:
    class Left(metaclass=Meta5): left = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Left(metaclass=Meta5): left = 1')
try:
    class Right(metaclass=Meta5): right = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Right(metaclass=Meta5): right = 1')
try:
    class Spare: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Spare: pass')
try: Meta5.partner = {'Left': Right, 'Right': Left}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Meta5.partner = {'Left': Right, 'Right': Left}")
try: Left.__bases__ = (Spare,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Left.__bases__ = (Spare,)')
try: Right.__bases__ = (Spare,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Right.__bases__ = (Spare,)')
try: print('[c.__name__ for c in Left.__mro__] =>', [c.__name__ for c in Left.__mro__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in Left.__mro__]')
try: print('[c.__name__ for c in Right.__mro__] =>', [c.__name__ for c in Right.__mro__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in Right.__mro__]')
try: print('Left.right =>', Left.right)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Left.right')
try: print('Right.left =>', Right.left)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Right.left')
try: Left.left = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Left.left = 2')
try: Right.right = 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Right.right = 3')
try: print('Left.right =>', Left.right)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Left.right')
try: print('Right.left =>', Right.left)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Right.left')
