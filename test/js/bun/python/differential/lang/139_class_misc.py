def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

# __abstractmethods__ is what makes a class abstract; no abc module is needed for the core mechanism.
class Abs:
    def f(self): pass
    def g(self): pass
Abs.__abstractmethods__ = frozenset({"f"})
t(Abs); Abs.__abstractmethods__ = frozenset({"g", "f"}); t(Abs); Abs.__abstractmethods__ = frozenset({"c", "a", "b"}); t(Abs); Abs.__abstractmethods__ = frozenset(); print(type(Abs()).__name__)
Abs.__abstractmethods__ = {"f"}; t(Abs); Abs.__abstractmethods__ = ["f"]; t(Abs); Abs.__abstractmethods__ = "fg"; t(Abs); Abs.__abstractmethods__ = (); print(type(Abs()).__name__, Abs.__abstractmethods__)
class AbsSub(Abs): pass
Abs.__abstractmethods__ = frozenset({"f"}); print(type(AbsSub()).__name__, "the flag is per class"); t(lambda: AbsSub.__abstractmethods__); t(lambda: object.__abstractmethods__); t(lambda: int.__abstractmethods__); t(lambda: type.__abstractmethods__)
del Abs.__abstractmethods__; print(type(Abs()).__name__); t(lambda: Abs.__abstractmethods__)
def d1(): del Abs.__abstractmethods__
def d2(): int.__abstractmethods__ = frozenset()
def d3(): Abs.__abstractmethods__ = 5
t(d1); t(d2); t(d3); t(Abs)
class AbsNew:
    def __new__(cls): return "custom __new__ that never reaches object.__new__"
AbsNew.__abstractmethods__ = frozenset({"x"}); print(AbsNew())
class AbsTuple(tuple): pass
AbsTuple.__abstractmethods__ = frozenset({"x"}); t(AbsTuple)
class AbsExc(Exception): pass
AbsExc.__abstractmethods__ = frozenset({"x"}); t(lambda: type(AbsExc()).__name__)
# __class__ assignment.
class A:
    def who(self): return "A"
class B:
    def who(self): return "B"
class C(A):
    def who(self): return "C"
o = A(); o.v = 1; o.__class__ = B; print(o.who(), type(o).__name__, isinstance(o, A), isinstance(o, B), o.v); o.__class__ = C; print(o.who(), isinstance(o, A))
for target in (int, str, object, type, 5, None, list, type("S", (), {"__slots__": ("a",)}), type("L", (list,), {}), type("E", (Exception,), {})):
    try: o.__class__ = target; print("ok", target)
    except TypeError as e: print("TypeError:", e)
def c1(): (1).__class__ = int
def c2(): [].__class__ = type("L", (list,), {})
def c3(): object().__class__ = A
def c4(): A.__class__ = type
def c5(): del o.__class__
def c6(): None.__class__ = A
def c7(): (lambda: 0).__class__ = A
for c in (c1, c2, c3, c4, c5, c6, c7): t(c)
class L1(list): pass
class L2(list):
    def first(self): return self[0]
l = L1([1, 2]); l.__class__ = L2; print(l.first(), type(l).__name__, l)
class M1(type): pass
class M2(type): pass
class WithMeta(metaclass=M1): pass
WithMeta.__class__ = M2; print(type(WithMeta).__name__)
import sys
Mod = type(sys)
class ModSub(Mod):
    @property
    def answer(self): return 42
mod = Mod("m"); mod.__class__ = ModSub; print(mod.answer, type(mod).__name__)
# __subclasses__, __subclasshook__, __bases__, __base__, __mro__.
class R: pass
class R1(R): pass
class R2(R): pass
class R11(R1): pass
print([c.__name__ for c in R.__subclasses__()], [c.__name__ for c in R1.__subclasses__()], R11.__subclasses__(), R11.__base__.__name__, R11.__bases__, [c.__name__ for c in R11.__mro__], object.__base__, object.__bases__, type.__base__, int.__base__, bool.__base__, bool.__bases__, R.__subclasshook__(R1), object.__subclasshook__(int), type(R.__subclasses__).__name__, int in object.__subclasses__(), bool in int.__subclasses__())
class Multi(R1, R2): pass
print(Multi.__base__.__name__, [c.__name__ for c in Multi.__bases__], [c.__name__ for c in R2.__subclasses__()])
class DictAndR(R, dict): pass
class IntAndR(R, int): pass
print(DictAndR.__base__, IntAndR.__base__, DictAndR.__bases__[0].__name__)
def b1(): R.__mro__ = ()
def b2(): R.__base__ = object
def b3(): del R.__bases__
def b4(): R.__bases__ = ()
def b5(): R.__bases__ = (R,)
def b6(): R.__bases__ = (R1,)
def b7(): R.__bases__ = [object]
def b8(): R.__bases__ = (1,)
def b9(): object.__bases__ = (R,)
def b10(): R.__bases__ = (int,)
for b in (b1, b2, b3, b4, b5, b6, b7, b8, b9, b10): t(b)
# Names: __name__, __qualname__, __module__, __doc__.
def outer():
    class Local:
        class Nested:
            def m(self): pass
        def m(self):
            def inner(): pass
            return inner
        lam = lambda self: 0
    return Local
