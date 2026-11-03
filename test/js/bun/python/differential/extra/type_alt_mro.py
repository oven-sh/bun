class A(object):
    def f(self): return "A"
class B(A): pass
class C(A):
    def f(self): return "C"
class D(B, C): pass
print(A.mro(), D.mro(), D().f())
class PerverseMetaType(type):
    def mro(cls):
        L = type.mro(cls)
        L.reverse()
        return L
class X(D,B,C,A, metaclass=PerverseMetaType): pass
print(X.__mro__)
print(X().f())
try:
    class _metaclass(type):
        def mro(self): return [self, dict, object]
    class X(object, metaclass=_metaclass): pass
    print('created'); x = object.__new__(X); x[5] = 6
except TypeError as e: print('TypeError', e)
try:
    class _metaclass(type):
        def mro(self): return [1]
    class X(object, metaclass=_metaclass): pass
except TypeError as e: print('TypeError', e)
try:
    class _metaclass(type):
        def mro(self): return 1
    class X(object, metaclass=_metaclass): pass
except TypeError as e: print('TypeError', e)
