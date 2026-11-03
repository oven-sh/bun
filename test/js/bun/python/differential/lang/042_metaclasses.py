def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

class Meta(type):
    def __new__(mcs, name, bases, ns, **kw):
        print("Meta.__new__", name, [b.__name__ for b in bases], sorted(k for k in ns if not k.startswith("__")), kw, end="; ")
        cls = super().__new__(mcs, name, bases, ns)
        cls.from_new = True
        return cls
    def __init__(cls, name, bases, ns, **kw):
        print("Meta.__init__", name, kw, end="; ")
        super().__init__(name, bases, ns)
    def __call__(cls, *a, **k):
        print("Meta.__call__", cls.__name__, a, k, end="; ")
        return super().__call__(*a, **k)
    def meta_method(cls): return "meta_method of " + cls.__name__
    def __repr__(cls): return "<Meta class %s>" % cls.__name__
    attr = "on meta"
class A(metaclass=Meta):
    x = 1
    def __init__(self, v=0): self.v = v
print(); print(type(A), A, A.from_new, A.meta_method(), A.attr, isinstance(A, Meta), isinstance(A, type), type(A).__mro__)
a = A(5); print(a.v, type(a)); t(lambda: a.meta_method()); t(lambda: a.attr)
class B(A): y = 2
print(); print(type(B), B, B.meta_method(), B.__mro__)
class K(A, flag=True, n=3): pass
print()
M2 = Meta("Dyn", (), {"z": 1}); print(); print(M2, M2.z, type(M2))
# __prepare__
class Prep(type):
    @classmethod
    def __prepare__(mcs, name, bases, **kw):
        print("prepare", name, bases, kw, end="; ")
        return {"injected": "from prepare"}
    def __new__(mcs, name, bases, ns, **kw): return super().__new__(mcs, name, bases, ns)
    def __init__(cls, *a, **kw): pass
class P(metaclass=Prep, opt=1):
    seen = injected
print(P.seen, P.injected)
class Logging(dict):
    def __setitem__(self, k, v): self.setdefault("_order", []).append(k); super().__setitem__(k, v)
    def __getitem__(self, k):
        if k == "magic": return "from namespace"
        return super().__getitem__(k)
    def __missing__(self, k): raise KeyError(k)
class OrderMeta(type):
    @classmethod
    def __prepare__(mcs, name, bases): return Logging()
    def __new__(mcs, name, bases, ns):
        cls = super().__new__(mcs, name, bases, dict(ns)); cls.order = [k for k in ns["_order"] if not k.startswith("__")]; return cls
class O(metaclass=OrderMeta):
    b = 1; a = 2
    def m(self): pass
    c = magic
    a = 3
    l = len("xy")
print(O.order, O.c, O.a, O.l)
class NonDictNS:
    def __init__(self): self.d = {}
    def __setitem__(self, k, v): self.d[k] = v
    def __getitem__(self, k): return self.d[k]
    def __delitem__(self, k): del self.d[k]
class MappingMeta(type):
    @classmethod
    def __prepare__(mcs, name, bases): return NonDictNS()
    def __new__(mcs, name, bases, ns): return super().__new__(mcs, name, bases, ns.d)
class MM(metaclass=MappingMeta):
    v = 1; w = v + 1; tmp = 0
    del tmp
    u = len([v])
print(MM.v, MM.w, MM.u, hasattr(MM, "tmp"))
class BadPrep(type):
    @classmethod
    def __prepare__(mcs, name, bases): return 5
def bp():
    class X(metaclass=BadPrep): pass
t(bp)
class NonePrep(type):
    @classmethod
    def __prepare__(mcs, name, bases): return None
def np_():
    class X(metaclass=NonePrep): pass
t(np_)
print(type.__prepare__("X", ()), type.__prepare__(), type(type.__prepare__).__name__)
# The most derived metaclass wins; conflicts are errors.
class M_A(type): pass
class M_B(M_A): pass
class M_C(type): pass
class XA(metaclass=M_A): pass
class XB(metaclass=M_B): pass
class XC(metaclass=M_C): pass
class Y1(XA, XB): pass
class Y2(XB, XA): pass
class Y3(XA, metaclass=M_B): pass
class Y4(XB, metaclass=M_A): pass
class Y5(XB, metaclass=type): pass
class Y6(XA, object): pass
print(type(Y1).__name__, type(Y2).__name__, type(Y3).__name__, type(Y4).__name__, type(Y5).__name__, type(Y6).__name__)
def c1():
    class Z(XA, XC): pass
def c2():
    class Z(XA, metaclass=M_C): pass
t(c1); t(c2); t(lambda: type("Z", (XA, XC), {})); t(lambda: type(type("Z", (XA,), {})).__name__); t(lambda: M_C("Z", (XA,), {})); t(lambda: type(M_A("Z", (XB,), {})).__name__)
# A metaclass need not be a class.
def func_meta(name, bases, ns, **kw): return ("func_meta", name, bases, sorted(k for k in ns if not k.startswith("__")), kw)
class F(metaclass=func_meta, k=1): a = 1
print(F)
class F2(int, metaclass=func_meta): pass
print(F2)
def c3():
    class Z(metaclass=5): pass
def c4():
    class Z(metaclass=None): pass
def c5():
    class Z(metaclass=lambda: 0): pass
t(c3); t(c4); t(c5)
class Callable_:
    def __call__(self, name, bases, ns): return "callable instance made " + name
