def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

class A: pass
a = A()
print(A.__name__, A.__qualname__, A.__module__, A.__bases__, A.__mro__, type(A), type(a) is A, a.__class__ is A, isinstance(a, A), isinstance(a, object), issubclass(A, object), A.__doc__, a.__dict__, repr(A), str(A), A.__base__, callable(A), bool(a), a == a, a != a, a == A(), hash(a) == hash(a), A.__dict__["__module__"], sorted(A.__dict__))
a.x = 1; a.y = [2]; print(a.x, a.y, a.__dict__, vars(a), hasattr(a, "x"), hasattr(a, "z"), getattr(a, "x"), getattr(a, "z", "dflt")); del a.x; print(a.__dict__, hasattr(a, "x")); setattr(a, "w", 3); print(a.w); delattr(a, "w"); print(a.__dict__)
t(lambda: a.nope)
t(lambda: A.nope)
def d1(): del a.nope
def d2(): del A.nope
t(d1); t(d2)
t(lambda: getattr(a, "nope"))
t(lambda: getattr(a, 1))
t(lambda: setattr(a, 1, 2))
t(lambda: delattr(a, "nope"))
t(lambda: hasattr(a, 1))
t(lambda: A(1))
t(lambda: A(x=1))
t(lambda: a())
t(lambda: a + 1)
t(lambda: a < a)
t(lambda: len(a))
t(lambda: a[0])
t(lambda: iter(a))
t(lambda: int(a))
t(lambda: -a)
t(lambda: 1 in a)
def si(): a[0] = 1
def di(): del a[0]
t(si); t(di)
class P:
    "Doc of P"
    count = 0
    names = []
    def __init__(self, x, y=0):
        self.x = x; self.y = y; P.count += 1
    def dist(self): return (self.x ** 2 + self.y ** 2) ** 0.5
    def move(self, dx, dy=0):
        self.x += dx; self.y += dy; return self
    def __repr__(self): return "P(%r, %r)" % (self.x, self.y)
p = P(3, 4); q = P(1)
print(p, q, p.dist(), p.move(1, 1), p.move(1).move(1), P.count, p.count, P.__doc__, p.__doc__, p.__dict__, P.dist(p), P.__init__.__name__, [p, q], (p,), {"k": p}, str(p), "%s %r" % (p, p), f"{p} {p!r}")
t(lambda: P())
t(lambda: P(1, 2, 3))
t(lambda: P(z=1))
t(lambda: p.dist(1))
t(lambda: P.dist())
t(lambda: P.move(p))
# Class attributes against instance attributes.
p.count = 100; print(p.count, q.count, P.count); del p.count; print(p.count); P.count = 7; print(p.count, q.count)
p.names.append("shared"); print(q.names, P.names); p.names = ["own"]; print(p.names, q.names)
P.new_attr = "added"; print(p.new_attr, q.new_attr); del P.new_attr; t(lambda: p.new_attr)
P.shout = lambda self: "x=%d" % self.x; print(p.shout(), q.shout())
p.dist = lambda: "instance attribute wins"; print(p.dist(), q.dist()); del p.dist; print(p.dist())
def external(self, k): return self.x * k
P.times = external; print(p.times(2), P.times(p, 3), p.times.__func__ is external, p.times.__self__ is p)
p.func = external; t(lambda: p.func(2)); print(p.func(q, 2))
# The body is executed like a function body, in order.
class B:
    print("in body", end="; ")
    a = 1; b = a + 1
    for i in range(3): pass
    if b > 1: c = "yes"
    else: c = "no"
    def m(self): return self.b
    n = m
    l = [1, 2, 3]; s = sum(l)
    try: e = 1 / 0
    except ZeroDivisionError: e = "caught"
    del a
print(B.b, B.i, B.c, B().n(), B.s, B.e, hasattr(B, "a"), B.m is B.n, [k for k in B.__dict__ if not k.startswith("__")])
class Empty: ...
class WithPass: pass
class WithDoc: "only doc"
class OneLine: x = 1; y = 2
print(Empty.__doc__, WithDoc.__doc__, OneLine.x + OneLine.y, Empty().__dict__)
class Parens(): pass
print(Parens.__bases__)
# Classes are values.
def make(n):
    class Local:
        v = n
        def get(self): return n
    return Local
