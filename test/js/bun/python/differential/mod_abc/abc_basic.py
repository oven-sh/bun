import abc, _abc, gc, weakref, collections.abc as cabc

def show(f, *a, **k):
    try:
        r = f(*a, **k)
        print(repr(r))
    except BaseException as e:
        print(type(e).__name__, e)

print(sorted(n for n in dir(_abc) if not n.startswith('__')))
print(_abc.__doc__)
print(abc.ABCMeta.__module__, abc.get_cache_token is _abc.get_cache_token)
print(type(abc.ABC._abc_impl), type(abc.ABC._abc_impl).__name__, type(abc.ABC._abc_impl).__module__, type(abc.ABC._abc_impl).__doc__)

class A(abc.ABC):
    @abc.abstractmethod
    def f(self): pass
    @property
    @abc.abstractmethod
    def p(self): pass
    @classmethod
    @abc.abstractmethod
    def c(cls): pass
    @staticmethod
    @abc.abstractmethod
    def s(): pass
    def concrete(self): pass
print(sorted(A.__abstractmethods__), type(A.__abstractmethods__))
show(A)
class B(A):
    def f(self): pass
print(sorted(B.__abstractmethods__))
show(B)
class C(B):
    p = 1
    c = 2
    s = 3
print(sorted(C.__abstractmethods__))
print(type(C()).__name__)
class D(C):
    @abc.abstractmethod
    def g(self): pass
print(sorted(D.__abstractmethods__))
show(D)

# register
t0 = abc.get_cache_token()
class R(abc.ABC): pass
class X: pass
class Y(X): pass
print(issubclass(X, R), isinstance(X(), R), issubclass(Y, R))
print(R.register(X) is X)
print(abc.get_cache_token() - t0)
print(issubclass(X, R), isinstance(X(), R), issubclass(Y, R), isinstance(Y(), R))
print(R.register(X) is X, abc.get_cache_token() - t0)
print(R.register(R) is R, abc.get_cache_token() - t0)
show(R.register, 1)
show(R.register, 'x')
show(R.register, None)
class R2(R): pass
show(R2.register, R)
show(X.__class__.register if hasattr(X.__class__, 'register') else (lambda: 'no register'))
@R.register
class Z: pass
print(issubclass(Z, R), Z.__name__)
print(issubclass(int, R), isinstance(1, R))
R.register(int)
print(issubclass(int, R), isinstance(1, R), issubclass(bool, R), isinstance(True, R))

# Through a chain of registrations and subclasses
class P(abc.ABC): pass
class Q(abc.ABC): pass
class S(P): pass
P.register(Q)
class T: pass
Q.register(T)
print(issubclass(T, P), issubclass(T, Q), issubclass(T, S), issubclass(S, P), issubclass(P, S))
S.register(float)
print(issubclass(float, P), issubclass(float, S), issubclass(float, Q), isinstance(1.5, P))

# issubclass with what is not a class
show(issubclass, 1, R)
show(issubclass, 'x', R)
show(issubclass, None, R)
show(issubclass, (X,), R)
show(R.__subclasscheck__, 1)
show(R.__instancecheck__, 1)
show(_abc._abc_subclasscheck, R, 1)
show(_abc._abc_subclasscheck, 1, int)
show(_abc._abc_instancecheck, 1, 1)
show(_abc._abc_register, 1, int)
show(_abc._abc_register, R, 1)
show(_abc._get_dump, 1)
show(_abc._get_dump, int)
show(_abc._reset_registry, int)
show(_abc._reset_caches, int)
show(_abc._abc_init)
show(_abc._abc_init, 1)
show(_abc._abc_init, R, R)
show(_abc.get_cache_token, 1)

# __subclasshook__
class H(abc.ABC):
    calls = []
    @classmethod
    def __subclasshook__(cls, C):
        H.calls.append((cls.__name__, C.__name__))
        if cls is H:
            if hasattr(C, 'quack'): return True
            if hasattr(C, 'moo'): return False
        return NotImplemented
