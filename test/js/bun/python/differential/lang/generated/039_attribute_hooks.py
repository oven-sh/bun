try:
    def t(f):
        try:
            print(repr(f()))
        except Exception as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try:
    class GA:
        real = "real"
        def __init__(self): self.inst = "inst"
        def __getattr__(self, name):
            print("__getattr__", name, end="; ")
            if name.startswith("dyn_"): return name[4:]
            raise AttributeError("custom message for " + name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class GA:')
try: g = GA()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = GA()')
try: print('g.real =>', g.real)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.real')
try: print('g.inst =>', g.inst)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.inst')
try: print('g.dyn_x =>', g.dyn_x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.dyn_x')
try: print('getattr(g, "dyn_y") =>', getattr(g, "dyn_y"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: getattr(g, "dyn_y")')
try: print('hasattr(g, "dyn_z") =>', hasattr(g, "dyn_z"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(g, "dyn_z")')
try: print('hasattr(g, "other") =>', hasattr(g, "other"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(g, "other")')
try: print('getattr(g, "other", "default") =>', getattr(g, "other", "default"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: getattr(g, "other", "default")')
try: print('g.other =>', end=" "); t(lambda: g.other)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: g.other)')
try: print('GA.dyn_x =>', end=" "); t(lambda: GA.dyn_x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: GA.dyn_x)')
try: print('g.__dict__ =>', g.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__dict__')
try: print('g.__class__.__name__ =>', g.__class__.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.__class__.__name__')
try:
    class GA2:
        def __getattr__(self, name): return None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class GA2:')
try: print('GA2().anything =>', GA2().anything)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: GA2().anything')
try: print('GA2().__len__ if False else "" =>', GA2().__len__ if False else "")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: GA2().__len__ if False else ""')
try: print('hasattr(GA2(), "x") =>', hasattr(GA2(), "x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(GA2(), "x")')
try: print('len(GA2()) =>', end=" "); t(lambda: len(GA2()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: len(GA2()))')
try: print('GA2()() =>', end=" "); t(lambda: GA2()())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: GA2()())')
try: print('GA2() + 1 =>', end=" "); t(lambda: GA2() + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: GA2() + 1)')
try: print('iter(GA2()) =>', end=" "); t(lambda: iter(GA2()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: iter(GA2()))')
try:
    class GetAttribute:
        x = 1
        def __init__(self): object.__setattr__(self, "y", 2)
        def __getattribute__(self, name):
            if name == "secret": raise AttributeError("hidden")
            if name == "fixed": return "always"
            return ("intercepted", object.__getattribute__(self, name))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class GetAttribute:')
try: ga = GetAttribute()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ga = GetAttribute()')
try: print('ga.x =>', ga.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ga.x')
try: print('ga.y =>', ga.y)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ga.y')
try: print('ga.fixed =>', ga.fixed)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ga.fixed')
try: print('ga.__class__ =>', ga.__class__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ga.__class__')
try: print('hasattr(ga, "secret") =>', hasattr(ga, "secret"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(ga, "secret")')
try: print('hasattr(ga, "nope") =>', hasattr(ga, "nope"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(ga, "nope")')
try: print('type(ga).__name__ =>', type(ga).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(ga).__name__')
try: print('GetAttribute.x =>', GetAttribute.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: GetAttribute.x')
try: print('ga.secret =>', end=" "); t(lambda: ga.secret)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ga.secret)')
try: print('ga.nope =>', end=" "); t(lambda: ga.nope)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: ga.nope)')
try:
    class Both:
        def __getattribute__(self, name):
            print("getattribute", name, end="; ")
            return object.__getattribute__(self, name)
        def __getattr__(self, name):
            print("getattr", name, end="; ")
            return "fallback"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Both:')
try: b = Both()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b = Both()')
try: b.a = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b.a = 1')
try: print(b.a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b.a')
try: print(b.missing)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b.missing')
try:
    class BothRaise:
        def __getattribute__(self, name): raise AttributeError("first")
        def __getattr__(self, name): raise AttributeError("second")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BothRaise:')
try: print('BothRaise().x =>', end=" "); t(lambda: BothRaise().x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: BothRaise().x)')
try:
    class NonAttrError:
        def __getattribute__(self, name): raise ValueError("not an AttributeError")
        def __getattr__(self, name): return "never"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NonAttrError:')
try: print('NonAttrError().x =>', end=" "); t(lambda: NonAttrError().x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: NonAttrError().x)')
try: print('hasattr(NonAttrError(), "x") =>', end=" "); t(lambda: hasattr(NonAttrError(), "x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: hasattr(NonAttrError(), "x"))')
try: print('getattr(NonAttrError(), "x", 1) =>', end=" "); t(lambda: getattr(NonAttrError(), "x", 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: getattr(NonAttrError(), "x", 1))')
# Implicit special method lookups bypass both hooks.
try:
    class Bypass:
        def __getattribute__(self, name): print("GA", name, end="; "); return object.__getattribute__(self, name)
        def __len__(self): return 3
        def __repr__(self): return "Bypass()"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Bypass:')
try: bp = Bypass()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bp = Bypass()')
try: print('len(bp) =>', len(bp))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(bp)')
try: print('repr(bp) =>', repr(bp))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(bp)')
try: print('str(bp) =>', str(bp))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: str(bp)')
try: print('bool(bp) =>', bool(bp))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool(bp)')
try: print(bp.__len__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bp.__len__()')
try:
    class SA:
        def __setattr__(self, name, value):
            print("setattr", name, value, end="; ")
            if name == "ro": raise AttributeError("read only: " + name)
            object.__setattr__(self, name, value * 2 if isinstance(value, int) else value)
        def __delattr__(self, name):
            print("delattr", name, end="; ")
            if name == "keep": raise AttributeError("cannot delete " + name)
            object.__delattr__(self, name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SA:')
try: s = SA()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s = SA()')
try: s.a = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s.a = 1')
try: setattr(s, "b", 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: setattr(s, "b", 2)')
try: s.keep = "k"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s.keep = "k"')
try: print(s.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s.__dict__')
try: del s.a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del s.a')
try: delattr(s, "b")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: delattr(s, "b")')
try: print(s.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s.__dict__')
try:
    def s1(): s.ro = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s1(): s.ro = 1')
try:
    def s2(): del s.keep
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s2(): del s.keep')
try:
    def s3(): del s.missing
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def s3(): del s.missing')
try: print('s1() =>', end=" "); t(s1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s1)')
try: print('s2() =>', end=" "); t(s2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s2)')
try: print('s3() =>', end=" "); t(s3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(s3)')
try: s.__dict__["direct"] = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s.__dict__["direct"] = 1')
try: print(s.direct)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s.direct')
try: s.a = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s.a = 1')
try: s.a += 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s.a += 1')
try: print(s.a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s.a')
try: SA.cls_attr = "no hook for the class"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: SA.cls_attr = "no hook for the class"')
try: print(SA.cls_attr)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: SA.cls_attr')
try:
    class Frozen:
        def __init__(self, v): object.__setattr__(self, "v", v)
        def __setattr__(self, n, v): raise TypeError("frozen")
        __delattr__ = __setattr__ if False else (lambda self, n: (_ for _ in ()).throw(TypeError("frozen del")))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Frozen:')
try: f = Frozen(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f = Frozen(1)')
try: print(f.v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.v')
try:
    def f1(): f.v = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f1(): f.v = 2')
try:
    def f2(): del f.v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f2(): del f.v')
try: print('f1() =>', end=" "); t(f1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(f1)')
try: print('f2() =>', end=" "); t(f2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(f2)')
try:
    class InitSet:
        def __init__(self): self.log = []; self.x = 1
        def __setattr__(self, n, v):
            if n != "log": self.log.append(n)
            super().__setattr__(n, v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class InitSet:')
try: i = InitSet()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i = InitSet()')
try: i.y = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i.y = 2')
try: print('i.log =>', i.log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i.log')
try: print('i.x =>', i.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i.x')
try: print('i.y =>', i.y)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i.y')
try:
    class Recursion:
        def __getattr__(self, n): return self.data[n]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Recursion:')
try: print('type(Recursion().x) =>', end=" "); t(lambda: type(Recursion().x))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(Recursion().x))')
try:
    class Proxy:
        def __init__(self, target): object.__setattr__(self, "_t", target)
        def __getattr__(self, n): return getattr(self._t, n)
        def __setattr__(self, n, v): setattr(self._t, n, v)
        def __delattr__(self, n): delattr(self._t, n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Proxy:')
try:
    class Target:
        def __init__(self): self.v = 1
        def m(self): return "m", self.v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Target:')
try: tg = Target()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tg = Target()')
try: p = Proxy(tg)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p = Proxy(tg)')
try: p.v = 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.v = 5')
try: p.w = 6
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.w = 6')
try: print('p.v =>', p.v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.v')
try: print('p.m() =>', p.m())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.m()')
try: print('tg.__dict__ =>', tg.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tg.__dict__')
try: print('list(p.__dict__) =>', list(p.__dict__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(p.__dict__)')
try: del p.w
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del p.w')
try: print(tg.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tg.__dict__')
try: pl = Proxy([1, 2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pl = Proxy([1, 2])')
try: pl.append(3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pl.append(3)')
try: print('pl._t =>', pl._t)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pl._t')
try: print('pl.count(1) =>', pl.count(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pl.count(1)')
try: print('pl.__len__() =>', pl.__len__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: pl.__len__()')
try: print('len(pl) =>', end=" "); t(lambda: len(pl))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: len(pl))')
try: print('pl[0] =>', end=" "); t(lambda: pl[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: pl[0])')
try: print('p.nope =>', end=" "); t(lambda: p.nope)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: p.nope)')
# object.__getattribute__ and friends called directly.
try:
    class Pl:
        c = "class"
        def __init__(self): self.i = "inst"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Pl:')
try: o = Pl()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = Pl()')
try: print('object.__getattribute__(o, "i") =>', object.__getattribute__(o, "i"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: object.__getattribute__(o, "i")')
try: print('object.__getattribute__(o, "c") =>', object.__getattribute__(o, "c"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: object.__getattribute__(o, "c")')
try: print('o.__getattribute__("i") =>', o.__getattribute__("i"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__getattribute__("i")')
try: print('type.__getattribute__(Pl, "c") =>', type.__getattribute__(Pl, "c"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type.__getattribute__(Pl, "c")')
try: print('object.__getattribute__(Pl, "__name__") if False else "" =>', object.__getattribute__(Pl, "__name__") if False else "")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: object.__getattribute__(Pl, "__name__") if False else ""')
try: print('object.__setattr__(o, "n", 1) =>', object.__setattr__(o, "n", 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: object.__setattr__(o, "n", 1)')
try: print('o.n =>', o.n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.n')
try: print('object.__delattr__(o, "n") =>', object.__delattr__(o, "n"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: object.__delattr__(o, "n")')
try: print('hasattr(o, "n") =>', hasattr(o, "n"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(o, "n")')
try: print('o.__setattr__("z", 1) =>', o.__setattr__("z", 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__setattr__("z", 1)')
try: print('o.z =>', o.z)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.z')
try: print('o.__delattr__("z") =>', o.__delattr__("z"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__delattr__("z")')
try: print('object.__getattribute__(o, "nope") =>', end=" "); t(lambda: object.__getattribute__(o, "nope"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__getattribute__(o, "nope"))')
try: print('object.__getattribute__(o, 1) =>', end=" "); t(lambda: object.__getattribute__(o, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__getattribute__(o, 1))')
try: print('object.__getattribute__(o) =>', end=" "); t(lambda: object.__getattribute__(o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__getattribute__(o))')
try: print('object.__setattr__(o, 1, 2) =>', end=" "); t(lambda: object.__setattr__(o, 1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__setattr__(o, 1, 2))')
try: print('object.__delattr__(o, "nope") =>', end=" "); t(lambda: object.__delattr__(o, "nope"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__delattr__(o, "nope"))')
try: print('object.__setattr__(1, "a", 2) =>', end=" "); t(lambda: object.__setattr__(1, "a", 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__setattr__(1, "a", 2))')
try: print('object.__setattr__(Pl, "a", 2) =>', end=" "); t(lambda: object.__setattr__(Pl, "a", 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__setattr__(Pl, "a", 2))')
try: print('object.__delattr__(Pl, "c") =>', end=" "); t(lambda: object.__delattr__(Pl, "c"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__delattr__(Pl, "c"))')
try: print('type.__setattr__(o, "a", 1) =>', end=" "); t(lambda: type.__setattr__(o, "a", 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type.__setattr__(o, "a", 1))')
try: print('type.__getattribute__(o, "i") =>', end=" "); t(lambda: type.__getattribute__(o, "i"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type.__getattribute__(o, "i"))')
try: print('type.__setattr__(int, "a", 1) =>', end=" "); t(lambda: type.__setattr__(int, "a", 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type.__setattr__(int, "a", 1))')
try: print('object.__setattr__(object(), "a", 1) =>', end=" "); t(lambda: object.__setattr__(object(), "a", 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__setattr__(object(), "a", 1))')
try: print('object.__delattr__(object(), "a") =>', end=" "); t(lambda: object.__delattr__(object(), "a"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__delattr__(object(), "a"))')
# Messages for various kinds of object.
try:
    for obj in (1, 1.5, "s", b"b", [], (), {}, set(), None, True, len, int, type, object(), lambda: 0, range(1), ..., NotImplemented, 1j, iter([]), (x for x in ()), slice(1), [].append, str.upper, Pl, o, Pl.__init__, o.__init__, property(), super(Pl, o), BaseException(), frozenset(), bytearray(), Pl.__dict__, classmethod(len), staticmethod(len)):
        try: obj.nope
        except AttributeError as e: print(e, "|", e.name, e.obj is obj)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for obj in (1, 1.5, "s", b"b", [], (), {}, set(), None, True, len, in...')
try:
    for obj in (1, "s", [], {}, None, len, int, object(), range(1), [].append, (), 1.5, ..., str.upper, o.__init__, property()):
        try: obj.nope = 1
        except (AttributeError, TypeError) as e: print(type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for obj in (1, "s", [], {}, None, len, int, object(), range(1), [].ap...')
try:
    for obj in (1, "s", [], None, len, int, object(), o, Pl, lambda: 0):
        try: del obj.nope
        except (AttributeError, TypeError) as e: print(type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for obj in (1, "s", [], None, len, int, object(), o, Pl, lambda: 0):')
try:
    for obj, n in ((1, "real"), ("s", "upper"), ([], "append"), (len, "__name__"), (int, "__add__"), (range(1), "start"), (1j, "imag"), (slice(1), "stop"), (o.__init__, "__func__"), (BaseException(), "args") , (lambda: 0, "__closure__"), (Pl, "__mro__")):
        try: setattr(obj, n, None); print("set ok", n)
        except (AttributeError, TypeError) as e: print(type(e).__name__, e)
        try: delattr(obj, n); print("del ok", n)
        except (AttributeError, TypeError) as e: print(type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for obj, n in ((1, "real"), ("s", "upper"), ([], "append"), (len, "__...')
# __dir__
try:
    class Dr:
        def __dir__(self): return ["z", "a", "m"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Dr:')
try:
    class Dr2:
        def __dir__(self): return 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Dr2:')
try:
    class Dr3:
        def __dir__(self): return ("t", "u")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Dr3:')
try:
    class Dr4:
        def __dir__(self): return [3, 1, 2]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Dr4:')
try:
    class Dr5:
        def __dir__(self): return ["a", 1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Dr5:')
try: print('dir(Dr()) =>', dir(Dr()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dir(Dr())')
try: print('dir(Dr3()) =>', dir(Dr3()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dir(Dr3())')
try: print('dir(Dr4()) =>', dir(Dr4()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dir(Dr4())')
try: print('dir(Dr2()) =>', end=" "); t(lambda: dir(Dr2()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: dir(Dr2()))')
try: print('dir(Dr5()) =>', end=" "); t(lambda: dir(Dr5()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: dir(Dr5()))')
try: print('dir(1, 2) =>', end=" "); t(lambda: dir(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: dir(1, 2))')
try:
    class Dm(type):
        def __dir__(cls): return ["meta"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Dm(type):')
try:
    class Dc(metaclass=Dm): x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Dc(metaclass=Dm): x = 1')
try: print('dir(Dc) =>', dir(Dc))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dir(Dc)')
try: print('"x" in dir(Dc()) =>', "x" in dir(Dc()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "x" in dir(Dc())')
try:
    class V:
        __slots__ = ()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class V:')
try: print('vars(V()) =>', end=" "); t(lambda: vars(V()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: vars(V()))')
try: print('vars(1) =>', end=" "); t(lambda: vars(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: vars(1))')
try: print('vars(1, 2) =>', end=" "); t(lambda: vars(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: vars(1, 2))')
try: print('vars(Pl)["c"] =>', vars(Pl)["c"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: vars(Pl)["c"]')
try: print('vars(o) =>', vars(o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: vars(o)')
try: print('type(vars(Pl)).__name__ =>', type(vars(Pl)).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(vars(Pl)).__name__')
try: print('vars() is globals() =>', vars() is globals())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: vars() is globals()')
# AttributeError attributes and suggestions do not change str().
try:
    try: o.inst_
    except AttributeError as e: print(str(e), e.args, e.name, e.obj is o)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: o.inst_')
try: e = AttributeError("msg", name="n", obj=5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e = AttributeError("msg", name="n", obj=5)')
try: print('e =>', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e')
try: print('e.name =>', e.name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.name')
try: print('e.obj =>', e.obj)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.obj')
try: print('e.args =>', e.args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.args')
try: e = AttributeError()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e = AttributeError()')
try: print('repr(e) =>', repr(e))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(e)')
try: print('e.name =>', e.name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.name')
try: print('e.obj =>', e.obj)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e.obj')
try: print('AttributeError("m", nope=1) =>', end=" "); t(lambda: AttributeError("m", nope=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: AttributeError("m", nope=1))')
