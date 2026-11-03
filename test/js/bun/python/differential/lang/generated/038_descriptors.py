try:
    def t(f):
        try:
            print(repr(f()))
        except Exception as e:
            print(type(e).__name__ + ':', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(f):')

try:
    class Data:
        def __init__(self, name): self.name = name
        def __get__(self, obj, typ=None):
            print("get", self.name, obj if obj is None else "obj", typ.__name__ if typ else typ, end="; ")
            return self if obj is None else obj.__dict__.get(self.name, "unset")
        def __set__(self, obj, v): print("set", self.name, v, end="; "); obj.__dict__[self.name] = v
        def __delete__(self, obj): print("delete", self.name, end="; "); del obj.__dict__[self.name]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Data:')
try:
    class NonData:
        def __get__(self, obj, typ=None): return ("nondata", obj is None, typ.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NonData:')
try:
    class OnlySet:
        def __set__(self, obj, v): obj.__dict__["os"] = ("via set", v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class OnlySet:')
try:
    class OnlyDelete:
        def __delete__(self, obj): print("only delete", end="; ")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class OnlyDelete:')
try:
    class A:
        d = Data("d"); n = NonData(); os = OnlySet(); od = OnlyDelete(); plain = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A:')
try: a = A()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = A()')
try: print(a.d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.d')
try: a.d = 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.d = 5')
try: print('a.d =>', a.d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.d')
try: print('a.__dict__ =>', a.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.__dict__')
try: del a.d
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del a.d')
try: print(a.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.__dict__')
try: print(type(A.d).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(A.d).__name__')
try: a.__dict__["d"] = "in dict"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.__dict__["d"] = "in dict"')
try: print(a.d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.d')
try: print('a.n =>', a.n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.n')
try: print('A.n =>', A.n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.n')
try: a.n = "instance wins"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.n = "instance wins"')
try: print('a.n =>', a.n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.n')
try: print('a.__dict__["n"] =>', a.__dict__["n"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.__dict__["n"]')
try: del a.n
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del a.n')
try: print(a.n)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.n')
try: a.os = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.os = 1')
try: print('a.os =>', a.os)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.os')
try: print('a.__dict__["os"] =>', a.__dict__["os"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.__dict__["os"]')
try: print('type(A.os).__name__ =>', type(A.os).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(A.os).__name__')
try: print('type(A().os).__name__ =>', type(A().os).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(A().os).__name__')
try:
    def dos(): del a.os
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def dos(): del a.os')
try: print('dos() =>', end=" "); t(dos)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(dos)')
try: del a.od
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del a.od')
try: print(type(a.od).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(a.od).__name__')
try:
    def sod(): a.od = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sod(): a.od = 1')
try: print('sod() =>', end=" "); t(sod)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(sod)')
try: a.__dict__["od"] = "dict"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.__dict__["od"] = "dict"')
try: print(type(a.od).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(a.od).__name__')
try: A.d = "replaced on the class"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.d = "replaced on the class"')
try: print('a.d =>', a.d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.d')
try: print('A.d =>', A.d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.d')
# The order: data descriptor, instance dict, non-data descriptor or class attribute, __getattr__.
try:
    class Order:
        data = property(lambda s: "data descriptor")
        nond = NonData()
        cls = "class attr"
        def __getattr__(self, n): return "getattr " + n
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Order:')
try: o = Order()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o = Order()')
try: o.__dict__.update(data="dict", nond="dict", cls="dict", own="dict")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.__dict__.update(data="dict", nond="dict", cls="dict", own="dict")')
try: print('o.data =>', o.data)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.data')
try: print('o.nond =>', o.nond)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.nond')
try: print('o.cls =>', o.cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.cls')
try: print('o.own =>', o.own)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.own')
try: print('o.missing =>', o.missing)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.missing')
# Descriptors work only in the class, not in the instance.
try:
    class Holder: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Holder: pass')
try: h = Holder()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h = Holder()')
try: h.p = property(lambda s: 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h.p = property(lambda s: 1)')
try: h.n = NonData()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h.n = NonData()')
try: print('type(h.p).__name__ =>', type(h.p).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(h.p).__name__')
try: print('type(h.n).__name__ =>', type(h.n).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(h.n).__name__')
# Looked up on the type of the descriptor, not the descriptor instance.
try:
    class Fake: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Fake: pass')
try: fk = Fake()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fk = Fake()')
try: fk.__get__ = lambda *a: "never"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fk.__get__ = lambda *a: "never"')
try:
    class UsesFake: f = fk
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class UsesFake: f = fk')
try: print(UsesFake().f is fk)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: UsesFake().f is fk')
# __set_name__
try:
    class Named:
        def __set_name__(self, owner, name): print("set_name", owner.__name__, name, end="; "); self.owner = owner; self.name = name
        def __get__(self, o, t=None): return self.name
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Named:')
try:
    class U:
        first = Named(); second = Named(); alias = first
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class U:')
try: print('U().first =>', U().first)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: U().first')
try: print('U().second =>', U().second)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: U().second')
try: print('U().alias =>', U().alias)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: U().alias')
try: print('U.__dict__["first"].owner.__name__ =>', U.__dict__["first"].owner.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: U.__dict__["first"].owner.__name__')
try: U.late = Named()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: U.late = Named()')
try: print('U().late =>', end=" "); t(lambda: U().late)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: U().late)')
try: T = type("T", (), {"x": Named()})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T = type("T", (), {"x": Named()})')
try: print(T().x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T().x')
try:
    class BadSetName:
        def __set_name__(self, owner, name): raise ValueError("bad " + name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BadSetName:')
try:
    def bsn():
        class X: attr = BadSetName()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def bsn():')
try: print('bsn() =>', end=" "); t(bsn)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(bsn)')
try:
    try: bsn()
    except ValueError as e: print(e.__notes__, e.__cause__, e.__context__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: bsn()')
try:
    class NotCallableSetName: __set_name__ = 5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NotCallableSetName: __set_name__ = 5')
try:
    def ncsn():
        class X: attr = NotCallableSetName()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def ncsn():')
try: print('ncsn() =>', end=" "); t(ncsn)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(ncsn)')
try:
    class WrongArgs:
        def __set_name__(self): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WrongArgs:')
try:
    def wa():
        class X: attr = WrongArgs()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def wa():')
try: print('wa() =>', end=" "); t(wa)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(wa)')
try:
    class InstSetName: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class InstSetName: pass')
try: isn = InstSetName()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isn = InstSetName()')
try: isn.__set_name__ = lambda *a: print("never")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isn.__set_name__ = lambda *a: print("never")')
try:
    class X2: attr = isn
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class X2: attr = isn')
try: print("instance __set_name__ ignored")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "instance __set_name__ ignored"')
# Class-level access goes through the metaclass first.
try:
    class Meta(type):
        md = property(lambda cls: "meta data descriptor")
        mn = NonData()
        both = "meta attr"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Meta(type):')
try:
    class WithMeta(metaclass=Meta):
        md = "class attr hidden by meta data descriptor"; mn = "class attr wins over meta non-data"; both = "class attr"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class WithMeta(metaclass=Meta):')
try: print('WithMeta.md =>', WithMeta.md)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: WithMeta.md')
try: print('WithMeta.mn =>', WithMeta.mn)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: WithMeta.mn')
try: print('WithMeta.both =>', WithMeta.both)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: WithMeta.both')
try: print('WithMeta().md =>', WithMeta().md)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: WithMeta().md')
try: print('WithMeta().mn =>', WithMeta().mn)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: WithMeta().mn')
try: print('WithMeta().nope =>', end=" "); t(lambda: WithMeta().nope)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: WithMeta().nope)')
try:
    class MetaOnly(metaclass=Meta): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class MetaOnly(metaclass=Meta): pass')
try: print('MetaOnly.md =>', MetaOnly.md)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: MetaOnly.md')
try: print('MetaOnly.mn =>', MetaOnly.mn)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: MetaOnly.mn')
try: print('MetaOnly.both =>', MetaOnly.both)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: MetaOnly.both')
try: print('MetaOnly().md =>', end=" "); t(lambda: MetaOnly().md)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: MetaOnly().md)')
try: print('MetaOnly().both =>', end=" "); t(lambda: MetaOnly().both)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: MetaOnly().both)')
# Descriptors for special methods are honoured by implicit calls.
try:
    class SpecialDesc:
        def __get__(self, o, t=None): print("special get", o is not None, end="; "); return lambda *a: 42
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SpecialDesc:')
try:
    class SD:
        __len__ = SpecialDesc(); __call__ = SpecialDesc(); __getitem__ = SpecialDesc(); __hash__ = SpecialDesc(); __add__ = SpecialDesc(); __index__ = SpecialDesc(); __bool__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SD:')
try: sd = SD()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sd = SD()')
try: print('len(sd) =>', len(sd))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(sd)')
try: print('sd() =>', sd())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sd()')
try: print('sd[0] =>', sd[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sd[0]')
try: print('hash(sd) =>', hash(sd))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(sd)')
try: print('sd + 1 =>', sd + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sd + 1')
try: print('[0] * 50 and list(range(100))[sd] =>', [0] * 50 and list(range(100))[sd])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [0] * 50 and list(range(100))[sd]')
try:
    class StaticSpecial:
        @staticmethod
        def __len__(): return 7
        @classmethod
        def __call__(cls, a): return cls.__name__, a
        @staticmethod
        def __add__(o): return ("static add", o)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class StaticSpecial:')
try: print('len(StaticSpecial()) =>', len(StaticSpecial()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(StaticSpecial())')
try: print('StaticSpecial()(1) =>', StaticSpecial()(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: StaticSpecial()(1)')
try: print('StaticSpecial() + 5 =>', StaticSpecial() + 5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: StaticSpecial() + 5')
# Errors in __get__.
try:
    class RaisesAttr:
        def __get__(self, o, t=None): raise AttributeError("descriptor says no")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class RaisesAttr:')
try:
    class RA:
        x = RaisesAttr()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class RA:')
try:
    class RA2(RA):
        def __getattr__(self, n): return "fallback " + n
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class RA2(RA):')
try: print('RA().x =>', end=" "); t(lambda: RA().x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: RA().x)')
try: print('RA.x =>', end=" "); t(lambda: RA.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: RA.x)')
try: print('hasattr(RA(), "x") =>', hasattr(RA(), "x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(RA(), "x")')
try: print('hasattr(RA, "x") =>', hasattr(RA, "x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hasattr(RA, "x")')
try: print('getattr(RA(), "x", "d") =>', getattr(RA(), "x", "d"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: getattr(RA(), "x", "d")')
try: print('RA2().x =>', RA2().x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: RA2().x')
try:
    class BadGet:
        def __get__(self): return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BadGet:')
try:
    class BG: x = BadGet()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BG: x = BadGet()')
try: print('BG().x =>', end=" "); t(lambda: BG().x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: BG().x)')
try: print('BG.x =>', end=" "); t(lambda: BG.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: BG.x)')
try:
    class NoneGet: __get__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NoneGet: __get__ = None')
try:
    class NG: x = NoneGet()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NG: x = NoneGet()')
try: print('NG().x =>', end=" "); t(lambda: NG().x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: NG().x)')
try:
    class BadSet:
        def __set__(self, o): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BadSet:')
try:
    class BS: x = BadSet()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BS: x = BadSet()')
try:
    def sbs(): BS().x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def sbs(): BS().x = 1')
try: print('sbs() =>', end=" "); t(sbs)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(sbs)')
# A typical validating descriptor.
try:
    class Positive:
        def __set_name__(self, owner, name): self.priv = "_" + name
        def __get__(self, o, t=None): return self if o is None else getattr(o, self.priv)
        def __set__(self, o, v):
            if v <= 0: raise ValueError("%s must be positive" % self.priv[1:])
            setattr(o, self.priv, v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Positive:')
try:
    class Rect:
        w = Positive(); h = Positive()
        def __init__(self, w, h): self.w = w; self.h = h
        area = property(lambda s: s.w * s.h)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Rect:')
try: r = Rect(2, 3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = Rect(2, 3)')
try: print('r.area =>', r.area)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r.area')
try: print('r.__dict__ =>', r.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r.__dict__')
try: r.w = 10
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r.w = 10')
try: print(r.area)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r.area')
try: print('Rect(0, 1) =>', end=" "); t(lambda: Rect(0, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: Rect(0, 1))')
try: print('setattr(r, "h", -1) =>', end=" "); t(lambda: setattr(r, "h", -1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: setattr(r, "h", -1))')
try: print(r.h)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r.h')
try:
    class Cached:
        def __init__(self, f): self.f = f
        def __set_name__(self, o, n): self.n = n
        def __get__(self, o, t=None):
            if o is None: return self
            print("computing", end="; "); v = o.__dict__[self.n] = self.f(o); return v
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Cached:')
try:
    class UC:
        @Cached
        def val(self): return 99
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class UC:')
try: u = UC()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: u = UC()')
try: print('u.val =>', u.val)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: u.val')
try: print('u.val =>', u.val)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: u.val')
try: print('u.__dict__ =>', u.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: u.__dict__')
try: del u.val
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del u.val')
try: print(u.val)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: u.val')
# member descriptors, getset descriptors, mappingproxy
try:
    class Sl: __slots__ = ("a",)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Sl: __slots__ = ("a",)')
try: md = Sl.__dict__["a"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: md = Sl.__dict__["a"]')
try: s = Sl()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s = Sl()')
try: md.__set__(s, 5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: md.__set__(s, 5)')
try: print('type(md).__name__ =>', type(md).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(md).__name__')
try: print('md.__get__(s) =>', md.__get__(s))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: md.__get__(s)')
try: print('md.__name__ =>', md.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: md.__name__')
try: print('md.__objclass__.__name__ =>', md.__objclass__.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: md.__objclass__.__name__')
try: print('md.__get__(None, Sl) is md =>', md.__get__(None, Sl) is md)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: md.__get__(None, Sl) is md')
try: print('repr(md) =>', repr(md))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(md)')
try: print('md.__doc__ =>', md.__doc__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: md.__doc__')
try: md.__delete__(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: md.__delete__(s)')
try: print('md.__get__(s) =>', end=" "); t(lambda: md.__get__(s))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: md.__get__(s))')
try: print('md.__get__(1) =>', end=" "); t(lambda: md.__get__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: md.__get__(1))')
try: print('md.__set__(1, 2) =>', end=" "); t(lambda: md.__set__(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: md.__set__(1, 2))')
try: print('md.__delete__(s) =>', end=" "); t(lambda: md.__delete__(s))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: md.__delete__(s))')
try: gs = type.__dict__["__name__"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gs = type.__dict__["__name__"]')
try: print('type(gs).__name__ =>', type(gs).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(gs).__name__')
try: print('gs.__get__(int) =>', gs.__get__(int))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gs.__get__(int)')
try: print('gs.__name__ =>', gs.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gs.__name__')
try: print('gs.__objclass__ =>', gs.__objclass__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gs.__objclass__')
try: print('repr(gs) =>', repr(gs))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(gs)')
try: print('gs.__get__(1) =>', end=" "); t(lambda: gs.__get__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: gs.__get__(1))')
try: print('gs.__set__(int, "x") =>', end=" "); t(lambda: gs.__set__(int, "x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: gs.__set__(int, "x"))')
try: print('gs.__set__(1, "x") =>', end=" "); t(lambda: gs.__set__(1, "x"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: gs.__set__(1, "x"))')
try: mp = A.__dict__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mp = A.__dict__')
try: print('type(mp).__name__ =>', type(mp).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(mp).__name__')
try: print('"plain" in mp =>', "plain" in mp)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "plain" in mp')
try: print('mp["plain"] =>', mp["plain"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mp["plain"]')
try: print('mp.get("nope") =>', mp.get("nope"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mp.get("nope")')
try: print('mp.get("nope", 1) =>', mp.get("nope", 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mp.get("nope", 1)')
try: print('len(mp) > 3 =>', len(mp) > 3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(mp) > 3')
try: print('"plain" in list(mp) =>', "plain" in list(mp))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "plain" in list(mp)')
try: print('"plain" in mp.keys() =>', "plain" in mp.keys())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "plain" in mp.keys()')
try: print('1 in mp.values() =>', 1 in mp.values())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 1 in mp.values()')
try: print('("plain", 1) in mp.items() =>', ("plain", 1) in mp.items())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ("plain", 1) in mp.items()')
try: print('type(mp.copy()).__name__ =>', type(mp.copy()).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(mp.copy()).__name__')
try: print('mp == mp =>', mp == mp)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mp == mp')
try: print('mp == dict(mp) =>', mp == dict(mp))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mp == dict(mp)')
try: print('type(mp | {}).__name__ =>', type(mp | {}).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type(mp | {}).__name__')
try: print('type({} | mp).__name__ =>', type({} | mp).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: type({} | mp).__name__')
try: print('"plain" in reversed(mp) or True =>', "plain" in reversed(mp) or True)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "plain" in reversed(mp) or True')
try: print('mp["nope"] =>', end=" "); t(lambda: mp["nope"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: mp["nope"])')
try: print('mp.__setitem__ =>', end=" "); t(lambda: mp.__setitem__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: mp.__setitem__)')
try: print('mp.pop =>', end=" "); t(lambda: mp.pop)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: mp.pop)')
try: print('mp.update =>', end=" "); t(lambda: mp.update)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: mp.update)')
try: print('hash(mp) =>', end=" "); t(lambda: hash(mp))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: hash(mp))')
try:
    def smp(): mp["x"] = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def smp(): mp["x"] = 1')
try:
    def dmp(): del mp["plain"]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def dmp(): del mp["plain"]')
try:
    def imp():
        m = mp; m |= {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def imp():')
try: print('smp() =>', end=" "); t(smp)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(smp)')
try: print('dmp() =>', end=" "); t(dmp)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(dmp)')
try: print('imp() =>', end=" "); t(imp)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(imp)')
try: MP = type(mp)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: MP = type(mp)')
try: m2 = MP({"a": 1})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m2 = MP({"a": 1})')
try: print('m2 =>', m2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m2')
try: print('repr(m2) =>', repr(m2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: repr(m2)')
try: print('str(m2) =>', str(m2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: str(m2)')
try: print('m2["a"] =>', m2["a"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m2["a"]')
try: print('len(m2) =>', len(m2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(m2)')
try: print('list(m2) =>', list(m2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(m2)')
try: print('dict(m2) =>', dict(m2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: dict(m2)')
try: print('m2 == {"a": 1} =>', m2 == {"a": 1})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: m2 == {"a": 1}')
try: print('MP(m2) =>', MP(m2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: MP(m2)')
try: print('MP(frozendict(b=2)) =>', MP(frozendict(b=2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: MP(frozendict(b=2))')
try: src = {"a": 1}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: src = {"a": 1}')
try: view = MP(src)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: view = MP(src)')
try: src["b"] = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: src["b"] = 2')
try: print('view =>', view)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: view')
try: print('len(view) =>', len(view))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(view)')
try: print('MP() =>', end=" "); t(lambda: MP())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: MP())')
try: print('MP(1) =>', end=" "); t(lambda: MP(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: MP(1))')
try: print('MP([1]) =>', end=" "); t(lambda: MP([1]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: MP([1]))')
try: print('MP((1,)) =>', end=" "); t(lambda: MP((1,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: MP((1,)))')
try: print('MP("a") =>', end=" "); t(lambda: MP("a"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: MP("a"))')
try: print('MP({}, {}) =>', end=" "); t(lambda: MP({}, {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: MP({}, {}))')
try: print('MP(None) =>', end=" "); t(lambda: MP(None))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t(lambda: MP(None))')