class F3(metaclass=Callable_()): pass
print(F3)
# Operators and protocols on classes come from the metaclass.
class OpMeta(type):
    def __add__(cls, o): return "%s + %r" % (cls.__name__, o)
    def __radd__(cls, o): return "%r + %s" % (o, cls.__name__)
    def __len__(cls): return 42
    def __getitem__(cls, k): return ("item", k)
    def __iter__(cls): return iter(["i1", "i2"])
    def __contains__(cls, v): return v == "yes"
    def __bool__(cls): return False
    def __eq__(cls, o): return o == "equal"
    def __hash__(cls): return 7
    def __lt__(cls, o): return True
    def __str__(cls): return "str of " + cls.__name__
    def __getattr__(cls, n): return "meta getattr " + n
    def __setattr__(cls, n, v): print("meta setattr", n, v, end="; "); super().__setattr__(n, v)
    def __delattr__(cls, n): print("meta delattr", n, end="; "); super().__delattr__(n)
    def __instancecheck__(cls, o): return o == "instance"
    def __subclasscheck__(cls, c): return c is int
    def __or__(cls, o): return "or"
    def __neg__(cls): return "neg"
    def __int__(cls): return 3
    def __format__(cls, s): return "fmt:" + s
    def __enter__(cls): return "entered"
    def __exit__(cls, *a): return False
class Op(metaclass=OpMeta):
    def __len__(self): return 1
    def __add__(self, o): return "instance add"
print(Op + 1, 1 + Op, len(Op), Op[0], list(Op), "yes" in Op, "no" in Op, bool(Op), Op == "equal", Op != "equal", hash(Op), Op < 1, str(Op), Op.missing, isinstance("instance", Op), isinstance(Op(), Op), issubclass(int, Op), issubclass(Op, Op), Op | int, -Op, int(Op), f"{Op:x}", len(Op()), Op() + 1, [v for v in Op], {Op: 1}[Op] if False else "", sorted([Op, Op]) and "sorted")
Op.new = 1; del Op.new; print()
with Op as w: print(w)
t(lambda: Op().missing)
a, b = Op; print(a, b)
# type's own methods.
print(type.__call__(int, "7"), type.__repr__(int), type.__name__, type.mro(int), int.mro(), type.__subclasses__(M_A), type.__instancecheck__(int, 1), type.__subclasscheck__(int, bool), int.__instancecheck__(True), int.__subclasscheck__(str), type.__dir__(int) == int.__dir__(int) if False else "", type.__or__(int, str), int.__or__(str) if False else "", type.__sizeof__(int) > 0, type.__dict__["__dict__"].__get__(int)["real"] is int.__dict__["real"])
class CustomMRO(type):
    def mro(cls): print("mro called for", cls.__name__, end="; "); return [cls, object] if cls.__name__ == "Short" else super().mro()
class Wide: w = 1
class Short(Wide, metaclass=CustomMRO): pass
class Normal(Wide, metaclass=CustomMRO): pass
print(Short.__mro__, hasattr(Short, "w"), Normal.__mro__, Short.__bases__)
class BadMRO1(type):
    def mro(cls): return 5
class BadMRO2(type):
    def mro(cls): return [1]
class BadMRO3(type):
    def mro(cls): return [int]
class BadMRO4(type):
    def mro(cls): return []
for bm in (BadMRO1, BadMRO2, BadMRO3, BadMRO4): t(lambda: bm("X", (), {}).__mro__)
# Singleton and registry idioms.
class SingletonMeta(type):
    _inst = {}
    def __call__(cls, *a, **k):
        if cls not in cls._inst: cls._inst[cls] = super().__call__(*a, **k)
        return cls._inst[cls]
class Conf(metaclass=SingletonMeta):
    def __init__(self): print("Conf init", end="; ")
print(Conf() is Conf())
class Registry(type):
    reg = {}
    def __init__(cls, name, bases, ns):
        super().__init__(name, bases, ns)
        if bases: Registry.reg[name.lower()] = cls
class Plugin(metaclass=Registry): pass
class Foo(Plugin): pass
class Bar(Plugin): pass
print(sorted(Registry.reg), Registry.reg["foo"] is Foo)
class NoInstances(type):
    def __call__(cls, *a): raise TypeError(cls.__name__ + " cannot be instantiated")
class Util(metaclass=NoInstances):
    @staticmethod
    def f(): return "f"
t(Util); print(Util.f())
class MetaMeta(type):
    def __call__(mcs, *a): print("MetaMeta.__call__", a[0], end="; "); return super().__call__(*a)
class Mid(type, metaclass=MetaMeta): pass
class Leaf(metaclass=Mid): pass
print(type(Leaf).__name__, type(type(Leaf)).__name__, type(type(type(Leaf))).__name__)
class InitSubMeta(type):
    def __new__(m, n, b, ns): print("meta new", n, end="; "); return super().__new__(m, n, b, ns)
class ISB(metaclass=InitSubMeta):
    def __init_subclass__(cls): print("init_subclass", cls.__name__, end="; ")
    def __set_name__(self, o, n): pass
class ISC(ISB): pass
print()
class ClassCellMeta(type):
    def __new__(m, n, b, ns):
        print("__classcell__" in ns, end="; "); return super().__new__(m, n, b, ns)
class CC1(metaclass=ClassCellMeta):
    def m(self): return __class__
class CC2(metaclass=ClassCellMeta):
    def m(self): pass
print(CC1().m().__name__, "__classcell__" in CC1.__dict__)
class DropCell(type):
    def __new__(m, n, b, ns): ns.pop("__classcell__", None); return super().__new__(m, n, b, ns)
def dc():
    class X(metaclass=DropCell):
        def m(self): return __class__
t(dc)
class WrongCell(type):
    def __new__(m, n, b, ns):
        super().__new__(m, n, b, dict(ns)); return super().__new__(m, n + "2", b, {k: v for k, v in ns.items() if k != "__classcell__"})
def wc():
    class X(metaclass=WrongCell):
        def m(self): return __class__
t(wc)
t(lambda: type("X", (), {"__classcell__": 1}))
