def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)
def names(c): return [k.__name__ for k in c.__mro__]

class A:
    v = "A.v"
    def who(self): return "A"
    def only_a(self): return "only_a via " + self.who()
class B(A):
    def who(self): return "B"
class C(A):
    v = "C.v"
    def who(self): return "C"
class D(B, C): pass
print(names(D), D().who(), D.v, D().only_a(), D.__bases__, D.__base__, B.__base__, isinstance(D(), A), issubclass(D, C), issubclass(B, C), issubclass(A, D), A.__subclasses__(), B.__subclasses__(), D.__subclasses__(), D.mro() == list(D.__mro__))
class E(C, B): pass
print(names(E), E().who())
class F(D): pass
class G(F, C): pass
print(names(G))
t(lambda: type("X", (A, B), {}))
t(lambda: type("X", (D, E), {}))
t(lambda: type("X", (A, A), {}))
t(lambda: type("X", (object, A), {}))
t(lambda: type("X", (B, C, A, D), {}))
def c1():
    class X(A, B): pass
def c2():
    class X(1): pass
def c3():
    class X("a"): pass
def c4():
    class X(None): pass
def c5():
    class X(bool): pass
def c6():
    class X(int, str): pass
def c7():
    class X(type(None)): pass
def c8():
    class X(type(lambda: 0)): pass
def c9():
    class X(list, dict): pass
def c10():
    class X(A()): pass
def c11():
    class X(range): pass
def c12():
    class X(int, float): pass
def c13():
    class X(slice): pass
def c14():
    class X(type(...)): pass
def c15():
    class X(BaseException, int): pass
def c16():
    class X(tuple, list): pass
for c in (c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14, c15, c16): t(c)
class O1: pass
class O2: pass
class O3: pass
class K1(O1, O2, O3): pass
class K2(O2, O3): pass
class K3(O3, O1): pass
t(lambda: names(type("Z", (K1, K2, K3), {})))
class K3b(O1, O3): pass
print(names(type("Z", (K1, K2, K3b), {})))
class M1(int, A): pass
class M2(A, int): pass
class M3(dict, A): pass
class M4(A, list): pass
class M5(Exception, A): pass
print(names(M1), names(M2), M1(5) + 1, M2(5).who(), M3(a=1), M4([1]).who(), M4([1]), M1.__base__, M2.__base__, M4.__base__, M5("e").who(), M5.__base__)
# Calling the base explicitly.
class Base:
    def __init__(self, a): self.a = a
    def desc(self): return "Base(%s)" % self.a
class Child(Base):
    def __init__(self, a, b):
        Base.__init__(self, a); self.b = b
    def desc(self): return "Child(%s) < %s" % (self.b, Base.desc(self))
print(Child(1, 2).desc(), Child(1, 2).__dict__)
class NoInit(Base): pass
print(NoInit(5).a); t(lambda: NoInit())
# super()
class S1:
    def __init__(self): self.log = ["S1"]
    def f(self): return ["S1.f"]
    @classmethod
    def cm(cls): return ["S1.cm", cls.__name__]
    @staticmethod
    def sm(): return ["S1.sm"]
    p = property(lambda self: "S1.p")
    attr = "S1.attr"
class S2(S1):
    def __init__(self): super().__init__(); self.log.append("S2")
    def f(self): return ["S2.f"] + super().f()
    @classmethod
    def cm(cls): return ["S2.cm"] + super().cm()
    @staticmethod
    def sm(): return ["S2.sm"] + super(S2, S2).sm()
    p = property(lambda self: "S2.p>" + super().p) if False else property(lambda self: "S2.p>" + super(S2, self).p)
    attr = "S2.attr"
    def get_attr(self): return super().attr
class S3(S1):
    def __init__(self): super().__init__(); self.log.append("S3")
    def f(self): return ["S3.f"] + super().f()
class S4(S2, S3):
    def __init__(self): super().__init__(); self.log.append("S4")
    def f(self): return ["S4.f"] + super().f()
s = S4(); print(s.log, s.f(), S4.cm(), s.cm(), S4.sm(), s.p, s.get_attr(), S2().f(), names(S4))
print(super(S2, s).f(), super(S3, s).f(), super(S4, s).f(), super(S2, S4).f(s), super(S2, S4).cm(), super(S4, S4).attr, super(S2, s).attr)
t(lambda: super(S1, s).f())
t(lambda: super(S1, s).nope)
t(lambda: super(S4, s).nope)
t(lambda: super(S4, S1()))
t(lambda: super(S4, S1))
t(lambda: super(1, s))
t(lambda: super(S4, 1))
t(lambda: super())
t(lambda: super(S4, s, 1))
t(lambda: super(x=1))
def no_class(): return super()
t(no_class)
def no_class_arg(self): return super().f()
t(lambda: no_class_arg(s))
class NoArgs:
    def m(): return super()
    def deleted(self):
        del self
        return super()
    @staticmethod
    def st(): return super()
    @staticmethod
    def st2(x): return super()
