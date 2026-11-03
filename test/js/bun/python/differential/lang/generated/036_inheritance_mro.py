try:
    def t(f):
        try:
            print(repr(f()))
        except Exception as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')
try:
    def names(c): return [k.__name__ for k in c.__mro__]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def names(c): return [k.__name__ for k in c.__mro__]')

try:
    class A:
        v = "A.v"
        def who(self): return "A"
        def only_a(self): return "only_a via " + self.who()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A:')
try:
    class B(A):
        def who(self): return "B"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class B(A):')
try:
    class C(A):
        v = "C.v"
        def who(self): return "C"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C(A):')
try:
    class D(B, C): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class D(B, C): pass')
try: print('names(D) =>', names(D))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names(D)')
try: print('D().who() =>', D().who())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: D().who()')
try: print('D.v =>', D.v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: D.v')
try: print('D().only_a() =>', D().only_a())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: D().only_a()')
try: print('D.__bases__ =>', D.__bases__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: D.__bases__')
try: print('D.__base__ =>', D.__base__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: D.__base__')
try: print('B.__base__ =>', B.__base__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: B.__base__')
try: print('isinstance(D(), A) =>', isinstance(D(), A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(D(), A)')
try: print('issubclass(D, C) =>', issubclass(D, C))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: issubclass(D, C)')
try: print('issubclass(B, C) =>', issubclass(B, C))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: issubclass(B, C)')
try: print('issubclass(A, D) =>', issubclass(A, D))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: issubclass(A, D)')
try: print('A.__subclasses__() =>', A.__subclasses__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.__subclasses__()')
try: print('B.__subclasses__() =>', B.__subclasses__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: B.__subclasses__()')
try: print('D.__subclasses__() =>', D.__subclasses__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: D.__subclasses__()')
try: print('D.mro() == list(D.__mro__) =>', D.mro() == list(D.__mro__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: D.mro() == list(D.__mro__)')
try:
    class E(C, B): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E(C, B): pass')
try: print('names(E) =>', names(E))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names(E)')
try: print('E().who() =>', E().who())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E().who()')
try:
    class F(D): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class F(D): pass')
try:
    class G(F, C): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class G(F, C): pass')
try: print(names(G))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names(G)')
try: print('type("X", (A, B), {}) =>', end=" "); t(lambda: type("X", (A, B), {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (A, B), {}))')
try: print('type("X", (D, E), {}) =>', end=" "); t(lambda: type("X", (D, E), {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (D, E), {}))')
try: print('type("X", (A, A), {}) =>', end=" "); t(lambda: type("X", (A, A), {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (A, A), {}))')
try: print('type("X", (object, A), {}) =>', end=" "); t(lambda: type("X", (object, A), {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (object, A), {}))')
try: print('type("X", (B, C, A, D), {}) =>', end=" "); t(lambda: type("X", (B, C, A, D), {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (B, C, A, D), {}))')
try:
    def c1():
        class X(A, B): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c1():')
try:
    def c2():
        class X(1): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c2():')
try:
    def c3():
        class X("a"): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c3():')
try:
    def c4():
        class X(None): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c4():')
try:
    def c5():
        class X(bool): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c5():')
try:
    def c6():
        class X(int, str): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c6():')
try:
    def c7():
        class X(type(None)): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c7():')
try:
    def c8():
        class X(type(lambda: 0)): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c8():')
try:
    def c9():
        class X(list, dict): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c9():')
try:
    def c10():
        class X(A()): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c10():')
try:
    def c11():
        class X(range): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c11():')
try:
    def c12():
        class X(int, float): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c12():')
try:
    def c13():
        class X(slice): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c13():')
try:
    def c14():
        class X(type(...)): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c14():')
try:
    def c15():
        class X(BaseException, int): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c15():')
try:
    def c16():
        class X(tuple, list): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c16():')
try:
    for c in (c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14, c15, c16): t(c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for c in (c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14...')
try:
    class O1: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class O1: pass')
try:
    class O2: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class O2: pass')
try:
    class O3: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class O3: pass')
try:
    class K1(O1, O2, O3): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class K1(O1, O2, O3): pass')
try:
    class K2(O2, O3): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class K2(O2, O3): pass')
try:
    class K3(O3, O1): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class K3(O3, O1): pass')
try: print('names(type("Z", (K1, K2, K3), {})) =>', end=" "); t(lambda: names(type("Z", (K1, K2, K3), {})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: names(type("Z", (K1, K2, K3), {})))')
try:
    class K3b(O1, O3): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class K3b(O1, O3): pass')
try: print(names(type("Z", (K1, K2, K3b), {})))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names(type("Z", (K1, K2, K3b), {}))')
try:
    class M1(int, A): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M1(int, A): pass')
try:
    class M2(A, int): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M2(A, int): pass')
try:
    class M3(dict, A): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M3(dict, A): pass')
try:
    class M4(A, list): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M4(A, list): pass')
try:
    class M5(Exception, A): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M5(Exception, A): pass')
try: print('names(M1) =>', names(M1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names(M1)')
try: print('names(M2) =>', names(M2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names(M2)')
try: print('M1(5) + 1 =>', M1(5) + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M1(5) + 1')
try: print('M2(5).who() =>', M2(5).who())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M2(5).who()')
try: print('M3(a=1) =>', M3(a=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M3(a=1)')
try: print('M4([1]).who() =>', M4([1]).who())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M4([1]).who()')
try: print('M4([1]) =>', M4([1]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M4([1])')
try: print('M1.__base__ =>', M1.__base__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M1.__base__')
try: print('M2.__base__ =>', M2.__base__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M2.__base__')
try: print('M4.__base__ =>', M4.__base__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M4.__base__')
try: print('M5("e").who() =>', M5("e").who())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M5("e").who()')
try: print('M5.__base__ =>', M5.__base__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M5.__base__')
# Calling the base explicitly.
try:
    class Base:
        def __init__(self, a): self.a = a
        def desc(self): return "Base(%s)" % self.a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Base:')
try:
    class Child(Base):
        def __init__(self, a, b):
            Base.__init__(self, a); self.b = b
        def desc(self): return "Child(%s) < %s" % (self.b, Base.desc(self))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Child(Base):')
try: print('Child(1, 2).desc() =>', Child(1, 2).desc())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Child(1, 2).desc()')
try: print('Child(1, 2).__dict__ =>', Child(1, 2).__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Child(1, 2).__dict__')
try:
    class NoInit(Base): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoInit(Base): pass')
try: print(NoInit(5).a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: NoInit(5).a')
try: print('NoInit() =>', end=" "); t(lambda: NoInit())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: NoInit())')
# super()
try:
    class S1:
        def __init__(self): self.log = ["S1"]
        def f(self): return ["S1.f"]
        @classmethod
        def cm(cls): return ["S1.cm", cls.__name__]
        @staticmethod
        def sm(): return ["S1.sm"]
        p = property(lambda self: "S1.p")
        attr = "S1.attr"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class S1:')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class S2(S1):')
try:
    class S3(S1):
        def __init__(self): super().__init__(); self.log.append("S3")
        def f(self): return ["S3.f"] + super().f()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class S3(S1):')
try:
    class S4(S2, S3):
        def __init__(self): super().__init__(); self.log.append("S4")
        def f(self): return ["S4.f"] + super().f()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class S4(S2, S3):')
try: s = S4()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s = S4()')
try: print('s.log =>', s.log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s.log')
try: print('s.f() =>', s.f())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s.f()')
try: print('S4.cm() =>', S4.cm())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: S4.cm()')
try: print('s.cm() =>', s.cm())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s.cm()')
try: print('S4.sm() =>', S4.sm())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: S4.sm()')
try: print('s.p =>', s.p)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s.p')
try: print('s.get_attr() =>', s.get_attr())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s.get_attr()')
try: print('S2().f() =>', S2().f())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: S2().f()')
try: print('names(S4) =>', names(S4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names(S4)')
try: print('super(S2, s).f() =>', super(S2, s).f())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: super(S2, s).f()')
try: print('super(S3, s).f() =>', super(S3, s).f())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: super(S3, s).f()')
try: print('super(S4, s).f() =>', super(S4, s).f())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: super(S4, s).f()')
try: print('super(S2, S4).f(s) =>', super(S2, S4).f(s))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: super(S2, S4).f(s)')
try: print('super(S2, S4).cm() =>', super(S2, S4).cm())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: super(S2, S4).cm()')
try: print('super(S4, S4).attr =>', super(S4, S4).attr)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: super(S4, S4).attr')
try: print('super(S2, s).attr =>', super(S2, s).attr)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: super(S2, s).attr')
try: print('super(S1, s).f() =>', end=" "); t(lambda: super(S1, s).f())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: super(S1, s).f())')
try: print('super(S1, s).nope =>', end=" "); t(lambda: super(S1, s).nope)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: super(S1, s).nope)')
try: print('super(S4, s).nope =>', end=" "); t(lambda: super(S4, s).nope)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: super(S4, s).nope)')
try: print('super(S4, S1()) =>', end=" "); t(lambda: super(S4, S1()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: super(S4, S1()))')
try: print('super(S4, S1) =>', end=" "); t(lambda: super(S4, S1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: super(S4, S1))')
try: print('super(1, s) =>', end=" "); t(lambda: super(1, s))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: super(1, s))')
try: print('super(S4, 1) =>', end=" "); t(lambda: super(S4, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: super(S4, 1))')
try: print('super() =>', end=" "); t(lambda: super())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: super())')
try: print('super(S4, s, 1) =>', end=" "); t(lambda: super(S4, s, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: super(S4, s, 1))')
try: print('super(x=1) =>', end=" "); t(lambda: super(x=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: super(x=1))')
try:
    def no_class(): return super()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def no_class(): return super()')
try: print('no_class() =>', end=" "); t(no_class)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(no_class)')
try:
    def no_class_arg(self): return super().f()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def no_class_arg(self): return super().f()')
try: print('no_class_arg(s) =>', end=" "); t(lambda: no_class_arg(s))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: no_class_arg(s))')
try:
    class NoArgs:
        def m(): return super()
        def deleted(self):
            del self
            return super()
        @staticmethod
        def st(): return super()
        @staticmethod
        def st2(x): return super()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoArgs:')
try: print('NoArgs.m() =>', end=" "); t(NoArgs.m)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(NoArgs.m)')
try: print('NoArgs().deleted() =>', end=" "); t(NoArgs().deleted)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(NoArgs().deleted)')
try: print('NoArgs.st() =>', end=" "); t(NoArgs.st)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(NoArgs.st)')
try: print('NoArgs.st2(1) =>', end=" "); t(lambda: NoArgs.st2(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: NoArgs.st2(1))')
try: print('type(NoArgs.st2(NoArgs())).__name__ =>', end=" "); t(lambda: type(NoArgs.st2(NoArgs())).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(NoArgs.st2(NoArgs())).__name__)')
try: su = super(S2, s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: su = super(S2, s)')
try: print('su.__thisclass__.__name__ =>', su.__thisclass__.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: su.__thisclass__.__name__')
try: print('su.__self__ is s =>', su.__self__ is s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: su.__self__ is s')
try: print('su.__self_class__.__name__ =>', su.__self_class__.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: su.__self_class__.__name__')
try: print('type(su).__name__ =>', type(su).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(su).__name__')
try: print('repr(su).replace(" object", "") =>', repr(su).replace(" object", ""))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(su).replace(" object", "")')
try: print('repr(super(S2)) =>', repr(super(S2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(super(S2))')
try: print('super(S2).__self__ =>', super(S2).__self__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: super(S2).__self__')
try: print('su.__class__ =>', su.__class__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: su.__class__')
try: print('su.__doc__ is not None or True =>', su.__doc__ is not None or True)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: su.__doc__ is not None or True')
try:
    def ssu(): su.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ssu(): su.x = 1')
try: print('ssu() =>', end=" "); t(ssu)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(ssu)')
try: un = super(S2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: un = super(S2)')
try: print('un.__get__(s, S4).f() =>', un.__get__(s, S4).f())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: un.__get__(s, S4).f()')
try: print('type(un.__get__(None, S4)).__name__ =>', type(un.__get__(None, S4)).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(un.__get__(None, S4)).__name__')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class UsesClassCell:')
try:
    class SubCell(UsesClassCell): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SubCell(UsesClassCell): pass')
try: print('UsesClassCell().m().__name__ =>', UsesClassCell().m().__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: UsesClassCell().m().__name__')
try: print('SubCell().m().__name__ =>', SubCell().m().__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: SubCell().m().__name__')
try: print('UsesClassCell().n() =>', UsesClassCell().n())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: UsesClassCell().n()')
try: print('UsesClassCell.c() =>', UsesClassCell.c())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: UsesClassCell.c()')
try: print('SubCell.c() =>', SubCell.c())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: SubCell.c()')
try: print('SubCell().nested().__name__ =>', SubCell().nested().__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: SubCell().nested().__name__')
try: print('UsesClassCell.m.__code__.co_freevars =>', UsesClassCell.m.__code__.co_freevars)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: UsesClassCell.m.__code__.co_freevars')
try: print('UsesClassCell.m.__closure__[0].cell_contents.__name__ =>', UsesClassCell.m.__closure__[0].cell_contents.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: UsesClassCell.m.__closure__[0].cell_contents.__name__')
try: print('__class__ =>', end=" "); t(lambda: __class__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: __class__)')
try: print('UsesClassCell().lam() =>', end=" "); t(UsesClassCell().lam)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(UsesClassCell().lam)')
try: print('UsesClassCell().comp() =>', end=" "); t(UsesClassCell().comp)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(UsesClassCell().comp)')
try: print('UsesClassCell().gen() =>', end=" "); t(UsesClassCell().gen)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(UsesClassCell().gen)')
# super in methods added later does not work; with explicit arguments it does.
try:
    def late(self): return super().f()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def late(self): return super().f()')
try: S4.late = late
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: S4.late = late')
try: print('s.late() =>', end=" "); t(lambda: s.late())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: s.late())')
try:
    def late2(self): return super(S4, self).f()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def late2(self): return super(S4, self).f()')
try: S4.late2 = late2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: S4.late2 = late2')
try: print(s.late2())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s.late2()')
# Operators through super.
try:
    class MyList(list):
        def __getitem__(self, i): return ("got", super().__getitem__(i))
        def __len__(self): return super().__len__() * 10
        def append(self, v): super().append(v * 2)
        def __add__(self, o): return MyList(super().__add__(o))
        def __repr__(self): return "MyList" + super().__repr__()
        def __eq__(self, o): return "eq called"
        __hash__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class MyList(list):')
try: m = MyList([1, 2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m = MyList([1, 2])')
try: m.append(3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.append(3)')
try: print('m =>', m)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m')
try: print('m[0] =>', m[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m[0]')
try: print('len(m) =>', len(m))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(m)')
try: print('m + [9] =>', m + [9])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m + [9]')
try: print('m == 1 =>', m == 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m == 1')
try: print('list(m) =>', list(m))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(m)')
try: print('[v for v in m] =>', [v for v in m])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [v for v in m]')
try: print('m.copy() =>', m.copy())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.copy()')
try: print('type(m + []) =>', type(m + []))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(m + [])')
try: print('type(m * 2) =>', type(m * 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(m * 2)')
try: print('m * 2 =>', m * 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m * 2')
try: print('sorted(m) =>', sorted(m))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(m)')
try: print('m[0:1] =>', m[0:1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m[0:1]')
try: print('bool(MyList()) =>', bool(MyList()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool(MyList())')
try: print('m.__class__.__mro__ =>', m.__class__.__mro__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m.__class__.__mro__')
try: print('super(MyList, m)[0] =>', end=" "); t(lambda: super(MyList, m)[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: super(MyList, m)[0])')
try: print('len(super(MyList, m)) =>', end=" "); t(lambda: len(super(MyList, m)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: len(super(MyList, m)))')
try: print('super(MyList, m) + [1] =>', end=" "); t(lambda: super(MyList, m) + [1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: super(MyList, m) + [1])')
# __bases__ can be changed.
try:
    class R1:
        def f(self): return "R1"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class R1:')
try:
    class R2:
        def f(self): return "R2"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class R2:')
try:
    class R(R1): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class R(R1): pass')
try: r = R()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = R()')
try: print('r.f() =>', r.f())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r.f()')
try: print('names(R) =>', names(R))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names(R)')
try: R.__bases__ = (R2,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: R.__bases__ = (R2,)')
try: print('r.f() =>', r.f())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r.f()')
try: print('names(R) =>', names(R))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names(R)')
try: print('R1.__subclasses__() =>', R1.__subclasses__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: R1.__subclasses__()')
try: print('R2.__subclasses__() =>', R2.__subclasses__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: R2.__subclasses__()')
try: R.__bases__ = (R1, R2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: R.__bases__ = (R1, R2)')
try: print('r.f() =>', r.f())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r.f()')
try: print('names(R) =>', names(R))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names(R)')
try:
    def b1(): R.__bases__ = (int,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b1(): R.__bases__ = (int,)')
try:
    def b2(): R.__bases__ = (R,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b2(): R.__bases__ = (R,)')
try:
    def b3(): R.__bases__ = [R1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b3(): R.__bases__ = [R1]')
try:
    def b4(): R.__bases__ = (1,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b4(): R.__bases__ = (1,)')
try:
    def b5(): R.__bases__ = ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b5(): R.__bases__ = ()')
try:
    def b6(): R.__bases__ = (R1, R1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b6(): R.__bases__ = (R1, R1)')
try:
    def b7(): R1.__bases__ = (R,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b7(): R1.__bases__ = (R,)')
try:
    def b8(): del R.__bases__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b8(): del R.__bases__')
try:
    def b9(): R1.__bases__ = (R2,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b9(): R1.__bases__ = (R2,)')
try:
    for b in (b1, b2, b3, b4, b5, b6, b7, b8, b9): t(b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for b in (b1, b2, b3, b4, b5, b6, b7, b8, b9): t(b)')
try: print('isinstance(1, (int, str)) =>', isinstance(1, (int, str)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(1, (int, str))')
try: print('isinstance("a", (int, str)) =>', isinstance("a", (int, str)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance("a", (int, str))')
try: print('isinstance(1.5, (int, str)) =>', isinstance(1.5, (int, str)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(1.5, (int, str))')
try: print('isinstance(1, ()) =>', isinstance(1, ()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(1, ())')
try: print('isinstance(1, (str, (float, (int,)))) =>', isinstance(1, (str, (float, (int,)))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(1, (str, (float, (int,))))')
try: print('issubclass(bool, (str, int)) =>', issubclass(bool, (str, int)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: issubclass(bool, (str, int))')
try: print('issubclass(int, ()) =>', issubclass(int, ()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: issubclass(int, ())')
try: print('isinstance(1, int | str) =>', isinstance(1, int | str))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(1, int | str)')
try: print('isinstance(None, int | None) =>', isinstance(None, int | None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(None, int | None)')
try: print('issubclass(int, int | str) =>', issubclass(int, int | str))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: issubclass(int, int | str)')
try: print('isinstance(True, int) =>', isinstance(True, int))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(True, int)')
try: print('isinstance(D(), (B, str)) =>', isinstance(D(), (B, str)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(D(), (B, str))')
try: print('isinstance(D, type) =>', isinstance(D, type))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(D, type)')
try: print('isinstance(1, object) =>', isinstance(1, object))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(1, object)')
try: print('issubclass(D, D) =>', issubclass(D, D))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: issubclass(D, D)')
try: print('isinstance(1, 1) =>', end=" "); t(lambda: isinstance(1, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: isinstance(1, 1))')
try: print('isinstance(1, "int") =>', end=" "); t(lambda: isinstance(1, "int"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: isinstance(1, "int"))')
try: print('isinstance(1, [int]) =>', end=" "); t(lambda: isinstance(1, [int]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: isinstance(1, [int]))')
try: print('isinstance(1, (int, 1)) =>', end=" "); t(lambda: isinstance(1, (int, 1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: isinstance(1, (int, 1)))')
try: print('isinstance("a", (int, 1)) =>', end=" "); t(lambda: isinstance("a", (int, 1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: isinstance("a", (int, 1)))')
try: print('issubclass(1, int) =>', end=" "); t(lambda: issubclass(1, int))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: issubclass(1, int))')
try: print('issubclass(int, 1) =>', end=" "); t(lambda: issubclass(int, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: issubclass(int, 1))')
try: print('issubclass(int, (int, 1)) =>', end=" "); t(lambda: issubclass(int, (int, 1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: issubclass(int, (int, 1)))')
try: print('issubclass(str, (int, 1)) =>', end=" "); t(lambda: issubclass(str, (int, 1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: issubclass(str, (int, 1)))')
try: print('isinstance(1) =>', end=" "); t(lambda: isinstance(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: isinstance(1))')
try: print('issubclass(int, [int]) =>', end=" "); t(lambda: issubclass(int, [int]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: issubclass(int, [int]))')
try: print('isinstance(1, list[int]) =>', end=" "); t(lambda: isinstance(1, list[int]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: isinstance(1, list[int]))')
try: print('issubclass(int, list[int]) =>', end=" "); t(lambda: issubclass(int, list[int]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: issubclass(int, list[int]))')
try: print('isinstance(1, int | list[int]) =>', end=" "); t(lambda: isinstance(1, int | list[int]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: isinstance(1, int | list[int]))')
try: print('issubclass("a", int | str) =>', end=" "); t(lambda: issubclass("a", int | str))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: issubclass("a", int | str))')