L1 = make(1); L2 = make(2); print(L1.v, L2.v, L1().get(), L2().get(), L1 is L2, L1.__name__, L1.__qualname__, L1 == L1, L1 != L2, hash(L1) == hash(L1), {L1: 1}[L1])
classes = [A, P, int, str]; print([c.__name__ for c in classes], [c for c in classes if issubclass(c, (int, A))])
Alias = P; print(Alias(0).x, Alias is P, Alias.__name__)
class Outer:
    class Inner:
        v = "inner"
        class Deep: pass
    def make(self): return self.Inner()
print(Outer.Inner.v, Outer().make().v, Outer.Inner.__qualname__, Outer.Inner.Deep.__qualname__, Outer.Inner.__name__, repr(Outer.Inner.Deep))
A.__name__ = "Renamed"; print(A.__name__, repr(A), A.__qualname__); A.__qualname__ = "Q.Renamed"; print(repr(A)); A.__module__ = "mod"; print(repr(A), A.__module__); A.__doc__ = "new"; print(A.__doc__)
def s1(): A.__name__ = 1
def s2(): A.__qualname__ = 1
def s3(): del A.__name__
def s4(): A.__dict__ = {}
def s5(): A.__dict__["x"] = 1
def s6(): A.__mro__ = ()
def s7(): int.x = 1
def s8(): del int.real
def s9(): int.__name__ = "x"
def s10(): object.x = 1
def s11(): A.__name__ = "a\0b"
def s12(): del A.__dict__
def s13(): A.__bases__ = ()
def s14(): A.__base__ = int
for s in (s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14): t(s)
print(type(A.__dict__).__name__, "__dict__" in A.__dict__, "__weakref__" in A.__dict__, type(A.__dict__["__dict__"]).__name__, A.__dict__["__dict__"].__name__, A.__dict__["__dict__"].__objclass__ is A)
a = A(); a.__dict__ = {"k": "v"}; print(a.k, a.__dict__); a.__dict__["j"] = 1; print(a.j); a.__dict__.clear(); print(hasattr(a, "k"))
def sd(): a.__dict__ = 1
def dd(): del a.__dict__; return a.__dict__
t(sd); t(dd)
class X: pass
class Y: pass
x = X(); x.v = 1; x.__class__ = Y; print(type(x).__name__, x.v, isinstance(x, Y), isinstance(x, X))
def sc1(): x.__class__ = int
def sc2(): x.__class__ = 1
def sc3(): (1).__class__ = X
def sc4(): del x.__class__
def sc5(): [].__class__ = X
t(sc1); t(sc2); t(sc3); t(sc4); t(sc5)
print(dir(X()) == dir(X), "v" in dir(x), [n for n in dir(P(0)) if not n.startswith("__")], sorted(set(dir(object))) == dir(object), len(dir(object)) > 20, "__init__" in dir(A))
print(object(), object)[0:0] if False else print(repr(object)[:15], type(object()), object.__bases__, object.__mro__, object.__base__, object.__doc__ is not None, object.__name__, object().__class__, object.__module__, type(type), type.__bases__, type(object), isinstance(type, object), isinstance(object, type), issubclass(type, object))
o = object()
def so(): o.x = 1
t(so); t(lambda: o.__dict__); t(lambda: object(1)); t(lambda: object(x=1)); t(lambda: o.x)
print(o == o, o != o, o == object(), hash(o) == hash(o), bool(o), o.__eq__(o), o.__eq__(1), o.__ne__(o), o.__ne__(1), o.__lt__(o), o.__init__(), o.__dir__() == dir(o) or sorted(o.__dir__()) == dir(o), o.__sizeof__() > 0, o.__format__(""[:0])[:7], o.__reduce_ex__(2)[0].__name__, o.__init_subclass__(), o.__subclasshook__(int), o.__getstate__())