class Duck:
    def quack(self): pass
class Cow(H):
    def moo(self): pass
class Dog: pass
print(issubclass(Duck, H), issubclass(Cow, H), issubclass(Dog, H), isinstance(Duck(), H), isinstance(Cow(), H))
print(H.calls)
H.calls.clear()
print(issubclass(Duck, H), issubclass(Cow, H), issubclass(Dog, H))
print(H.calls)   # all cached
H.register(str)
print(issubclass(Duck, H), issubclass(Cow, H), issubclass(Dog, H))
print(H.calls)   # the negative cache has gone
for bad in (1, 0, None, 'x', [], 1.0):
    class HB(abc.ABC):
        @classmethod
        def __subclasshook__(cls, C, bad=bad):
            return bad
    show(issubclass, int, HB)
class HE(abc.ABC):
    @classmethod
    def __subclasshook__(cls, C):
        raise KeyError('hook')
show(issubclass, int, HE)
show(isinstance, 1, HE)

# _abc_impl of the wrong type
class W(abc.ABC): pass
W._abc_impl = 1
show(issubclass, int, W)
show(isinstance, 1, W)
show(W.register, int)
show(_abc._get_dump, W)
del W._abc_impl
print(issubclass(int, W))   # that of ABC is inherited
impl = type(abc.ABC._abc_impl)
show(lambda: type(impl()).__name__)
show(lambda: type(impl(1, 2, x=3)).__name__)
W._abc_impl = impl()
print(issubclass(int, W), isinstance(1, W))
try:
    class Sub(impl): pass
    print('subclassed')
except TypeError as e:
    print('TypeError', e)

# __class__ that lies
class Liar:
    @property
    def __class__(self): return X
print(isinstance(Liar(), R), type(Liar()) is Liar)
class Liar2:
    @property
    def __class__(self): return 5
show(isinstance, Liar2(), R)
class Liar3:
    @property
    def __class__(self): raise KeyError('cls')
show(isinstance, Liar3(), R)
class Liar4(X):
    @property
    def __class__(self): return Dog
print(isinstance(Liar4(), R))

# The dump
class M(abc.ABC): pass
class M1: pass
class M2: pass
M.register(M1)
issubclass(M1, M); issubclass(M2, M); issubclass(int, M)
reg, cache, neg, ver = _abc._get_dump(M)
print(type(reg), type(cache), type(neg), type(ver))
print(sorted(r().__name__ for r in reg), sorted(r().__name__ for r in cache), sorted(r().__name__ for r in neg), ver == abc.get_cache_token())
print(all(type(r) is weakref.ref for r in reg | cache | neg))
_abc._reset_caches(M)
reg, cache, neg, ver = _abc._get_dump(M)
print(len(reg), len(cache), len(neg))
print(issubclass(M1, M))
_abc._reset_registry(M)
_abc._reset_caches(M)
print(issubclass(M1, M), [len(x) for x in _abc._get_dump(M)[:3]])
import io, contextlib
M.register(M2)
issubclass(M2, M)
buf = io.StringIO()
M._dump_registry(buf)
text = buf.getvalue().splitlines()
print(text[0], [l.split(':')[0] for l in text[1:]])
M._abc_registry_clear(); M._abc_caches_clear()
print([len(x) for x in _abc._get_dump(M)[:3]])

# Classes are not kept alive
class K(abc.ABC): pass
def make():
    class Temp: pass
    class Temp2: pass
    K.register(Temp)
    issubclass(Temp, K); issubclass(Temp2, K)
    return weakref.ref(Temp), weakref.ref(Temp2)
r1, r2 = make()
print([len(x) for x in _abc._get_dump(K)[:3]])
for i in range(3): gc.collect()
print(r1() is None, r2() is None, [len(x) for x in _abc._get_dump(K)[:3]])
