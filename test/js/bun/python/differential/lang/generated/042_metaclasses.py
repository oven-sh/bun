try:
    def t(f):
        try:
            print(repr(f()))
        except Exception as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Meta(type):')
try:
    class A(metaclass=Meta):
        x = 1
        def __init__(self, v=0): self.v = v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A(metaclass=Meta):')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try: print('type(A) =>', type(A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(A)')
try: print('A =>', A)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A')
try: print('A.from_new =>', A.from_new)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.from_new')
try: print('A.meta_method() =>', A.meta_method())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.meta_method()')
try: print('A.attr =>', A.attr)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.attr')
try: print('isinstance(A, Meta) =>', isinstance(A, Meta))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(A, Meta)')
try: print('isinstance(A, type) =>', isinstance(A, type))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(A, type)')
try: print('type(A).__mro__ =>', type(A).__mro__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(A).__mro__')
try: a = A(5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = A(5)')
try: print('a.v =>', a.v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.v')
try: print('type(a) =>', type(a))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(a)')
try: print('a.meta_method() =>', end=" "); t(lambda: a.meta_method())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: a.meta_method())')
try: print('a.attr =>', end=" "); t(lambda: a.attr)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: a.attr)')
try:
    class B(A): y = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class B(A): y = 2')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try: print('type(B) =>', type(B))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(B)')