Lc = outer(); print(Lc.__name__, Lc.__qualname__, Lc.Nested.__qualname__, Lc.Nested.m.__qualname__, Lc.m.__qualname__, Lc().m().__qualname__, Lc.lam.__qualname__, Lc.__module__, repr(Lc), repr(Lc.Nested), repr(Lc())[:40], repr(Lc.m)[:38])
class Doc:
    "class doc"
    def m(self):
        "method doc"
class NoDoc(Doc):
    def m(self): pass
class DocAttr: __doc__ = "explicit"
class DocProp:
    __doc__ = property(lambda self: "dynamic doc")
print(Doc.__doc__, Doc().__doc__, NoDoc.__doc__, NoDoc.m.__doc__, Doc.m.__doc__, DocAttr.__doc__, DocProp().__doc__, type(DocProp.__doc__).__name__, type(int.__doc__).__name__, type(len.__doc__).__name__, (lambda: 0).__doc__, type(object.__doc__).__name__, type(type.__doc__).__name__)
Doc.__doc__ = "changed"; print(Doc.__doc__); t(lambda: delattr(Doc, "__doc__")); print(Doc.__doc__)
def n1(): Doc.__name__ = 5
def n2(): Doc.__name__ = "a\0b"
def n3(): Doc.__qualname__ = 5
def n4(): int.__name__ = "x"
def n5(): del Doc.__name__
def n6(): del Doc.__qualname__
def n7(): int.__doc__ = "x"
def n8(): del Doc.__module__; return Doc.__module__
def n9(): int.__module__ = "x"
for n in (n1, n2, n3, n4, n5, n6, n7, n8, n9): t(n)
Doc.__name__ = "Renamed"; Doc.__qualname__ = "Q.Renamed"; Doc.__module__ = "some.mod"; print(Doc.__name__, repr(Doc), repr(Doc())[:28], Doc.m.__qualname__)
Doc.__module__ = 5; print(repr(Doc)); Doc.__module__ = "builtins"; print(repr(Doc)); Doc.__module__ = "__main__"; print(repr(Doc))
# object's own methods.
ob = object()
print(ob.__eq__(ob), ob.__eq__(1), ob.__ne__(ob), ob.__ne__(1), ob.__lt__(1), ob.__hash__() == hash(ob), ob.__repr__()[:17], ob.__str__()[:17], ob.__format__("")[:17], ob.__class__, type(ob.__doc__).__name__, ob.__init__(), ob.__dir__() == dir(ob) or sorted(ob.__dir__()) == dir(ob), ob.__sizeof__() > 0, ob.__init_subclass__(), ob.__subclasshook__(int), ob.__getstate__(), type(ob.__reduce_ex__(2)).__name__, object.__new__(object).__class__, object.__call__().__class__, object().__setattr__.__name__, object.__eq__(1, 1), object.__eq__(1, 2), object.__hash__(1) == object.__hash__(1), object.__repr__(1)[:14], object.__str__(1), object.__ne__(1, 1), object.__getattribute__(1, "real"), object.__dir__(1) == (1).__dir__())
t(lambda: object(1)); t(lambda: object(a=1)); t(lambda: object.__new__()); t(lambda: object.__new__(1)); t(lambda: object.__new__(int)); t(lambda: object.__new__(list)); t(lambda: object.__new__(type)); t(lambda: object.__init__()); t(lambda: object.__init__(ob, 1)); t(lambda: ob.__format__("x")); t(lambda: ob.__reduce_ex__()); t(lambda: ob.x); t(lambda: setattr(ob, "x", 1)); t(lambda: ob.__dict__); t(lambda: ob < ob); t(lambda: ob()); t(lambda: len(ob)); t(lambda: int.__new__(object)); t(lambda: int.__new__(str)); t(lambda: int.__new__(bool)); t(lambda: list.__new__(dict)); t(lambda: tuple.__new__(A)); t(lambda: A.__new__(int)); t(lambda: object.__new__(A).who()); t(lambda: dict.__new__(type("D", (dict,), {})))
class St:
    def __init__(self): self.a = 1; self.b = [2]
class StSlots:
    __slots__ = ("x", "y")
    def __init__(self): self.x = 1
class StBoth(StSlots):
    def __init__(self): super().__init__(); self.z = 3
