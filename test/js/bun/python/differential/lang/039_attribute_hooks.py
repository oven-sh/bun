def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

class GA:
    real = "real"
    def __init__(self): self.inst = "inst"
    def __getattr__(self, name):
        print("__getattr__", name, end="; ")
        if name.startswith("dyn_"): return name[4:]
        raise AttributeError("custom message for " + name)
g = GA()
print(g.real, g.inst, g.dyn_x, getattr(g, "dyn_y"), hasattr(g, "dyn_z"), hasattr(g, "other"), getattr(g, "other", "default"))
t(lambda: g.other)
t(lambda: GA.dyn_x)
print(g.__dict__, g.__class__.__name__)
class GA2:
    def __getattr__(self, name): return None
print(GA2().anything, GA2().__len__ if False else "", hasattr(GA2(), "x"))
t(lambda: len(GA2()))
t(lambda: GA2()())
t(lambda: GA2() + 1)
t(lambda: iter(GA2()))
class GetAttribute:
    x = 1
    def __init__(self): object.__setattr__(self, "y", 2)
    def __getattribute__(self, name):
        if name == "secret": raise AttributeError("hidden")
        if name == "fixed": return "always"
        return ("intercepted", object.__getattribute__(self, name))
ga = GetAttribute()
print(ga.x, ga.y, ga.fixed, ga.__class__, hasattr(ga, "secret"), hasattr(ga, "nope"), type(ga).__name__, GetAttribute.x)
t(lambda: ga.secret); t(lambda: ga.nope)
class Both:
    def __getattribute__(self, name):
        print("getattribute", name, end="; ")
        return object.__getattribute__(self, name)
    def __getattr__(self, name):
        print("getattr", name, end="; ")
        return "fallback"
b = Both(); b.a = 1; print(b.a); print(b.missing)
class BothRaise:
    def __getattribute__(self, name): raise AttributeError("first")
    def __getattr__(self, name): raise AttributeError("second")
t(lambda: BothRaise().x)
class NonAttrError:
    def __getattribute__(self, name): raise ValueError("not an AttributeError")
    def __getattr__(self, name): return "never"
t(lambda: NonAttrError().x); t(lambda: hasattr(NonAttrError(), "x")); t(lambda: getattr(NonAttrError(), "x", 1))
# Implicit special method lookups bypass both hooks.
class Bypass:
    def __getattribute__(self, name): print("GA", name, end="; "); return object.__getattribute__(self, name)
    def __len__(self): return 3
    def __repr__(self): return "Bypass()"
bp = Bypass(); print(len(bp), repr(bp), str(bp), bool(bp)); print(bp.__len__())
class SA:
    def __setattr__(self, name, value):
        print("setattr", name, value, end="; ")
        if name == "ro": raise AttributeError("read only: " + name)
        object.__setattr__(self, name, value * 2 if isinstance(value, int) else value)
    def __delattr__(self, name):
        print("delattr", name, end="; ")
        if name == "keep": raise AttributeError("cannot delete " + name)
        object.__delattr__(self, name)
s = SA(); s.a = 1; setattr(s, "b", 2); s.keep = "k"; print(s.__dict__); del s.a; delattr(s, "b"); print(s.__dict__)
def s1(): s.ro = 1
def s2(): del s.keep
def s3(): del s.missing
t(s1); t(s2); t(s3)
s.__dict__["direct"] = 1; print(s.direct); s.a = 1; s.a += 1; print(s.a)
SA.cls_attr = "no hook for the class"; print(SA.cls_attr)
class Frozen:
    def __init__(self, v): object.__setattr__(self, "v", v)
    def __setattr__(self, n, v): raise TypeError("frozen")
    __delattr__ = __setattr__ if False else (lambda self, n: (_ for _ in ()).throw(TypeError("frozen del")))
f = Frozen(1); print(f.v)
def f1(): f.v = 2
def f2(): del f.v
t(f1); t(f2)
class InitSet:
    def __init__(self): self.log = []; self.x = 1
    def __setattr__(self, n, v):
        if n != "log": self.log.append(n)
        super().__setattr__(n, v)
i = InitSet(); i.y = 2; print(i.log, i.x, i.y)
class Recursion:
    def __getattr__(self, n): return self.data[n]
t(lambda: type(Recursion().x))
class Proxy:
    def __init__(self, target): object.__setattr__(self, "_t", target)
    def __getattr__(self, n): return getattr(self._t, n)
    def __setattr__(self, n, v): setattr(self._t, n, v)
    def __delattr__(self, n): delattr(self._t, n)