try: print('B =>', B)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: B')
try: print('B.meta_method() =>', B.meta_method())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: B.meta_method()')
try: print('B.__mro__ =>', B.__mro__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: B.__mro__')
try:
    class K(A, flag=True, n=3): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class K(A, flag=True, n=3): pass')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try: M2 = Meta("Dyn", (), {"z": 1})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M2 = Meta("Dyn", (), {"z": 1})')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try: print('M2 =>', M2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M2')
try: print('M2.z =>', M2.z)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M2.z')
try: print('type(M2) =>', type(M2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(M2)')
# __prepare__
try:
    class Prep(type):
        @classmethod
        def __prepare__(mcs, name, bases, **kw):
            print("prepare", name, bases, kw, end="; ")
            return {"injected": "from prepare"}
        def __new__(mcs, name, bases, ns, **kw): return super().__new__(mcs, name, bases, ns)
        def __init__(cls, *a, **kw): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Prep(type):')
try:
    class P(metaclass=Prep, opt=1):
        seen = injected
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class P(metaclass=Prep, opt=1):')
try: print('P.seen =>', P.seen)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.seen')
try: print('P.injected =>', P.injected)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.injected')
try:
    class Logging(dict):
        def __setitem__(self, k, v): self.setdefault("_order", []).append(k); super().__setitem__(k, v)
        def __getitem__(self, k):
            if k == "magic": return "from namespace"
            return super().__getitem__(k)
        def __missing__(self, k): raise KeyError(k)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Logging(dict):')
try:
    class OrderMeta(type):
        @classmethod
        def __prepare__(mcs, name, bases): return Logging()
        def __new__(mcs, name, bases, ns):
            cls = super().__new__(mcs, name, bases, dict(ns)); cls.order = [k for k in ns["_order"] if not k.startswith("__")]; return cls
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class OrderMeta(type):')
try:
    class O(metaclass=OrderMeta):
        b = 1; a = 2
        def m(self): pass
        c = magic
        a = 3
        l = len("xy")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class O(metaclass=OrderMeta):')
try: print('O.order =>', O.order)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: O.order')
try: print('O.c =>', O.c)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: O.c')
try: print('O.a =>', O.a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: O.a')
try: print('O.l =>', O.l)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: O.l')
try:
    class NonDictNS:
        def __init__(self): self.d = {}
        def __setitem__(self, k, v): self.d[k] = v
        def __getitem__(self, k): return self.d[k]
        def __delitem__(self, k): del self.d[k]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NonDictNS:')
try:
    class MappingMeta(type):
        @classmethod
        def __prepare__(mcs, name, bases): return NonDictNS()
        def __new__(mcs, name, bases, ns): return super().__new__(mcs, name, bases, ns.d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class MappingMeta(type):')
try:
    class MM(metaclass=MappingMeta):
        v = 1; w = v + 1; tmp = 0
        del tmp
        u = len([v])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class MM(metaclass=MappingMeta):')
try: print('MM.v =>', MM.v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: MM.v')
try: print('MM.w =>', MM.w)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: MM.w')
try: print('MM.u =>', MM.u)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: MM.u')
try: print('hasattr(MM, "tmp") =>', hasattr(MM, "tmp"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(MM, "tmp")')
try:
    class BadPrep(type):
        @classmethod
        def __prepare__(mcs, name, bases): return 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BadPrep(type):')
try:
    def bp():
        class X(metaclass=BadPrep): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def bp():')
try: print('bp() =>', end=" "); t(bp)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(bp)')
try:
    class NonePrep(type):
        @classmethod
        def __prepare__(mcs, name, bases): return None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NonePrep(type):')
try:
    def np_():
        class X(metaclass=NonePrep): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def np_():')
try: print('np_() =>', end=" "); t(np_)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(np_)')
try: print('type.__prepare__("X", ()) =>', type.__prepare__("X", ()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type.__prepare__("X", ())')
try: print('type.__prepare__() =>', type.__prepare__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type.__prepare__()')
try: print('type(type.__prepare__).__name__ =>', type(type.__prepare__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(type.__prepare__).__name__')
# The most derived metaclass wins; conflicts are errors.
try:
    class M_A(type): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M_A(type): pass')
try:
    class M_B(M_A): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M_B(M_A): pass')
try:
    class M_C(type): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M_C(type): pass')
try:
    class XA(metaclass=M_A): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class XA(metaclass=M_A): pass')
try:
    class XB(metaclass=M_B): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class XB(metaclass=M_B): pass')
try:
    class XC(metaclass=M_C): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class XC(metaclass=M_C): pass')
try:
    class Y1(XA, XB): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Y1(XA, XB): pass')
try:
    class Y2(XB, XA): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Y2(XB, XA): pass')
try:
    class Y3(XA, metaclass=M_B): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Y3(XA, metaclass=M_B): pass')
try:
    class Y4(XB, metaclass=M_A): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Y4(XB, metaclass=M_A): pass')
try:
    class Y5(XB, metaclass=type): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Y5(XB, metaclass=type): pass')
try:
    class Y6(XA, object): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Y6(XA, object): pass')
try: print('type(Y1).__name__ =>', type(Y1).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(Y1).__name__')
try: print('type(Y2).__name__ =>', type(Y2).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(Y2).__name__')
try: print('type(Y3).__name__ =>', type(Y3).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(Y3).__name__')
try: print('type(Y4).__name__ =>', type(Y4).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(Y4).__name__')
try: print('type(Y5).__name__ =>', type(Y5).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(Y5).__name__')
try: print('type(Y6).__name__ =>', type(Y6).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(Y6).__name__')
try:
    def c1():
        class Z(XA, XC): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c1():')
try:
    def c2():
        class Z(XA, metaclass=M_C): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c2():')
try: print('c1() =>', end=" "); t(c1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(c1)')
try: print('c2() =>', end=" "); t(c2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(c2)')
try: print('type("Z", (XA, XC), {}) =>', end=" "); t(lambda: type("Z", (XA, XC), {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("Z", (XA, XC), {}))')
try: print('type(type("Z", (XA,), {})).__name__ =>', end=" "); t(lambda: type(type("Z", (XA,), {})).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(type("Z", (XA,), {})).__name__)')
try: print('M_C("Z", (XA,), {}) =>', end=" "); t(lambda: M_C("Z", (XA,), {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: M_C("Z", (XA,), {}))')
try: print('type(M_A("Z", (XB,), {})).__name__ =>', end=" "); t(lambda: type(M_A("Z", (XB,), {})).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(M_A("Z", (XB,), {})).__name__)')
# A metaclass need not be a class.
try:
    def func_meta(name, bases, ns, **kw): return ("func_meta", name, bases, sorted(k for k in ns if not k.startswith("__")), kw)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def func_meta(name, bases, ns, **kw): return ("func_meta", name, base...')
try:
    class F(metaclass=func_meta, k=1): a = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class F(metaclass=func_meta, k=1): a = 1')
try: print(F)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: F')
try:
    class F2(int, metaclass=func_meta): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class F2(int, metaclass=func_meta): pass')
try: print(F2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: F2')
try:
    def c3():
        class Z(metaclass=5): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c3():')
try:
    def c4():
        class Z(metaclass=None): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c4():')
try:
    def c5():
        class Z(metaclass=lambda: 0): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def c5():')
try: print('c3() =>', end=" "); t(c3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(c3)')
try: print('c4() =>', end=" "); t(c4)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(c4)')
try: print('c5() =>', end=" "); t(c5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(c5)')
try:
    class Callable_:
        def __call__(self, name, bases, ns): return "callable instance made " + name
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Callable_:')
try:
    class F3(metaclass=Callable_()): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class F3(metaclass=Callable_()): pass')
try: print(F3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: F3')
# Operators and protocols on classes come from the metaclass.
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class OpMeta(type):')
try:
    class Op(metaclass=OpMeta):
        def __len__(self): return 1
        def __add__(self, o): return "instance add"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Op(metaclass=OpMeta):')
try: print('Op + 1 =>', Op + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Op + 1')
try: print('1 + Op =>', 1 + Op)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 1 + Op')
try: print('len(Op) =>', len(Op))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(Op)')
try: print('Op[0] =>', Op[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Op[0]')
try: print('list(Op) =>', list(Op))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(Op)')
try: print('"yes" in Op =>', "yes" in Op)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "yes" in Op')
try: print('"no" in Op =>', "no" in Op)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "no" in Op')
try: print('bool(Op) =>', bool(Op))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool(Op)')
try: print('Op == "equal" =>', Op == "equal")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Op == "equal"')
try: print('Op != "equal" =>', Op != "equal")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Op != "equal"')
try: print('hash(Op) =>', hash(Op))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(Op)')
try: print('Op < 1 =>', Op < 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Op < 1')
try: print('str(Op) =>', str(Op))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: str(Op)')
try: print('Op.missing =>', Op.missing)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Op.missing')
try: print('isinstance("instance", Op) =>', isinstance("instance", Op))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance("instance", Op)')
try: print('isinstance(Op(), Op) =>', isinstance(Op(), Op))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(Op(), Op)')
try: print('issubclass(int, Op) =>', issubclass(int, Op))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: issubclass(int, Op)')
try: print('issubclass(Op, Op) =>', issubclass(Op, Op))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: issubclass(Op, Op)')
try: print('Op | int =>', Op | int)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Op | int')
try: print('-Op =>', -Op)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: -Op')
try: print('int(Op) =>', int(Op))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: int(Op)')
try: print('f"{Op:x}" =>', f"{Op:x}")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f"{Op:x}"')
try: print('len(Op()) =>', len(Op()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(Op())')
try: print('Op() + 1 =>', Op() + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Op() + 1')
try: print('[v for v in Op] =>', [v for v in Op])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [v for v in Op]')
try: print('{Op: 1}[Op] if False else "" =>', {Op: 1}[Op] if False else "")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {Op: 1}[Op] if False else ""')
try: print('sorted([Op, Op]) and "sorted" =>', sorted([Op, Op]) and "sorted")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted([Op, Op]) and "sorted"')
try: Op.new = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Op.new = 1')
try: del Op.new
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del Op.new')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    with Op as w: print(w)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with Op as w: print(w)')
try: print('Op().missing =>', end=" "); t(lambda: Op().missing)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: Op().missing)')
try: a, b = Op
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a, b = Op')
try: print('a =>', a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a')
try: print('b =>', b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b')
# type's own methods.
try: print('type.__call__(int, "7") =>', type.__call__(int, "7"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type.__call__(int, "7")')
try: print('type.__repr__(int) =>', type.__repr__(int))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type.__repr__(int)')
try: print('type.__name__ =>', type.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type.__name__')
try: print('type.mro(int) =>', type.mro(int))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type.mro(int)')
try: print('int.mro() =>', int.mro())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: int.mro()')
try: print('type.__subclasses__(M_A) =>', type.__subclasses__(M_A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type.__subclasses__(M_A)')
try: print('type.__instancecheck__(int, 1) =>', type.__instancecheck__(int, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type.__instancecheck__(int, 1)')
try: print('type.__subclasscheck__(int, bool) =>', type.__subclasscheck__(int, bool))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type.__subclasscheck__(int, bool)')
try: print('int.__instancecheck__(True) =>', int.__instancecheck__(True))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: int.__instancecheck__(True)')
try: print('int.__subclasscheck__(str) =>', int.__subclasscheck__(str))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: int.__subclasscheck__(str)')
try: print('type.__dir__(int) == int.__dir__(int) if False else "" =>', type.__dir__(int) == int.__dir__(int) if False else "")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type.__dir__(int) == int.__dir__(int) if False else ""')
try: print('type.__or__(int, str) =>', type.__or__(int, str))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type.__or__(int, str)')
try: print('int.__or__(str) if False else "" =>', int.__or__(str) if False else "")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: int.__or__(str) if False else ""')
try: print('type.__sizeof__(int) > 0 =>', type.__sizeof__(int) > 0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type.__sizeof__(int) > 0')
try: print('type.__dict__["__dict__"].__get__(int)["real"] is int.__dict__["real"] =>', type.__dict__["__dict__"].__get__(int)["real"] is int.__dict__["real"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type.__dict__["__dict__"].__get__(int)["real"] is int.__dict__["real"]')
try:
    class CustomMRO(type):
        def mro(cls): print("mro called for", cls.__name__, end="; "); return [cls, object] if cls.__name__ == "Short" else super().mro()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CustomMRO(type):')
try:
    class Wide: w = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Wide: w = 1')
try:
    class Short(Wide, metaclass=CustomMRO): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Short(Wide, metaclass=CustomMRO): pass')
try:
    class Normal(Wide, metaclass=CustomMRO): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Normal(Wide, metaclass=CustomMRO): pass')
try: print('Short.__mro__ =>', Short.__mro__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Short.__mro__')
try: print('hasattr(Short, "w") =>', hasattr(Short, "w"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(Short, "w")')
try: print('Normal.__mro__ =>', Normal.__mro__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Normal.__mro__')
try: print('Short.__bases__ =>', Short.__bases__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Short.__bases__')
try:
    class BadMRO1(type):
        def mro(cls): return 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BadMRO1(type):')
try:
    class BadMRO2(type):
        def mro(cls): return [1]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BadMRO2(type):')
try:
    class BadMRO3(type):
        def mro(cls): return [int]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BadMRO3(type):')
try:
    class BadMRO4(type):
        def mro(cls): return []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BadMRO4(type):')
try:
    for bm in (BadMRO1, BadMRO2, BadMRO3, BadMRO4): t(lambda: bm("X", (), {}).__mro__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for bm in (BadMRO1, BadMRO2, BadMRO3, BadMRO4): t(lambda: bm("X", (),...')
# Singleton and registry idioms.
try:
    class SingletonMeta(type):
        _inst = {}
        def __call__(cls, *a, **k):
            if cls not in cls._inst: cls._inst[cls] = super().__call__(*a, **k)
            return cls._inst[cls]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SingletonMeta(type):')
try:
    class Conf(metaclass=SingletonMeta):
        def __init__(self): print("Conf init", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Conf(metaclass=SingletonMeta):')
try: print(Conf() is Conf())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Conf() is Conf()')
try:
    class Registry(type):
        reg = {}
        def __init__(cls, name, bases, ns):
            super().__init__(name, bases, ns)
            if bases: Registry.reg[name.lower()] = cls
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Registry(type):')
try:
    class Plugin(metaclass=Registry): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Plugin(metaclass=Registry): pass')
try:
    class Foo(Plugin): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Foo(Plugin): pass')
try:
    class Bar(Plugin): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Bar(Plugin): pass')
try: print('sorted(Registry.reg) =>', sorted(Registry.reg))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(Registry.reg)')
try: print('Registry.reg["foo"] is Foo =>', Registry.reg["foo"] is Foo)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Registry.reg["foo"] is Foo')
try:
    class NoInstances(type):
        def __call__(cls, *a): raise TypeError(cls.__name__ + " cannot be instantiated")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoInstances(type):')
try:
    class Util(metaclass=NoInstances):
        @staticmethod
        def f(): return "f"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Util(metaclass=NoInstances):')
try: print('Util() =>', end=" "); t(Util)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(Util)')
try: print(Util.f())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Util.f()')
try:
    class MetaMeta(type):
        def __call__(mcs, *a): print("MetaMeta.__call__", a[0], end="; "); return super().__call__(*a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class MetaMeta(type):')
try:
    class Mid(type, metaclass=MetaMeta): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Mid(type, metaclass=MetaMeta): pass')
try:
    class Leaf(metaclass=Mid): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Leaf(metaclass=Mid): pass')
try: print('type(Leaf).__name__ =>', type(Leaf).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(Leaf).__name__')
try: print('type(type(Leaf)).__name__ =>', type(type(Leaf)).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(type(Leaf)).__name__')
try: print('type(type(type(Leaf))).__name__ =>', type(type(type(Leaf))).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(type(type(Leaf))).__name__')
try:
    class InitSubMeta(type):
        def __new__(m, n, b, ns): print("meta new", n, end="; "); return super().__new__(m, n, b, ns)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class InitSubMeta(type):')
try:
    class ISB(metaclass=InitSubMeta):
        def __init_subclass__(cls): print("init_subclass", cls.__name__, end="; ")
        def __set_name__(self, o, n): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ISB(metaclass=InitSubMeta):')
try:
    class ISC(ISB): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ISC(ISB): pass')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    class ClassCellMeta(type):
        def __new__(m, n, b, ns):
            print("__classcell__" in ns, end="; "); return super().__new__(m, n, b, ns)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ClassCellMeta(type):')
try:
    class CC1(metaclass=ClassCellMeta):
        def m(self): return __class__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CC1(metaclass=ClassCellMeta):')
try:
    class CC2(metaclass=ClassCellMeta):
        def m(self): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class CC2(metaclass=ClassCellMeta):')
try: print('CC1().m().__name__ =>', CC1().m().__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: CC1().m().__name__')
try: print('"__classcell__" in CC1.__dict__ =>', "__classcell__" in CC1.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "__classcell__" in CC1.__dict__')
try:
    class DropCell(type):
        def __new__(m, n, b, ns): ns.pop("__classcell__", None); return super().__new__(m, n, b, ns)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class DropCell(type):')
try:
    def dc():
        class X(metaclass=DropCell):
            def m(self): return __class__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def dc():')
try: print('dc() =>', end=" "); t(dc)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(dc)')
try:
    class WrongCell(type):
        def __new__(m, n, b, ns):
            super().__new__(m, n, b, dict(ns)); return super().__new__(m, n + "2", b, {k: v for k, v in ns.items() if k != "__classcell__"})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WrongCell(type):')
try:
    def wc():
        class X(metaclass=WrongCell):
            def m(self): return __class__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def wc():')
try: print('wc() =>', end=" "); t(wc)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(wc)')
try: print('type("X", (), {"__classcell__": 1}) =>', end=" "); t(lambda: type("X", (), {"__classcell__": 1}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (), {"__classcell__": 1}))')