class StEmpty: pass
print(St().__getstate__(), StSlots().__getstate__(), StBoth().__getstate__(), StEmpty().__getstate__(), (1).__getstate__(), "s".__getstate__(), [].__getstate__(), St().__getstate__() is not St().__dict__, St().__reduce_ex__(2)[1:], St().__reduce_ex__(4)[0].__name__, type("LS", (list,), {})([1]).__reduce_ex__(2)[1], list(type("LS", (list,), {})([1, 2]).__reduce_ex__(2)[3]), list(type("DS", (dict,), {})(a=1).__reduce_ex__(2)[4]))
# Instance dictionaries.
class P: pass
p = P(); p.a = 1; print(p.__dict__, vars(p) is p.__dict__); p.__dict__["b"] = 2; print(p.b); p.__dict__ = {"c": 3}; print(p.c, hasattr(p, "a")); d = {"shared": 1}; q1, q2 = P(), P(); q1.__dict__ = d; q2.__dict__ = d; q1.x = 5; print(q2.x, q2.__dict__ is d); del p.__dict__; print(p.__dict__); p.__dict__[1] = "non-string key"; print(p.__dict__, dir(p)[-1:] if False else "")
class DSub(dict):
    def __getitem__(self, k): return "never used for attribute lookup"
p.__dict__ = DSub(z=1); print(p.z, type(p.__dict__).__name__)
def s1(): p.__dict__ = 5
def s2(): p.__dict__ = None
def s3(): p.__dict__ = [("a", 1)]
def s4(): P.__dict__ = {}
def s5(): P.__dict__["x"] = 1
def s6(): del P.__dict__
def s7(): p.__dict__ = P.__dict__
for s in (s1, s2, s3, s4, s5, s6, s7): t(s)
print(type(P.__dict__).__name__, "__dict__" in P.__dict__, "__weakref__" in P.__dict__, type(P.__dict__["__dict__"]).__name__, P.__dict__["__dict__"].__get__(q1) is d, sorted(P.__dict__), P.__dict__.get("nope"), len(P.__dict__) == len(list(P.__dict__)), P.__dict__ == P.__dict__, P.__dict__.copy() == dict(P.__dict__), "__module__" in P.__dict__, P.__dict__["__module__"])
many = P()
for i in range(50): setattr(many, "a%d" % i, i)
for i in range(0, 50, 2): delattr(many, "a%d" % i)
print(len(many.__dict__), list(many.__dict__)[:4], many.a49, sum(many.__dict__.values()))
objs = [P() for _ in range(5)]
for i, ob_ in enumerate(objs):
    for name in ("x", "y", "z")[i % 3:] + ("x", "y", "z")[:i % 3]: setattr(ob_, name, i)
print([list(o_.__dict__) for o_ in objs])
# Class attributes versus instance attributes.
class Cnt:
    n = 0; items = []
    def bump(self): self.n += 1; self.items.append(self.n); return self
c1_, c2_ = Cnt().bump().bump(), Cnt().bump(); print(c1_.n, c2_.n, Cnt.n, Cnt.items, c1_.items is c2_.items, c1_.__dict__, "n" in Cnt.__dict__)
del c1_.n; print(c1_.n); Cnt.n = 10; print(c1_.n, c2_.n); t(lambda: delattr(c1_, "n")); Cnt.late = "added later"; print(c1_.late, c2_.late); del Cnt.late; t(lambda: c1_.late)
Cnt.bump = lambda self: "patched"; print(c1_.bump()); c1_.bump = lambda: "instance function, no self"; print(c1_.bump(), c2_.bump()); del c1_.bump; print(c1_.bump())
# Callable classes, classes as values.
classes = {"a": A, "b": B}; print([classes[k]().who() for k in sorted(classes)], [cls.__name__ for cls in (A, B, C)], (A if True else B)().who(), [k().who() for k in [A, B] * 2], sorted([C, A, B], key=lambda k: k.__name__)[0].__name__, {A: 1}[A], A == A, A != B, A is A, hash(A) == hash(A), isinstance(A, type), callable(A), type(A)("Dyn", (A,), {})().who(), max([A, B, C], key=lambda k: len(k.__mro__)).__name__)
t(lambda: A < B); t(lambda: A + B); t(lambda: A[0]); t(lambda: len(A)); t(lambda: iter(A)); t(lambda: A.who()); t(lambda: A.who(1)); t(lambda: A.who(B())); t(lambda: A().who(1)); t(lambda: A(1)); t(lambda: A.nope); t(lambda: A().nope); t(lambda: -A); t(lambda: A()()); t(lambda: A() + 1); t(lambda: A() < A()); t(lambda: int(A())); t(lambda: str(A)[:8])
