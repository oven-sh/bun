try:
    def t(f):
        try:
            print(repr(f()))
        except Exception as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try:
    class P:
        __slots__ = ("x", "y")
        def __init__(self, x, y): self.x = x; self.y = y
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class P:')
try: p = P(1, 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p = P(1, 2)')
try: print('p.x =>', p.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.x')
try: print('p.y =>', p.y)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.y')
try: print('P.__slots__ =>', P.__slots__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.__slots__')
try: print('hasattr(p, "__dict__") =>', hasattr(p, "__dict__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(p, "__dict__")')
try: print('hasattr(p, "__weakref__") =>', hasattr(p, "__weakref__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(p, "__weakref__")')
try: print('type(P.x).__name__ =>', type(P.x).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(P.x).__name__')
try: print('[k for k in P.__dict__ if not k.startswith("__")] =>', [k for k in P.__dict__ if not k.startswith("__")])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [k for k in P.__dict__ if not k.startswith("__")]')
try: print('"x" in dir(p) =>', "x" in dir(p))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "x" in dir(p)')
try: p.x = 10
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.x = 10')
try: print(p.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.x')
try: del p.x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del p.x')
try: print('p.x =>', end=" "); t(lambda: p.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: p.x)')
try: print(hasattr(p, "x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(p, "x")')
try: p.x = 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.x = 3')
try: print(p.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.x')
try:
    def s1(): p.z = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s1(): p.z = 1')
try:
    def s2(): del p.z
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s2(): del p.z')
try:
    def s3():
        del p.y; del p.y
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s3():')
try: print('s1() =>', end=" "); t(s1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s1)')
try: print('s2() =>', end=" "); t(s2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s2)')
try: print('s3() =>', end=" "); t(s3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s3)')
try: print('p.__dict__ =>', end=" "); t(lambda: p.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: p.__dict__)')
try: print('vars(p) =>', end=" "); t(lambda: vars(p))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: vars(p))')
try: print('p.nope =>', end=" "); t(lambda: p.nope)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: p.nope)')
try: q = P.__new__(P)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: q = P.__new__(P)')
try: print('q.x =>', end=" "); t(lambda: q.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: q.x)')
try: print('hasattr(q, "x") =>', hasattr(q, "x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(q, "x")')
try: print('hasattr(q, "y") =>', hasattr(q, "y"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(q, "y")')
try:
    class E: __slots__ = ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E: __slots__ = ()')
try: e = E()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e = E()')
try:
    def s4(): e.a = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s4(): e.a = 1')
try: print('s4() =>', end=" "); t(s4)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s4)')
try: print('E.__slots__ =>', E.__slots__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E.__slots__')
try: print('hasattr(e, "__dict__") =>', hasattr(e, "__dict__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(e, "__dict__")')
try:
    class S1: __slots__ = "single"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class S1: __slots__ = "single"')
try: s = S1()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s = S1()')
try: s.single = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s.single = 1')
try: print('s.single =>', s.single)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s.single')
try: print('S1.__slots__ =>', S1.__slots__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: S1.__slots__')
try:
    class SL: __slots__ = ["a", "b"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SL: __slots__ = ["a", "b"]')
try:
    class SD: __slots__ = {"a": "doc of a", "b": "doc of b"}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SD: __slots__ = {"a": "doc of a", "b": "doc of b"}')
try:
    class SG: __slots__ = (n for n in ("a", "b"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SG: __slots__ = (n for n in ("a", "b"))')
try: print('SL.__slots__ =>', SL.__slots__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: SL.__slots__')
try: print('SD.__slots__ =>', SD.__slots__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: SD.__slots__')
try: print('SD.a.__doc__ =>', SD.a.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: SD.a.__doc__')
try: print('SL.a.__doc__ =>', SL.a.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: SL.a.__doc__')
try: print('type(SG.__slots__).__name__ =>', type(SG.__slots__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(SG.__slots__).__name__')
try: print('hasattr(SG, "a") =>', hasattr(SG, "a"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(SG, "a")')
try: print('hasattr(SG, "b") =>', hasattr(SG, "b"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(SG, "b")')
try:
    class WithDict: __slots__ = ("a", "__dict__")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithDict: __slots__ = ("a", "__dict__")')
try: w = WithDict()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w = WithDict()')
try: w.a = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w.a = 1')
try: w.other = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w.other = 2')
try: print('w.a =>', w.a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w.a')
try: print('w.other =>', w.other)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w.other')
try: print('w.__dict__ =>', w.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: w.__dict__')
try:
    class WithWeak: __slots__ = ("a", "__weakref__")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithWeak: __slots__ = ("a", "__weakref__")')
try: print('hasattr(WithWeak(), "__weakref__") =>', hasattr(WithWeak(), "__weakref__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(WithWeak(), "__weakref__")')
try: print('hasattr(WithWeak(), "__dict__") =>', hasattr(WithWeak(), "__dict__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(WithWeak(), "__dict__")')
# Inheritance.
try:
    class Base: __slots__ = ("a",)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Base: __slots__ = ("a",)')
try:
    class Derived(Base): __slots__ = ("b",)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Derived(Base): __slots__ = ("b",)')
try:
    class NoSlots(Base): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoSlots(Base): pass')
try:
    class EmptySlots(Base): __slots__ = ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class EmptySlots(Base): __slots__ = ()')
try: d = Derived()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d = Derived()')
try: d.a = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d.a = 1')
try: d.b = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d.b = 2')
try: print('d.a =>', d.a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d.a')
try: print('d.b =>', d.b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: d.b')
try: print('hasattr(d, "__dict__") =>', hasattr(d, "__dict__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(d, "__dict__")')
try: print('Derived.__slots__ =>', Derived.__slots__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Derived.__slots__')
try: print('Base.__slots__ =>', Base.__slots__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base.__slots__')
try:
    def s5(): d.c = 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s5(): d.c = 3')
try: print('s5() =>', end=" "); t(s5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s5)')
try: n = NoSlots()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n = NoSlots()')
try: n.a = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.a = 1')
try: n.c = 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.c = 3')
try: print('n.a =>', n.a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.a')
try: print('n.c =>', n.c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.c')
try: print('n.__dict__ =>', n.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n.__dict__')
try: print('hasattr(n, "__weakref__") =>', hasattr(n, "__weakref__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(n, "__weakref__")')
try: es = EmptySlots()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: es = EmptySlots()')
try: es.a = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: es.a = 1')
try: print('es.a =>', es.a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: es.a')
try: print('hasattr(es, "__dict__") =>', hasattr(es, "__dict__"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(es, "__dict__")')
try:
    class Plain: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Plain: pass')
try:
    class SlotsOverPlain(Plain): __slots__ = ("s",)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SlotsOverPlain(Plain): __slots__ = ("s",)')
try: sp = SlotsOverPlain()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sp = SlotsOverPlain()')
try: sp.s = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sp.s = 1')
try: sp.t = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sp.t = 2')
try: print('sp.s =>', sp.s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sp.s')
try: print('sp.__dict__ =>', sp.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sp.__dict__')
try:
    class Shadow(Base): __slots__ = ("a",)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Shadow(Base): __slots__ = ("a",)')
try: sh = Shadow()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sh = Shadow()')
try: sh.a = "derived slot"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sh.a = "derived slot"')
try: print('sh.a =>', sh.a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sh.a')
try: print('Base.a.__get__(sh, Shadow) if False else "" =>', Base.a.__get__(sh, Shadow) if False else "")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base.a.__get__(sh, Shadow) if False else ""')
try: print('Shadow.a is Base.a =>', Shadow.a is Base.a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Shadow.a is Base.a')
try: print('Base.a.__get__(sh) =>', end=" "); t(lambda: Base.a.__get__(sh))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: Base.a.__get__(sh))')
try:
    class L1: __slots__ = ("a",)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class L1: __slots__ = ("a",)')
try:
    class L2: __slots__ = ("b",)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class L2: __slots__ = ("b",)')
try:
    class L0: __slots__ = ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class L0: __slots__ = ()')
try:
    def m1():
        class X(L1, L2): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def m1():')
try:
    def m2():
        class X(L1, L0): __slots__ = ()
        return X.__mro__[0].__name__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def m2():')
try:
    def m3():
        class X(L1, Plain): pass
        x = X(); x.a = 1; x.z = 2; return x.a, x.__dict__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def m3():')
try:
    def m4():
        class X(L1, int): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def m4():')
try:
    def m5():
        class X(L0, int): __slots__ = ()
        return X(5) + 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def m5():')
try:
    def m6():
        class X(int): __slots__ = ("a",)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def m6():')
try:
    def m7():
        class X(tuple): __slots__ = ("a",)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def m7():')
try:
    def m8():
        class X(list): __slots__ = ("a",)
        x = X([1]); x.a = 2; return x, x.a, hasattr(x, "__dict__")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def m8():')
try:
    def m9():
        class X(dict): __slots__ = ()
        x = X(a=1)
        try: x.z = 1
        except AttributeError as e: return x, str(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def m9():')
try:
    def m10():
        class X(str): __slots__ = ("a",)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def m10():')
try:
    def m11():
        class X(bytes): __slots__ = ("a",)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def m11():')
try:
    def m12():
        class X(float): __slots__ = ("a",)
        x = X(1.5); x.a = 1; return x, x.a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def m12():')
try:
    def m13():
        class X(Exception): __slots__ = ("a",)
        x = X("m"); x.a = 1; x.b = 2; return x.a, x.b
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def m13():')
try:
    def m14():
        class X(type): __slots__ = ("a",)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def m14():')
try:
    def m15():
        class X(object): __slots__ = ("a",)
        class Y(X): __slots__ = ("b",)
        class Z(X): __slots__ = ("c",)
        class W(Y, Z): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def m15():')
try:
    for m in (m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15): t(m)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for m in (m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14...')
# Invalid declarations.
try:
    def b(slots, **extra):
        def make(): return type("X", (), {"__slots__": slots, **extra}).__name__
        return make
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def b(slots, **extra):')
try: print('b(("a", "a"))() =>', end=" "); t(b(("a", "a")) )
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b(("a", "a")) )')
try: print('b((1,))() =>', end=" "); t(b((1,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b((1,)))')
try: print('b(("1a",))() =>', end=" "); t(b(("1a",)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b(("1a",)))')
try: print('b(("a b",))() =>', end=" "); t(b(("a b",)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b(("a b",)))')
try: print('b(("",))() =>', end=" "); t(b(("",)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b(("",)))')
try: print('b(1)() =>', end=" "); t(b(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b(1))')
try: print('b(None)() =>', end=" "); t(b(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b(None))')
try: print('b(("a",), a=1)() =>', end=" "); t(b(("a",), a=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b(("a",), a=1))')
try: print('b(("__dict__", "__dict__"))() =>', end=" "); t(b(("__dict__", "__dict__")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b(("__dict__", "__dict__")))')
try: print('b(("__weakref__", "__weakref__"))() =>', end=" "); t(b(("__weakref__", "__weakref__")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b(("__weakref__", "__weakref__")))')
try: print('b(("a-b",))() =>', end=" "); t(b(("a-b",)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b(("a-b",)))')
try: print('b((b"a",))() =>', end=" "); t(b((b"a",)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b((b"a",)))')
try: print('b(("é",))() =>', end=" "); t(b(("é",)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b(("é",)))')
try: print('b(("class",))() =>', end=" "); t(b(("class",)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b(("class",)))')
try: print('b(("__slots__",))() =>', end=" "); t(b(("__slots__",)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b(("__slots__",)))')
try: print('b(("__init__",))() =>', end=" "); t(b(("__init__",)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b(("__init__",)))')
try: print('b(("a",), __init__=lambda s: None)() =>', end=" "); t(b(("a",), __init__=lambda s: None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b(("a",), __init__=lambda s: None))')
try: print('b("ab")() =>', end=" "); t(b("ab"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b("ab"))')
try: print('b(("a",), b=1)() =>', end=" "); t(b(("a",), b=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b(("a",), b=1))')
try: print('b(("__qualname__",))() =>', end=" "); t(b(("__qualname__",)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b(("__qualname__",)))')
try: print('b(("__class__",))() =>', end=" "); t(b(("__class__",)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b(("__class__",)))')
try: print('b(("__doc__",))() =>', end=" "); t(b(("__doc__",)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b(("__doc__",)))')
try: print('b(("__module__",))() =>', end=" "); t(b(("__module__",)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(b(("__module__",)))')
try:
    def dd():
        class X(Plain): __slots__ = ("__dict__",)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def dd():')
try:
    def ww():
        class X(Plain): __slots__ = ("__weakref__",)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ww():')
try: print('dd() =>', end=" "); t(dd)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(dd)')
try: print('ww() =>', end=" "); t(ww)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(ww)')
# Name mangling applies.
try:
    class Mg:
        __slots__ = ("__priv", "_single", "__dunder__")
        def __init__(self): self.__priv = 1; self._single = 2; self.__dunder__ = 3
        def get(self): return self.__priv
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Mg:')
try: mg = Mg()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mg = Mg()')
try: print('mg.get() =>', mg.get())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mg.get()')
try: print('mg._Mg__priv =>', mg._Mg__priv)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mg._Mg__priv')
try: print('mg._single =>', mg._single)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mg._single')
try: print('mg.__dunder__ =>', mg.__dunder__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mg.__dunder__')
try: print('Mg.__slots__ =>', Mg.__slots__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Mg.__slots__')
try: print('sorted(k for k in Mg.__dict__ if "priv" in k or "single" in k or "dun... =>', sorted(k for k in Mg.__dict__ if "priv" in k or "single" in k or "dunder" in k))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(k for k in Mg.__dict__ if "priv" in k or "single" in k or "dun...')
# Class attributes alongside slots; properties; methods.
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CA:')
try: ca = CA()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ca = CA()')
try: ca.v = 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ca.v = 5')
try: print('ca.v =>', ca.v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ca.v')
try: print('ca.m() =>', ca.m())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ca.m()')
try: print('ca.c() =>', ca.c())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ca.c()')
try: print('ca.default =>', ca.default)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ca.default')
try:
    def s6(): ca.default = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s6(): ca.default = 1')
try: print('s6() =>', end=" "); t(s6)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s6)')
try: CA.default = "changed"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: CA.default = "changed"')
try: print(ca.default)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ca.default')
# __class__ assignment needs the same layout.
try:
    class A1: __slots__ = ("x",)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A1: __slots__ = ("x",)')
try:
    class A2: __slots__ = ("x",)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A2: __slots__ = ("x",)')
try:
    class A3: __slots__ = ("y",)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A3: __slots__ = ("y",)')
try:
    class A4: __slots__ = ("x", "y")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A4: __slots__ = ("x", "y")')
try: a = A1()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = A1()')
try: a.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.x = 1')
try: a.__class__ = A2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.__class__ = A2')
try: print('type(a).__name__ =>', type(a).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(a).__name__')
try: print('a.x =>', a.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.x')
try:
    def c1(): a.__class__ = A3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c1(): a.__class__ = A3')
try:
    def c2(): a.__class__ = A4
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c2(): a.__class__ = A4')
try:
    def c3(): a.__class__ = Plain
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c3(): a.__class__ = Plain')
try:
    def c4(): Plain().__class__ = A1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c4(): Plain().__class__ = A1')
try: print('c1() =>', end=" "); t(c1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(c1)')
try: print('c2() =>', end=" "); t(c2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(c2)')
try: print('c3() =>', end=" "); t(c3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(c3)')
try: print('c4() =>', end=" "); t(c4)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(c4)')
# Hooks still apply.
try:
    class H:
        __slots__ = ("a",)
        def __getattr__(self, n): return "fallback " + n
        def __setattr__(self, n, v): print("set", n, end="; "); object.__setattr__(self, n, v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class H:')
try: h = H()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h = H()')
try: print(h.a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h.a')
try: h.a = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h.a = 1')
try: print('h.a =>', h.a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h.a')
try: print('h.b =>', h.b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h.b')
try:
    def s7(): h.b = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s7(): h.b = 1')
try: print('s7() =>', end=" "); t(s7)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s7)')
try: print('repr(P.x) =>', repr(P.x))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(P.x)')
try: print('P.x.__name__ =>', P.x.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.x.__name__')
try: print('P.x.__objclass__.__name__ =>', P.x.__objclass__.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.x.__objclass__.__name__')
try: print('P.x.__get__(p) =>', P.x.__get__(p))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.x.__get__(p)')
try: print('P.x.__set__(p, 9) =>', P.x.__set__(p, 9))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.x.__set__(p, 9)')
try: print('p.x =>', p.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.x')
try: print('P.x.__get__(None, P) is P.x =>', P.x.__get__(None, P) is P.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.x.__get__(None, P) is P.x')
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')
try: many = type("Many", (), {"__slots__": tuple("s%d" % i for i in range(100))})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: many = type("Many", (), {"__slots__": tuple("s%d" % i for i in range(...')
try: mo = many()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mo = many()')
try:
    for i in range(100): setattr(mo, "s%d" % i, i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(100): setattr(mo, "s%d" % i, i)')
try: print('sum(getattr(mo, "s%d" % i) for i in range(100)) =>', sum(getattr(mo, "s%d" % i) for i in range(100)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(getattr(mo, "s%d" % i) for i in range(100))')
try: print('len(many.__slots__) =>', len(many.__slots__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(many.__slots__)')
try: objs = [P(i, -i) for i in range(1000)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: objs = [P(i, -i) for i in range(1000)]')
try: print('sum(o.x + o.y for o in objs) =>', sum(o.x + o.y for o in objs))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(o.x + o.y for o in objs)')
try: print('objs[500].x =>', objs[500].x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: objs[500].x')
try: print('P(1, 2).__reduce_ex__(2)[2] =>', P(1, 2).__reduce_ex__(2)[2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P(1, 2).__reduce_ex__(2)[2]')
try: print('P(1, 2).__getstate__() =>', P(1, 2).__getstate__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P(1, 2).__getstate__()')
try: print('E().__getstate__() =>', E().__getstate__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: E().__getstate__()')
try: print('WithDict().__getstate__() =>', WithDict().__getstate__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: WithDict().__getstate__()')
try: print('Derived().__getstate__() =>', Derived().__getstate__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Derived().__getstate__()')
try: print('P(1, 2).__reduce_ex__(1) =>', end=" "); t(lambda: P(1, 2).__reduce_ex__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: P(1, 2).__reduce_ex__(1))')
try: print('P(1, 2).__reduce__() =>', end=" "); t(lambda: P(1, 2).__reduce__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: P(1, 2).__reduce__())')
