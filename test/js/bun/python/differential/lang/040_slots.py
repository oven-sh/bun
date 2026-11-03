def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

class P:
    __slots__ = ("x", "y")
    def __init__(self, x, y): self.x = x; self.y = y
p = P(1, 2)
print(p.x, p.y, P.__slots__, hasattr(p, "__dict__"), hasattr(p, "__weakref__"), type(P.x).__name__, [k for k in P.__dict__ if not k.startswith("__")], "x" in dir(p))
p.x = 10; print(p.x); del p.x; t(lambda: p.x); print(hasattr(p, "x")); p.x = 3; print(p.x)
def s1(): p.z = 1
def s2(): del p.z
def s3():
    del p.y; del p.y
t(s1); t(s2); t(s3); t(lambda: p.__dict__); t(lambda: vars(p)); t(lambda: p.nope)
q = P.__new__(P); t(lambda: q.x); print(hasattr(q, "x"), hasattr(q, "y"))
class E: __slots__ = ()
e = E()
def s4(): e.a = 1
t(s4); print(E.__slots__, hasattr(e, "__dict__"))
class S1: __slots__ = "single"
s = S1(); s.single = 1; print(s.single, S1.__slots__)
class SL: __slots__ = ["a", "b"]
class SD: __slots__ = {"a": "doc of a", "b": "doc of b"}
class SG: __slots__ = (n for n in ("a", "b"))
print(SL.__slots__, SD.__slots__, SD.a.__doc__, SL.a.__doc__, type(SG.__slots__).__name__, hasattr(SG, "a"), hasattr(SG, "b"))
class WithDict: __slots__ = ("a", "__dict__")
w = WithDict(); w.a = 1; w.other = 2; print(w.a, w.other, w.__dict__)
class WithWeak: __slots__ = ("a", "__weakref__")
print(hasattr(WithWeak(), "__weakref__"), hasattr(WithWeak(), "__dict__"))
# Inheritance.
class Base: __slots__ = ("a",)
class Derived(Base): __slots__ = ("b",)
class NoSlots(Base): pass
class EmptySlots(Base): __slots__ = ()
d = Derived(); d.a = 1; d.b = 2; print(d.a, d.b, hasattr(d, "__dict__"), Derived.__slots__, Base.__slots__)
def s5(): d.c = 3
t(s5)
n = NoSlots(); n.a = 1; n.c = 3; print(n.a, n.c, n.__dict__, hasattr(n, "__weakref__"))
es = EmptySlots(); es.a = 1; print(es.a, hasattr(es, "__dict__"))
class Plain: pass
class SlotsOverPlain(Plain): __slots__ = ("s",)
sp = SlotsOverPlain(); sp.s = 1; sp.t = 2; print(sp.s, sp.__dict__)
class Shadow(Base): __slots__ = ("a",)
sh = Shadow(); sh.a = "derived slot"; print(sh.a, Base.a.__get__(sh, Shadow) if False else "", Shadow.a is Base.a); t(lambda: Base.a.__get__(sh))
class L1: __slots__ = ("a",)
class L2: __slots__ = ("b",)
class L0: __slots__ = ()
def m1():
    class X(L1, L2): pass
def m2():
    class X(L1, L0): __slots__ = ()
    return X.__mro__[0].__name__
def m3():
    class X(L1, Plain): pass
    x = X(); x.a = 1; x.z = 2; return x.a, x.__dict__
def m4():
    class X(L1, int): pass
def m5():
    class X(L0, int): __slots__ = ()
    return X(5) + 1
def m6():
    class X(int): __slots__ = ("a",)
def m7():
    class X(tuple): __slots__ = ("a",)
def m8():
    class X(list): __slots__ = ("a",)
    x = X([1]); x.a = 2; return x, x.a, hasattr(x, "__dict__")
def m9():
    class X(dict): __slots__ = ()
    x = X(a=1)
    try: x.z = 1
    except AttributeError as e: return x, str(e)
def m10():
    class X(str): __slots__ = ("a",)
def m11():
    class X(bytes): __slots__ = ("a",)
def m12():
    class X(float): __slots__ = ("a",)
    x = X(1.5); x.a = 1; return x, x.a