class Target:
    def __init__(self): self.v = 1
    def m(self): return "m", self.v
tg = Target(); p = Proxy(tg); p.v = 5; p.w = 6; print(p.v, p.m(), tg.__dict__, list(p.__dict__)); del p.w; print(tg.__dict__); pl = Proxy([1, 2]); pl.append(3); print(pl._t, pl.count(1), pl.__len__())
t(lambda: len(pl)); t(lambda: pl[0]); t(lambda: p.nope)
# object.__getattribute__ and friends called directly.
class Pl:
    c = "class"
    def __init__(self): self.i = "inst"
o = Pl(); print(object.__getattribute__(o, "i"), object.__getattribute__(o, "c"), o.__getattribute__("i"), type.__getattribute__(Pl, "c"), object.__getattribute__(Pl, "__name__") if False else "", object.__setattr__(o, "n", 1), o.n, object.__delattr__(o, "n"), hasattr(o, "n"), o.__setattr__("z", 1), o.z, o.__delattr__("z"))
t(lambda: object.__getattribute__(o, "nope")); t(lambda: object.__getattribute__(o, 1)); t(lambda: object.__getattribute__(o)); t(lambda: object.__setattr__(o, 1, 2)); t(lambda: object.__delattr__(o, "nope")); t(lambda: object.__setattr__(1, "a", 2)); t(lambda: object.__setattr__(Pl, "a", 2)); t(lambda: object.__delattr__(Pl, "c")); t(lambda: type.__setattr__(o, "a", 1)); t(lambda: type.__getattribute__(o, "i")); t(lambda: type.__setattr__(int, "a", 1)); t(lambda: object.__setattr__(object(), "a", 1)); t(lambda: object.__delattr__(object(), "a"))
# Messages for various kinds of object.
for obj in (1, 1.5, "s", b"b", [], (), {}, set(), None, True, len, int, type, object(), lambda: 0, range(1), ..., NotImplemented, 1j, iter([]), (x for x in ()), slice(1), [].append, str.upper, Pl, o, Pl.__init__, o.__init__, property(), super(Pl, o), BaseException(), frozenset(), bytearray(), Pl.__dict__, classmethod(len), staticmethod(len)):
    try: obj.nope
    except AttributeError as e: print(e, "|", e.name, e.obj is obj)
for obj in (1, "s", [], {}, None, len, int, object(), range(1), [].append, (), 1.5, ..., str.upper, o.__init__, property()):
    try: obj.nope = 1
    except (AttributeError, TypeError) as e: print(type(e).__name__, e)
for obj in (1, "s", [], None, len, int, object(), o, Pl, lambda: 0):
    try: del obj.nope
    except (AttributeError, TypeError) as e: print(type(e).__name__, e)
for obj, n in ((1, "real"), ("s", "upper"), ([], "append"), (len, "__name__"), (int, "__add__"), (range(1), "start"), (1j, "imag"), (slice(1), "stop"), (o.__init__, "__func__"), (BaseException(), "args") , (lambda: 0, "__closure__"), (Pl, "__mro__")):
    try: setattr(obj, n, None); print("set ok", n)
    except (AttributeError, TypeError) as e: print(type(e).__name__, e)
    try: delattr(obj, n); print("del ok", n)
    except (AttributeError, TypeError) as e: print(type(e).__name__, e)
# __dir__
class Dr:
    def __dir__(self): return ["z", "a", "m"]
class Dr2:
    def __dir__(self): return 5
class Dr3:
    def __dir__(self): return ("t", "u")
class Dr4:
    def __dir__(self): return [3, 1, 2]
class Dr5:
    def __dir__(self): return ["a", 1]
print(dir(Dr()), dir(Dr3()), dir(Dr4())); t(lambda: dir(Dr2())); t(lambda: dir(Dr5())); t(lambda: dir(1, 2))
class Dm(type):
    def __dir__(cls): return ["meta"]
class Dc(metaclass=Dm): x = 1
print(dir(Dc), "x" in dir(Dc()))
class V:
    __slots__ = ()
t(lambda: vars(V())); t(lambda: vars(1)); t(lambda: vars(1, 2)); print(vars(Pl)["c"], vars(o), type(vars(Pl)).__name__, vars() is globals())
# AttributeError attributes and suggestions do not change str().
try: o.inst_
except AttributeError as e: print(str(e), e.args, e.name, e.obj is o)
e = AttributeError("msg", name="n", obj=5); print(e, e.name, e.obj, e.args); e = AttributeError(); print(repr(e), e.name, e.obj); t(lambda: AttributeError("m", nope=1))