t(NoArgs.m); t(NoArgs().deleted); t(NoArgs.st); t(lambda: NoArgs.st2(1)); t(lambda: type(NoArgs.st2(NoArgs())).__name__)
su = super(S2, s); print(su.__thisclass__.__name__, su.__self__ is s, su.__self_class__.__name__, type(su).__name__, repr(su).replace(" object", ""), repr(super(S2)), super(S2).__self__, su.__class__, su.__doc__ is not None or True)
def ssu(): su.x = 1
t(ssu)
un = super(S2); print(un.__get__(s, S4).f(), type(un.__get__(None, S4)).__name__)
class UsesClassCell:
    def m(self): return __class__
    def n(self): return __class__.__name__, super().__init__.__name__
    @classmethod
    def c(cls): return __class__ is cls
    def nested(self):
        def inner(): return __class__
        return inner()
    def lam(self): return (lambda: super().__repr__()[:5])()
    def comp(self): return [super().__class__.__name__ for _ in range(1)]
    def gen(self): return list(super().__class__.__name__ for _ in range(1))
class SubCell(UsesClassCell): pass
print(UsesClassCell().m().__name__, SubCell().m().__name__, UsesClassCell().n(), UsesClassCell.c(), SubCell.c(), SubCell().nested().__name__, UsesClassCell.m.__code__.co_freevars, UsesClassCell.m.__closure__[0].cell_contents.__name__)
t(lambda: __class__)
t(UsesClassCell().lam); t(UsesClassCell().comp); t(UsesClassCell().gen)
# super in methods added later does not work; with explicit arguments it does.
def late(self): return super().f()
S4.late = late; t(lambda: s.late())
def late2(self): return super(S4, self).f()
S4.late2 = late2; print(s.late2())
# Operators through super.
class MyList(list):
    def __getitem__(self, i): return ("got", super().__getitem__(i))
    def __len__(self): return super().__len__() * 10
    def append(self, v): super().append(v * 2)
    def __add__(self, o): return MyList(super().__add__(o))
    def __repr__(self): return "MyList" + super().__repr__()
    def __eq__(self, o): return "eq called"
    __hash__ = None
m = MyList([1, 2]); m.append(3); print(m, m[0], len(m), m + [9], m == 1, list(m), [v for v in m], m.copy(), type(m + []), type(m * 2), m * 2, sorted(m), m[0:1], bool(MyList()), m.__class__.__mro__)
t(lambda: super(MyList, m)[0])
t(lambda: len(super(MyList, m)))
t(lambda: super(MyList, m) + [1])
# __bases__ can be changed.
class R1:
    def f(self): return "R1"
class R2:
    def f(self): return "R2"
class R(R1): pass
r = R(); print(r.f(), names(R)); R.__bases__ = (R2,); print(r.f(), names(R), R1.__subclasses__(), R2.__subclasses__()); R.__bases__ = (R1, R2); print(r.f(), names(R))
def b1(): R.__bases__ = (int,)
def b2(): R.__bases__ = (R,)
def b3(): R.__bases__ = [R1]
def b4(): R.__bases__ = (1,)
def b5(): R.__bases__ = ()
def b6(): R.__bases__ = (R1, R1)
def b7(): R1.__bases__ = (R,)
def b8(): del R.__bases__
def b9(): R1.__bases__ = (R2,)
for b in (b1, b2, b3, b4, b5, b6, b7, b8, b9): t(b)
print(isinstance(1, (int, str)), isinstance("a", (int, str)), isinstance(1.5, (int, str)), isinstance(1, ()), isinstance(1, (str, (float, (int,)))), issubclass(bool, (str, int)), issubclass(int, ()), isinstance(1, int | str), isinstance(None, int | None), issubclass(int, int | str), isinstance(True, int), isinstance(D(), (B, str)), isinstance(D, type), isinstance(1, object), issubclass(D, D))
t(lambda: isinstance(1, 1)); t(lambda: isinstance(1, "int")); t(lambda: isinstance(1, [int])); t(lambda: isinstance(1, (int, 1))); t(lambda: isinstance("a", (int, 1))); t(lambda: issubclass(1, int)); t(lambda: issubclass(int, 1)); t(lambda: issubclass(int, (int, 1))); t(lambda: issubclass(str, (int, 1))); t(lambda: isinstance(1)); t(lambda: issubclass(int, [int])); t(lambda: isinstance(1, list[int])); t(lambda: issubclass(int, list[int])); t(lambda: isinstance(1, int | list[int])); t(lambda: issubclass("a", int | str))
