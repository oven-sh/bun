def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

# __init_subclass__
class Base:
    subs = []
    def __init_subclass__(cls, tag=None, **kw):
        super().__init_subclass__(**kw)
        print("init_subclass", cls.__name__, tag, end="; ")
        cls.tag = tag; Base.subs.append(cls.__name__)
class A(Base): pass
class B(Base, tag="b"): pass
class C(B): pass
class D(A, tag="d"): x = 1
print(Base.subs, A.tag, B.tag, C.tag, D.tag, type(Base.__dict__["__init_subclass__"]).__name__)
def e1():
    class X(Base, nope=1): pass
def e2():
    class X(nope=1): pass
def e3():
    class X(object, a=1, b=2): pass
def e4():
    class X(Base, tag=1, tag2=2): pass
t(e1); t(e2); t(e3); t(e4); t(lambda: type("X", (Base,), {}, tag="via type").tag); t(lambda: type("X", (), {}, nope=1)); t(lambda: object.__init_subclass__(1)); t(lambda: object.__init_subclass__(a=1)); print(object.__init_subclass__(), Base.subs[-1])
class Sees:
    def __init_subclass__(cls):
        print(cls.attr, cls.__qualname__, cls.__mro__[1].__name__, sorted(k for k in cls.__dict__ if not k.startswith("__")), end="; ")
class S2(Sees):
    attr = "visible"
    def m(self): pass
print()
class Raises:
    def __init_subclass__(cls): raise RuntimeError("no subclasses of " + cls.__mro__[1].__name__)
def e5():
    class X(Raises): pass
t(e5)
class M1:
    def __init_subclass__(cls, a=None, **kw): print("M1", a, end="; "); super().__init_subclass__(**kw)
class M2:
    def __init_subclass__(cls, b=None, **kw): print("M2", b, end="; "); super().__init_subclass__(**kw)
class M3(M1, M2, a=1, b=2): pass
print()
# __class_getitem__
class G:
    def __class_getitem__(cls, item): return "%s[%r]" % (cls.__name__, item)
class G2(G): pass
print(G[int], G[1, 2], G[()], G["s"], G2[0], G[1:2], type(G.__dict__["__class_getitem__"]).__name__, G.__class_getitem__(5))
t(lambda: G()[0]); t(lambda: Base[int]); t(lambda: object[int]); t(lambda: int[int]); t(lambda: type[int]); t(lambda: Base()[0]); t(lambda: len[int]); t(lambda: None[0]); t(lambda: type(None)[0])
class MetaGI(type):
    def __getitem__(cls, i): return "meta getitem", i
class BothGI(metaclass=MetaGI):
    def __class_getitem__(cls, i): return "class_getitem", i
print(BothGI[1])
print(list[int], dict[str, int], tuple[int, ...], set[int], frozenset[str], type[int], list[int].__origin__, list[int].__args__, dict[str, int].__args__, list[int]([1]), type(list[int]).__name__, list[int] == list[int], list[int] == list[str], list[list[int]], tuple[()], list[int, str], isinstance(list[int], type), list[int].__name__, repr(list["x"]), list[None], list[...], hash(list[int]) == hash(list[int]), callable(list[int]))
# __new__ and __init__
class N:
    def __new__(cls, *a, **k): print("new", cls.__name__, a, k, end="; "); return super().__new__(cls)
    def __init__(self, *a, **k): print("init", a, k, end="; ")
n = N(1, x=2); print(type(n).__name__)
class NotInstance:
    def __new__(cls): return 5
    def __init__(self): print("never")
print(NotInstance(), type(NotInstance()))
class OtherInstance:
    def __new__(cls): return N.__new__(N)
    def __init__(self): print("never")
print(type(OtherInstance()).__name__)
class SubInstance:
    def __new__(cls): return object.__new__(SubSub)
    def __init__(self): print("init runs for a subclass instance", end="; ")
class SubSub(SubInstance): pass
print(type(SubInstance()).__name__)
class Singleton:
    _i = None
    def __new__(cls):
        if cls._i is None: cls._i = super().__new__(cls)
        return cls._i
    def __init__(self): self.n = getattr(self, "n", 0) + 1
print(Singleton() is Singleton(), Singleton().n)
class InitReturns:
    def __init__(self): return 5
class InitReturnsNone:
    def __init__(self): return None
t(InitReturns); print(type(InitReturnsNone()).__name__)
class OnlyNew:
    def __new__(cls, a): o = super().__new__(cls); o.a = a; return o
class OnlyInit:
    def __init__(self, a): self.a = a
class Neither: pass
print(OnlyNew(1).a, OnlyInit(2).a); t(lambda: OnlyNew()); t(lambda: OnlyInit()); t(lambda: Neither(1)); t(lambda: OnlyNew(1, 2)); t(lambda: OnlyInit(1, 2)); t(lambda: Neither(a=1)); t(lambda: object.__new__(Neither, 1)); t(lambda: object.__new__(OnlyInit, 1).__dict__); t(lambda: object.__new__(OnlyNew, 1)); t(lambda: object.__init__(Neither(), 1)); t(lambda: object.__init__(OnlyNew(1), 1)); t(lambda: object.__init__(OnlyInit(1), 1))
class NewPassesArgs:
    def __new__(cls, a): return super().__new__(cls, a)
