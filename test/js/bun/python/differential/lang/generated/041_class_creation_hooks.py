try:
    def t(f):
        try:
            print(repr(f()))
        except Exception as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

# __init_subclass__
try:
    class Base:
        subs = []
        def __init_subclass__(cls, tag=None, **kw):
            super().__init_subclass__(**kw)
            print("init_subclass", cls.__name__, tag, end="; ")
            cls.tag = tag; Base.subs.append(cls.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Base:')
try:
    class A(Base): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A(Base): pass')
try:
    class B(Base, tag="b"): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class B(Base, tag="b"): pass')
try:
    class C(B): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C(B): pass')
try:
    class D(A, tag="d"): x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class D(A, tag="d"): x = 1')
try: print('Base.subs =>', Base.subs)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base.subs')
try: print('A.tag =>', A.tag)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.tag')
try: print('B.tag =>', B.tag)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: B.tag')
try: print('C.tag =>', C.tag)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C.tag')
try: print('D.tag =>', D.tag)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: D.tag')
try: print('type(Base.__dict__["__init_subclass__"]).__name__ =>', type(Base.__dict__["__init_subclass__"]).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(Base.__dict__["__init_subclass__"]).__name__')
try:
    def e1():
        class X(Base, nope=1): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def e1():')
try:
    def e2():
        class X(nope=1): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def e2():')
try:
    def e3():
        class X(object, a=1, b=2): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def e3():')
try:
    def e4():
        class X(Base, tag=1, tag2=2): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def e4():')
try: print('e1() =>', end=" "); t(e1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(e1)')
try: print('e2() =>', end=" "); t(e2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(e2)')
try: print('e3() =>', end=" "); t(e3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(e3)')
try: print('e4() =>', end=" "); t(e4)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(e4)')
try: print('type("X", (Base,), {}, tag="via type").tag =>', end=" "); t(lambda: type("X", (Base,), {}, tag="via type").tag)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (Base,), {}, tag="via type").tag)')
try: print('type("X", (), {}, nope=1) =>', end=" "); t(lambda: type("X", (), {}, nope=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (), {}, nope=1))')
try: print('object.__init_subclass__(1) =>', end=" "); t(lambda: object.__init_subclass__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__init_subclass__(1))')
try: print('object.__init_subclass__(a=1) =>', end=" "); t(lambda: object.__init_subclass__(a=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__init_subclass__(a=1))')
try: print('object.__init_subclass__() =>', object.__init_subclass__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: object.__init_subclass__()')
try: print('Base.subs[-1] =>', Base.subs[-1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base.subs[-1]')
try:
    class Sees:
        def __init_subclass__(cls):
            print(cls.attr, cls.__qualname__, cls.__mro__[1].__name__, sorted(k for k in cls.__dict__ if not k.startswith("__")), end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Sees:')
try:
    class S2(Sees):
        attr = "visible"
        def m(self): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class S2(Sees):')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try:
    class Raises:
        def __init_subclass__(cls): raise RuntimeError("no subclasses of " + cls.__mro__[1].__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Raises:')
try:
    def e5():
        class X(Raises): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def e5():')
try: print('e5() =>', end=" "); t(e5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(e5)')
try:
    class M1:
        def __init_subclass__(cls, a=None, **kw): print("M1", a, end="; "); super().__init_subclass__(**kw)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M1:')
try:
    class M2:
        def __init_subclass__(cls, b=None, **kw): print("M2", b, end="; "); super().__init_subclass__(**kw)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M2:')
try:
    class M3(M1, M2, a=1, b=2): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M3(M1, M2, a=1, b=2): pass')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
# __class_getitem__
try:
    class G:
        def __class_getitem__(cls, item): return "%s[%r]" % (cls.__name__, item)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class G:')
try:
    class G2(G): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class G2(G): pass')
try: print('G[int] =>', G[int])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: G[int]')
try: print('G[1, 2] =>', G[1, 2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: G[1, 2]')
try: print('G[()] =>', G[()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: G[()]')
try: print('G["s"] =>', G["s"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: G["s"]')
try: print('G2[0] =>', G2[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: G2[0]')
try: print('G[1:2] =>', G[1:2])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: G[1:2]')
try: print('type(G.__dict__["__class_getitem__"]).__name__ =>', type(G.__dict__["__class_getitem__"]).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(G.__dict__["__class_getitem__"]).__name__')
try: print('G.__class_getitem__(5) =>', G.__class_getitem__(5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: G.__class_getitem__(5)')
try: print('G()[0] =>', end=" "); t(lambda: G()[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: G()[0])')
try: print('Base[int] =>', end=" "); t(lambda: Base[int])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: Base[int])')
try: print('object[int] =>', end=" "); t(lambda: object[int])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object[int])')
try: print('int[int] =>', end=" "); t(lambda: int[int])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: int[int])')
try: print('type[int] =>', end=" "); t(lambda: type[int])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type[int])')
try: print('Base()[0] =>', end=" "); t(lambda: Base()[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: Base()[0])')
try: print('len[int] =>', end=" "); t(lambda: len[int])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: len[int])')
try: print('None[0] =>', end=" "); t(lambda: None[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: None[0])')
try: print('type(None)[0] =>', end=" "); t(lambda: type(None)[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(None)[0])')
try:
    class MetaGI(type):
        def __getitem__(cls, i): return "meta getitem", i
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class MetaGI(type):')
try:
    class BothGI(metaclass=MetaGI):
        def __class_getitem__(cls, i): return "class_getitem", i
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BothGI(metaclass=MetaGI):')
try: print(BothGI[1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: BothGI[1]')
try: print('list[int] =>', list[int])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list[int]')
try: print('dict[str, int] =>', dict[str, int])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dict[str, int]')
try: print('tuple[int, ...] =>', tuple[int, ...])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tuple[int, ...]')
try: print('set[int] =>', set[int])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: set[int]')
try: print('frozenset[str] =>', frozenset[str])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: frozenset[str]')
try: print('type[int] =>', type[int])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type[int]')
try: print('list[int].__origin__ =>', list[int].__origin__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list[int].__origin__')
try: print('list[int].__args__ =>', list[int].__args__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list[int].__args__')
try: print('dict[str, int].__args__ =>', dict[str, int].__args__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dict[str, int].__args__')
try: print('list[int]([1]) =>', list[int]([1]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list[int]([1])')
try: print('type(list[int]).__name__ =>', type(list[int]).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(list[int]).__name__')
try: print('list[int] == list[int] =>', list[int] == list[int])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list[int] == list[int]')
try: print('list[int] == list[str] =>', list[int] == list[str])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list[int] == list[str]')
try: print('list[list[int]] =>', list[list[int]])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list[list[int]]')
try: print('tuple[()] =>', tuple[()])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tuple[()]')
try: print('list[int, str] =>', list[int, str])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list[int, str]')
try: print('isinstance(list[int], type) =>', isinstance(list[int], type))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(list[int], type)')
try: print('list[int].__name__ =>', list[int].__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list[int].__name__')
try: print('repr(list["x"]) =>', repr(list["x"]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(list["x"])')
try: print('list[None] =>', list[None])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list[None]')
try: print('list[...] =>', list[...])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list[...]')
try: print('hash(list[int]) == hash(list[int]) =>', hash(list[int]) == hash(list[int]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(list[int]) == hash(list[int])')
try: print('callable(list[int]) =>', callable(list[int]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: callable(list[int])')
# __new__ and __init__
try:
    class N:
        def __new__(cls, *a, **k): print("new", cls.__name__, a, k, end="; "); return super().__new__(cls)
        def __init__(self, *a, **k): print("init", a, k, end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class N:')
try: n = N(1, x=2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n = N(1, x=2)')
try: print(type(n).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(n).__name__')
try:
    class NotInstance:
        def __new__(cls): return 5
        def __init__(self): print("never")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NotInstance:')
try: print('NotInstance() =>', NotInstance())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: NotInstance()')
try: print('type(NotInstance()) =>', type(NotInstance()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(NotInstance())')
try:
    class OtherInstance:
        def __new__(cls): return N.__new__(N)
        def __init__(self): print("never")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class OtherInstance:')
try: print(type(OtherInstance()).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(OtherInstance()).__name__')
try:
    class SubInstance:
        def __new__(cls): return object.__new__(SubSub)
        def __init__(self): print("init runs for a subclass instance", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SubInstance:')
try:
    class SubSub(SubInstance): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SubSub(SubInstance): pass')
try: print(type(SubInstance()).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(SubInstance()).__name__')
try:
    class Singleton:
        _i = None
        def __new__(cls):
            if cls._i is None: cls._i = super().__new__(cls)
            return cls._i
        def __init__(self): self.n = getattr(self, "n", 0) + 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Singleton:')
try: print('Singleton() is Singleton() =>', Singleton() is Singleton())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Singleton() is Singleton()')
try: print('Singleton().n =>', Singleton().n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Singleton().n')
try:
    class InitReturns:
        def __init__(self): return 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class InitReturns:')
try:
    class InitReturnsNone:
        def __init__(self): return None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class InitReturnsNone:')
try: print('InitReturns() =>', end=" "); t(InitReturns)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(InitReturns)')
try: print(type(InitReturnsNone()).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(InitReturnsNone()).__name__')
try:
    class OnlyNew:
        def __new__(cls, a): o = super().__new__(cls); o.a = a; return o
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class OnlyNew:')
try:
    class OnlyInit:
        def __init__(self, a): self.a = a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class OnlyInit:')
try:
    class Neither: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Neither: pass')
try: print('OnlyNew(1).a =>', OnlyNew(1).a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: OnlyNew(1).a')
try: print('OnlyInit(2).a =>', OnlyInit(2).a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: OnlyInit(2).a')
try: print('OnlyNew() =>', end=" "); t(lambda: OnlyNew())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: OnlyNew())')
try: print('OnlyInit() =>', end=" "); t(lambda: OnlyInit())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: OnlyInit())')
try: print('Neither(1) =>', end=" "); t(lambda: Neither(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: Neither(1))')
try: print('OnlyNew(1, 2) =>', end=" "); t(lambda: OnlyNew(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: OnlyNew(1, 2))')
try: print('OnlyInit(1, 2) =>', end=" "); t(lambda: OnlyInit(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: OnlyInit(1, 2))')
try: print('Neither(a=1) =>', end=" "); t(lambda: Neither(a=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: Neither(a=1))')
try: print('object.__new__(Neither, 1) =>', end=" "); t(lambda: object.__new__(Neither, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__new__(Neither, 1))')
try: print('object.__new__(OnlyInit, 1).__dict__ =>', end=" "); t(lambda: object.__new__(OnlyInit, 1).__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__new__(OnlyInit, 1).__dict__)')
try: print('object.__new__(OnlyNew, 1) =>', end=" "); t(lambda: object.__new__(OnlyNew, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__new__(OnlyNew, 1))')
try: print('object.__init__(Neither(), 1) =>', end=" "); t(lambda: object.__init__(Neither(), 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__init__(Neither(), 1))')
try: print('object.__init__(OnlyNew(1), 1) =>', end=" "); t(lambda: object.__init__(OnlyNew(1), 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__init__(OnlyNew(1), 1))')
try: print('object.__init__(OnlyInit(1), 1) =>', end=" "); t(lambda: object.__init__(OnlyInit(1), 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: object.__init__(OnlyInit(1), 1))')
try:
    class NewPassesArgs:
        def __new__(cls, a): return super().__new__(cls, a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NewPassesArgs:')
try: print('NewPassesArgs(1) =>', end=" "); t(lambda: NewPassesArgs(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: NewPassesArgs(1))')
try:
    class NewStatic:
        def __new__(cls): return "implicit staticmethod"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NewStatic:')
try: print('type(NewStatic.__dict__["__new__"]).__name__ =>', type(NewStatic.__dict__["__new__"]).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(NewStatic.__dict__["__new__"]).__name__')
try: print('NewStatic.__new__(NewStatic) =>', NewStatic.__new__(NewStatic))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: NewStatic.__new__(NewStatic)')
try: print('NewStatic.__new__(int) =>', NewStatic.__new__(int))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: NewStatic.__new__(int)')
try: print('NewStatic() =>', NewStatic())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: NewStatic()')
try:
    class IntSub(int):
        def __new__(cls, v, extra): o = super().__new__(cls, v * 2); o.extra = extra; return o
        def __init__(self, v, extra): self.inited = True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class IntSub(int):')
try: i = IntSub(5, "e")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i = IntSub(5, "e")')
try: print('i =>', i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i')
try: print('i.extra =>', i.extra)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i.extra')
try: print('i.inited =>', i.inited)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i.inited')
try: print('i + 1 =>', i + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i + 1')
try: print('type(i + 1) =>', type(i + 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(i + 1)')
try: print('type(i) =>', type(i))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(i)')
try:
    class TupSub(tuple):
        def __new__(cls, *a): return super().__new__(cls, a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class TupSub(tuple):')
try: print('TupSub(1, 2, 3) =>', TupSub(1, 2, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: TupSub(1, 2, 3)')
try: print('len(TupSub()) =>', len(TupSub()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(TupSub())')
try:
    class StrSub(str):
        def __new__(cls, s): return super().__new__(cls, s.upper())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class StrSub(str):')
try: print('StrSub("abc") =>', StrSub("abc"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: StrSub("abc")')
try: print('type(StrSub("a")).__name__ =>', type(StrSub("a")).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(StrSub("a")).__name__')
try: print('StrSub("a") + "b" =>', StrSub("a") + "b")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: StrSub("a") + "b"')
try:
    class Abstractish:
        def __new__(cls, *a):
            if cls is Abstractish: raise TypeError("cannot instantiate Abstractish directly")
            return super().__new__(cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Abstractish:')
try:
    class Concrete(Abstractish): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Concrete(Abstractish): pass')
try: print('Abstractish() =>', end=" "); t(Abstractish)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(Abstractish)')
try: print(type(Concrete()).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(Concrete()).__name__')
try: N.__new__ = lambda cls, *a, **k: "patched"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: N.__new__ = lambda cls, *a, **k: "patched"')
try: print(N())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: N()')
try: del N.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del N.__new__')
try: print(type(N()).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(N()).__name__')
# type() with three arguments.
try: T = type("T", (), {"a": 1, "m": lambda self: self.a})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T = type("T", (), {"a": 1, "m": lambda self: self.a})')
try: print('T =>', T)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T')
try: print('T.__name__ =>', T.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T.__name__')
try: print('T.__bases__ =>', T.__bases__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T.__bases__')
try: print('T().m() =>', T().m())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T().m()')
try: print('T.__module__ =>', T.__module__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T.__module__')
try: print('T.__qualname__ =>', T.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T.__qualname__')
try: print('T.__dict__["a"] =>', T.__dict__["a"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T.__dict__["a"]')
try: print('T.__doc__ =>', T.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T.__doc__')
try: print('type(T) =>', type(T))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(T)')
try: T2 = type("T2", (T, Base), {"__doc__": "d", "__qualname__": "Q.T2", "__module__": "mm"})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T2 = type("T2", (T, Base), {"__doc__": "d", "__qualname__": "Q.T2", "...')
try: print()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print()')
try: print('T2.__mro__[1:3] =>', T2.__mro__[1:3])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T2.__mro__[1:3]')
try: print('T2.__doc__ =>', T2.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T2.__doc__')
try: print('T2.__qualname__ =>', T2.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T2.__qualname__')
try: print('T2.__module__ =>', T2.__module__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T2.__module__')
try: print('repr(T2) =>', repr(T2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(T2)')
try: print('T2().m() =>', T2().m())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T2().m()')
try: print('"__qualname__" in T2.__dict__ =>', "__qualname__" in T2.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "__qualname__" in T2.__dict__')
try: ns = {"x": 1}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns = {"x": 1}')
try: T3 = type("T3", (), ns)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T3 = type("T3", (), ns)')
try: ns["y"] = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ns["y"] = 2')
try: print('hasattr(T3, "y") =>', hasattr(T3, "y"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(T3, "y")')
try: print('T3.x =>', T3.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T3.x')
try: print('type(1) =>', type(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(1)')
try: print('type("a") =>', type("a"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type("a")')
try: print('type(T()) =>', type(T()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(T())')
try: print('type(type) =>', type(type))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(type)')
try: print('type(None) =>', type(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(None)')
try: print('type(T) =>', type(T))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(T)')
try: print('type(int) =>', type(int))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(int)')
try: print('type(name="K", bases=(), dict={}) if False else "" =>', type(name="K", bases=(), dict={}) if False else "")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(name="K", bases=(), dict={}) if False else ""')
try: print('type() =>', end=" "); t(lambda: type())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type())')
try: print('type(1, 2) =>', end=" "); t(lambda: type(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(1, 2))')
try: print('type(1, 2, 3) =>', end=" "); t(lambda: type(1, 2, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(1, 2, 3))')
try: print('type("X", 1, {}) =>', end=" "); t(lambda: type("X", 1, {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", 1, {}))')
try: print('type("X", (), 1) =>', end=" "); t(lambda: type("X", (), 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (), 1))')
try: print('type("X", [], {}) =>', end=" "); t(lambda: type("X", [], {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", [], {}))')
try: print('type("X", (), []) =>', end=" "); t(lambda: type("X", (), []))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (), []))')
try: print('type("X", (1,), {}) =>', end=" "); t(lambda: type("X", (1,), {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (1,), {}))')
try: print('type("X", (), {}, 1) =>', end=" "); t(lambda: type("X", (), {}, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (), {}, 1))')
try: print('type(1, (), {}) =>', end=" "); t(lambda: type(1, (), {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(1, (), {}))')
try: print('type("X", (), {1: 2}).__name__ =>', end=" "); t(lambda: type("X", (), {1: 2}).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (), {1: 2}).__name__)')
try: print('type("a\\0b", (), {}) =>', end=" "); t(lambda: type("a\0b", (), {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("a\\0b", (), {}))')
try: print('type("X", (), {"__qualname__": 1}) =>', end=" "); t(lambda: type("X", (), {"__qualname__": 1}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (), {"__qualname__": 1}))')
try: print('type("X", (), {"__slots__": 1}) =>', end=" "); t(lambda: type("X", (), {"__slots__": 1}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (), {"__slots__": 1}))')
try: print('type("", (), {}).__name__ =>', end=" "); t(lambda: type("", (), {}).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("", (), {}).__name__)')
try: print('type("not an identifier", (), {}).__name__ =>', end=" "); t(lambda: type("not an identifier", (), {}).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("not an identifier", (), {}).__name__)')
try: print('type("X", (int, str), {}) =>', end=" "); t(lambda: type("X", (int, str), {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (int, str), {}))')
try: print('type("X", (bool,), {}) =>', end=" "); t(lambda: type("X", (bool,), {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (bool,), {}))')
try: print('type(x=1) =>', end=" "); t(lambda: type(x=1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type(x=1))')
try: print('type("X", (), {"__doc__": 5}).__doc__ =>', end=" "); t(lambda: type("X", (), {"__doc__": 5}).__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (), {"__doc__": 5}).__doc__)')
try: print('type("é", (), {}).__name__ =>', end=" "); t(lambda: type("é", (), {}).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("é", (), {}).__name__)')
try: print('type.__new__(type, "X", (), {}).__name__ =>', end=" "); t(lambda: type.__new__(type, "X", (), {}).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type.__new__(type, "X", (), {}).__name__)')
try: print('type.__new__(int, "X", (), {}) =>', end=" "); t(lambda: type.__new__(int, "X", (), {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type.__new__(int, "X", (), {}))')
try: print('type.__new__(1) =>', end=" "); t(lambda: type.__new__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type.__new__(1))')
try: print('type.__new__(type) =>', end=" "); t(lambda: type.__new__(type))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type.__new__(type))')
try: print('type.__new__(type, 1) =>', end=" "); t(lambda: type.__new__(type, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type.__new__(type, 1))')
try: print('type.__call__(int, "5") =>', end=" "); t(lambda: type.__call__(int, "5"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type.__call__(int, "5"))')
try: print('type.__call__(1) =>', end=" "); t(lambda: type.__call__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type.__call__(1))')
try: print('type.__init__(int) =>', end=" "); t(lambda: type.__init__(int))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type.__init__(int))')
try: print('type.__init__(int, 1, 2) =>', end=" "); t(lambda: type.__init__(int, 1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type.__init__(int, 1, 2))')
try: print('type.__init__(int, 1) =>', end=" "); t(lambda: type.__init__(int, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type.__init__(int, 1))')
try: print('type.__init__(int, 1, 2, 3) =>', end=" "); t(lambda: type.__init__(int, 1, 2, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type.__init__(int, 1, 2, 3))')
# __mro_entries__
try:
    class Entry:
        def __init__(self, *b): self.b = b
        def __mro_entries__(self, bases): print("mro_entries", len(bases), end="; "); return self.b
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Entry:')
try:
    class ME(Entry(A, M1)): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ME(Entry(A, M1)): pass')
try: print('ME.__bases__ =>', ME.__bases__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ME.__bases__')
try: print('ME.__orig_bases__[0].__class__.__name__ =>', ME.__orig_bases__[0].__class__.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ME.__orig_bases__[0].__class__.__name__')
try: print('ME.__mro__[1].__name__ =>', ME.__mro__[1].__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ME.__mro__[1].__name__')
try:
    class ME0(Entry()): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ME0(Entry()): pass')
try: print('ME0.__bases__ =>', ME0.__bases__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ME0.__bases__')
try: print('len(ME0.__orig_bases__) =>', len(ME0.__orig_bases__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(ME0.__orig_bases__)')
try:
    class BadEntry:
        def __mro_entries__(self, bases): return [int]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BadEntry:')
try:
    def e6():
        class X(BadEntry()): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def e6():')
try: print('e6() =>', end=" "); t(e6)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(e6)')
try: print('type("X", (Entry(A),), {}) =>', end=" "); t(lambda: type("X", (Entry(A),), {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: type("X", (Entry(A),), {}))')
try:
    class LG(list[int]): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class LG(list[int]): pass')
try: print('LG.__bases__ =>', LG.__bases__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LG.__bases__')
try: print('LG.__orig_bases__ =>', LG.__orig_bases__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LG.__orig_bases__')
try: print('LG([1]) =>', LG([1]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: LG([1])')
# The class namespace: __module__, __qualname__, __firstlineno__, __static_attributes__, __doc__.
try:
    class NSp:
        "doc"
        print(sorted(k for k in locals()), __qualname__, __module__, end="; ")
        def __init__(self): self.a = 1; self.b = 2
        def m(self): self.c = 3; self.a = 4; x = self.d
        @classmethod
        def c(cls): cls.e = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NSp:')
try: print('sorted(NSp.__static_attributes__) =>', sorted(NSp.__static_attributes__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(NSp.__static_attributes__)')
try: print('type(NSp.__firstlineno__).__name__ =>', type(NSp.__firstlineno__).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(NSp.__firstlineno__).__name__')
try: print('NSp.__doc__ =>', NSp.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: NSp.__doc__')
try: print('"__qualname__" in NSp.__dict__ =>', "__qualname__" in NSp.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "__qualname__" in NSp.__dict__')
try: print('"__firstlineno__" in NSp.__dict__ =>', "__firstlineno__" in NSp.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "__firstlineno__" in NSp.__dict__')
try:
    class QN: __qualname__ = "Custom.QN"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class QN: __qualname__ = "Custom.QN"')
try: print('QN.__qualname__ =>', QN.__qualname__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: QN.__qualname__')
try: print('QN.__name__ =>', QN.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: QN.__name__')
try: print('repr(QN) =>', repr(QN))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(QN)')
try:
    def bq():
        class X: __qualname__ = 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def bq():')
try: print('bq() =>', end=" "); t(bq)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(bq)')