def m13():
    class X(Exception): __slots__ = ("a",)
    x = X("m"); x.a = 1; x.b = 2; return x.a, x.b
def m14():
    class X(type): __slots__ = ("a",)
def m15():
    class X(object): __slots__ = ("a",)
    class Y(X): __slots__ = ("b",)
    class Z(X): __slots__ = ("c",)
    class W(Y, Z): pass
for m in (m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15): t(m)
# Invalid declarations.
def b(slots, **extra):
    def make(): return type("X", (), {"__slots__": slots, **extra}).__name__
    return make
t(b(("a", "a")) ); t(b((1,))); t(b(("1a",))); t(b(("a b",))); t(b(("",))); t(b(1)); t(b(None)); t(b(("a",), a=1)); t(b(("__dict__", "__dict__"))); t(b(("__weakref__", "__weakref__"))); t(b(("a-b",))); t(b((b"a",))); t(b(("é",))); t(b(("class",))); t(b(("__slots__",))); t(b(("__init__",))); t(b(("a",), __init__=lambda s: None)); t(b("ab")); t(b(("a",), b=1)); t(b(("__qualname__",))); t(b(("__class__",))); t(b(("__doc__",))); t(b(("__module__",)))
def dd():
    class X(Plain): __slots__ = ("__dict__",)
def ww():
    class X(Plain): __slots__ = ("__weakref__",)
t(dd); t(ww)
# Name mangling applies.
class Mg:
    __slots__ = ("__priv", "_single", "__dunder__")
    def __init__(self): self.__priv = 1; self._single = 2; self.__dunder__ = 3
    def get(self): return self.__priv
mg = Mg(); print(mg.get(), mg._Mg__priv, mg._single, mg.__dunder__, Mg.__slots__, sorted(k for k in Mg.__dict__ if "priv" in k or "single" in k or "dunder" in k))
# Class attributes alongside slots; properties; methods.
class CA:
    __slots__ = ("_v",)
    default = "class level"
    def __init__(self): self._v = 0
    @property
    def v(self): return self._v
    @v.setter
    def v(self, x): self._v = x
    def m(self): return self._v
    @classmethod
    def c(cls): return cls.default
ca = CA(); ca.v = 5; print(ca.v, ca.m(), ca.c(), ca.default)
def s6(): ca.default = 1
t(s6); CA.default = "changed"; print(ca.default)
# __class__ assignment needs the same layout.
class A1: __slots__ = ("x",)
class A2: __slots__ = ("x",)
class A3: __slots__ = ("y",)
class A4: __slots__ = ("x", "y")
a = A1(); a.x = 1; a.__class__ = A2; print(type(a).__name__, a.x)
def c1(): a.__class__ = A3
def c2(): a.__class__ = A4
def c3(): a.__class__ = Plain
def c4(): Plain().__class__ = A1
t(c1); t(c2); t(c3); t(c4)
# Hooks still apply.
class H:
    __slots__ = ("a",)
    def __getattr__(self, n): return "fallback " + n
    def __setattr__(self, n, v): print("set", n, end="; "); object.__setattr__(self, n, v)
h = H(); print(h.a); h.a = 1; print(h.a, h.b)
def s7(): h.b = 1
t(s7)
print(repr(P.x), P.x.__name__, P.x.__objclass__.__name__, P.x.__get__(p), P.x.__set__(p, 9), p.x, P.x.__get__(None, P) is P.x)
import sys
many = type("Many", (), {"__slots__": tuple("s%d" % i for i in range(100))}); mo = many()
for i in range(100): setattr(mo, "s%d" % i, i)
print(sum(getattr(mo, "s%d" % i) for i in range(100)), len(many.__slots__))
objs = [P(i, -i) for i in range(1000)]; print(sum(o.x + o.y for o in objs), objs[500].x)
print(P(1, 2).__reduce_ex__(2)[2], P(1, 2).__getstate__(), E().__getstate__(), WithDict().__getstate__(), Derived().__getstate__())
t(lambda: P(1, 2).__reduce_ex__(1)); t(lambda: P(1, 2).__reduce__())