t(lambda: NewPassesArgs(1))
class NewStatic:
    def __new__(cls): return "implicit staticmethod"
print(type(NewStatic.__dict__["__new__"]).__name__, NewStatic.__new__(NewStatic), NewStatic.__new__(int), NewStatic())
class IntSub(int):
    def __new__(cls, v, extra): o = super().__new__(cls, v * 2); o.extra = extra; return o
    def __init__(self, v, extra): self.inited = True
i = IntSub(5, "e"); print(i, i.extra, i.inited, i + 1, type(i + 1), type(i))
class TupSub(tuple):
    def __new__(cls, *a): return super().__new__(cls, a)
print(TupSub(1, 2, 3), len(TupSub()))
class StrSub(str):
    def __new__(cls, s): return super().__new__(cls, s.upper())
print(StrSub("abc"), type(StrSub("a")).__name__, StrSub("a") + "b")
class Abstractish:
    def __new__(cls, *a):
        if cls is Abstractish: raise TypeError("cannot instantiate Abstractish directly")
        return super().__new__(cls)
class Concrete(Abstractish): pass
t(Abstractish); print(type(Concrete()).__name__)
N.__new__ = lambda cls, *a, **k: "patched"; print(N()); del N.__new__; print(type(N()).__name__)
# type() with three arguments.
T = type("T", (), {"a": 1, "m": lambda self: self.a}); print(T, T.__name__, T.__bases__, T().m(), T.__module__, T.__qualname__, T.__dict__["a"], T.__doc__, type(T))
T2 = type("T2", (T, Base), {"__doc__": "d", "__qualname__": "Q.T2", "__module__": "mm"}); print(); print(T2.__mro__[1:3], T2.__doc__, T2.__qualname__, T2.__module__, repr(T2), T2().m(), "__qualname__" in T2.__dict__)
ns = {"x": 1}; T3 = type("T3", (), ns); ns["y"] = 2; print(hasattr(T3, "y"), T3.x)
print(type(1), type("a"), type(T()), type(type), type(None), type(T), type(int), type(name="K", bases=(), dict={}) if False else "")
t(lambda: type()); t(lambda: type(1, 2)); t(lambda: type(1, 2, 3)); t(lambda: type("X", 1, {})); t(lambda: type("X", (), 1)); t(lambda: type("X", [], {})); t(lambda: type("X", (), [])); t(lambda: type("X", (1,), {})); t(lambda: type("X", (), {}, 1)); t(lambda: type(1, (), {})); t(lambda: type("X", (), {1: 2}).__name__); t(lambda: type("a\0b", (), {})); t(lambda: type("X", (), {"__qualname__": 1})); t(lambda: type("X", (), {"__slots__": 1})); t(lambda: type("", (), {}).__name__); t(lambda: type("not an identifier", (), {}).__name__); t(lambda: type("X", (int, str), {})); t(lambda: type("X", (bool,), {})); t(lambda: type(x=1)); t(lambda: type("X", (), {"__doc__": 5}).__doc__); t(lambda: type("é", (), {}).__name__); t(lambda: type.__new__(type, "X", (), {}).__name__); t(lambda: type.__new__(int, "X", (), {})); t(lambda: type.__new__(1)); t(lambda: type.__new__(type)); t(lambda: type.__new__(type, 1)); t(lambda: type.__call__(int, "5")); t(lambda: type.__call__(1)); t(lambda: type.__init__(int)); t(lambda: type.__init__(int, 1, 2)); t(lambda: type.__init__(int, 1)); t(lambda: type.__init__(int, 1, 2, 3))
# __mro_entries__
class Entry:
    def __init__(self, *b): self.b = b
    def __mro_entries__(self, bases): print("mro_entries", len(bases), end="; "); return self.b
class ME(Entry(A, M1)): pass
print(ME.__bases__, ME.__orig_bases__[0].__class__.__name__, ME.__mro__[1].__name__)
class ME0(Entry()): pass
print(ME0.__bases__, len(ME0.__orig_bases__))
class BadEntry:
    def __mro_entries__(self, bases): return [int]
def e6():
    class X(BadEntry()): pass
t(e6); t(lambda: type("X", (Entry(A),), {}))
class LG(list[int]): pass
print(LG.__bases__, LG.__orig_bases__, LG([1]))
# The class namespace: __module__, __qualname__, __firstlineno__, __static_attributes__, __doc__.
class NSp:
    "doc"
    print(sorted(k for k in locals()), __qualname__, __module__, end="; ")
    def __init__(self): self.a = 1; self.b = 2
    def m(self): self.c = 3; self.a = 4; x = self.d
    @classmethod
    def c(cls): cls.e = 1
print(sorted(NSp.__static_attributes__), type(NSp.__firstlineno__).__name__, NSp.__doc__, "__qualname__" in NSp.__dict__, "__firstlineno__" in NSp.__dict__)
class QN: __qualname__ = "Custom.QN"
print(QN.__qualname__, QN.__name__, repr(QN))
def bq():
    class X: __qualname__ = 5
t(bq)
