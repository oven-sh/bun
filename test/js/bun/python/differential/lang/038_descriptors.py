def t(f):
    try:
        print(repr(f()))
    except Exception as e:
        print(type(e).__name__ + ':', e)

class Data:
    def __init__(self, name): self.name = name
    def __get__(self, obj, typ=None):
        print("get", self.name, obj if obj is None else "obj", typ.__name__ if typ else typ, end="; ")
        return self if obj is None else obj.__dict__.get(self.name, "unset")
    def __set__(self, obj, v): print("set", self.name, v, end="; "); obj.__dict__[self.name] = v
    def __delete__(self, obj): print("delete", self.name, end="; "); del obj.__dict__[self.name]
class NonData:
    def __get__(self, obj, typ=None): return ("nondata", obj is None, typ.__name__)
class OnlySet:
    def __set__(self, obj, v): obj.__dict__["os"] = ("via set", v)
class OnlyDelete:
    def __delete__(self, obj): print("only delete", end="; ")
class A:
    d = Data("d"); n = NonData(); os = OnlySet(); od = OnlyDelete(); plain = 1
a = A()
print(a.d); a.d = 5; print(a.d, a.__dict__); del a.d; print(a.__dict__); print(type(A.d).__name__)
a.__dict__["d"] = "in dict"; print(a.d)
print(a.n, A.n); a.n = "instance wins"; print(a.n, a.__dict__["n"]); del a.n; print(a.n)
a.os = 1; print(a.os, a.__dict__["os"]); print(type(A.os).__name__, type(A().os).__name__)
def dos(): del a.os
t(dos)
del a.od; print(type(a.od).__name__)
def sod(): a.od = 1
t(sod)
a.__dict__["od"] = "dict"; print(type(a.od).__name__)
A.d = "replaced on the class"; print(a.d, A.d)
# The order: data descriptor, instance dict, non-data descriptor or class attribute, __getattr__.
class Order:
    data = property(lambda s: "data descriptor")
    nond = NonData()
    cls = "class attr"
    def __getattr__(self, n): return "getattr " + n
o = Order(); o.__dict__.update(data="dict", nond="dict", cls="dict", own="dict")
print(o.data, o.nond, o.cls, o.own, o.missing)
# Descriptors work only in the class, not in the instance.
class Holder: pass
h = Holder(); h.p = property(lambda s: 1); h.n = NonData(); print(type(h.p).__name__, type(h.n).__name__)
# Looked up on the type of the descriptor, not the descriptor instance.
class Fake: pass
fk = Fake(); fk.__get__ = lambda *a: "never"
class UsesFake: f = fk
print(UsesFake().f is fk)
# __set_name__
class Named:
    def __set_name__(self, owner, name): print("set_name", owner.__name__, name, end="; "); self.owner = owner; self.name = name
    def __get__(self, o, t=None): return self.name
class U:
    first = Named(); second = Named(); alias = first
print(U().first, U().second, U().alias, U.__dict__["first"].owner.__name__)
U.late = Named(); t(lambda: U().late)
T = type("T", (), {"x": Named()}); print(T().x)
class BadSetName:
    def __set_name__(self, owner, name): raise ValueError("bad " + name)
def bsn():
    class X: attr = BadSetName()
t(bsn)
try: bsn()
except ValueError as e: print(e.__notes__, e.__cause__, e.__context__)
class NotCallableSetName: __set_name__ = 5
def ncsn():
    class X: attr = NotCallableSetName()
t(ncsn)
class WrongArgs:
    def __set_name__(self): pass
def wa():
    class X: attr = WrongArgs()
t(wa)
class InstSetName: pass
isn = InstSetName(); isn.__set_name__ = lambda *a: print("never")
class X2: attr = isn
print("instance __set_name__ ignored")
# Class-level access goes through the metaclass first.
class Meta(type):
    md = property(lambda cls: "meta data descriptor")
    mn = NonData()
    both = "meta attr"
class WithMeta(metaclass=Meta):
    md = "class attr hidden by meta data descriptor"; mn = "class attr wins over meta non-data"; both = "class attr"
print(WithMeta.md, WithMeta.mn, WithMeta.both, WithMeta().md, WithMeta().mn)
t(lambda: WithMeta().nope)
class MetaOnly(metaclass=Meta): pass
print(MetaOnly.md, MetaOnly.mn, MetaOnly.both); t(lambda: MetaOnly().md); t(lambda: MetaOnly().both)
# Descriptors for special methods are honoured by implicit calls.
class SpecialDesc:
    def __get__(self, o, t=None): print("special get", o is not None, end="; "); return lambda *a: 42
class SD:
    __len__ = SpecialDesc(); __call__ = SpecialDesc(); __getitem__ = SpecialDesc(); __hash__ = SpecialDesc(); __add__ = SpecialDesc(); __index__ = SpecialDesc(); __bool__ = None
sd = SD(); print(len(sd), sd(), sd[0], hash(sd), sd + 1, [0] * 50 and list(range(100))[sd])
class StaticSpecial:
    @staticmethod
    def __len__(): return 7
    @classmethod
    def __call__(cls, a): return cls.__name__, a
    @staticmethod
    def __add__(o): return ("static add", o)
print(len(StaticSpecial()), StaticSpecial()(1), StaticSpecial() + 5)
# Errors in __get__.
class RaisesAttr:
    def __get__(self, o, t=None): raise AttributeError("descriptor says no")
class RA:
    x = RaisesAttr()
class RA2(RA):
    def __getattr__(self, n): return "fallback " + n
t(lambda: RA().x); t(lambda: RA.x); print(hasattr(RA(), "x"), hasattr(RA, "x"), getattr(RA(), "x", "d"), RA2().x)
class BadGet:
    def __get__(self): return 1
class BG: x = BadGet()
t(lambda: BG().x); t(lambda: BG.x)
class NoneGet: __get__ = None
class NG: x = NoneGet()
t(lambda: NG().x)
class BadSet:
    def __set__(self, o): pass
class BS: x = BadSet()
def sbs(): BS().x = 1
t(sbs)
# A typical validating descriptor.
class Positive:
    def __set_name__(self, owner, name): self.priv = "_" + name
    def __get__(self, o, t=None): return self if o is None else getattr(o, self.priv)
    def __set__(self, o, v):
        if v <= 0: raise ValueError("%s must be positive" % self.priv[1:])
        setattr(o, self.priv, v)
class Rect:
    w = Positive(); h = Positive()
    def __init__(self, w, h): self.w = w; self.h = h
    area = property(lambda s: s.w * s.h)
r = Rect(2, 3); print(r.area, r.__dict__); r.w = 10; print(r.area); t(lambda: Rect(0, 1)); t(lambda: setattr(r, "h", -1)); print(r.h)
class Cached:
    def __init__(self, f): self.f = f
    def __set_name__(self, o, n): self.n = n
    def __get__(self, o, t=None):
        if o is None: return self
        print("computing", end="; "); v = o.__dict__[self.n] = self.f(o); return v
class UC:
    @Cached
    def val(self): return 99
u = UC(); print(u.val, u.val, u.__dict__); del u.val; print(u.val)
# member descriptors, getset descriptors, mappingproxy
class Sl: __slots__ = ("a",)
md = Sl.__dict__["a"]; s = Sl(); md.__set__(s, 5); print(type(md).__name__, md.__get__(s), md.__name__, md.__objclass__.__name__, md.__get__(None, Sl) is md, repr(md), md.__doc__); md.__delete__(s); t(lambda: md.__get__(s)); t(lambda: md.__get__(1)); t(lambda: md.__set__(1, 2)); t(lambda: md.__delete__(s))
gs = type.__dict__["__name__"]; print(type(gs).__name__, gs.__get__(int), gs.__name__, gs.__objclass__, repr(gs)); t(lambda: gs.__get__(1)); t(lambda: gs.__set__(int, "x")); t(lambda: gs.__set__(1, "x"))
mp = A.__dict__; print(type(mp).__name__, "plain" in mp, mp["plain"], mp.get("nope"), mp.get("nope", 1), len(mp) > 3, "plain" in list(mp), "plain" in mp.keys(), 1 in mp.values(), ("plain", 1) in mp.items(), type(mp.copy()).__name__, mp == mp, mp == dict(mp), type(mp | {}).__name__, type({} | mp).__name__, "plain" in reversed(mp) or True)
t(lambda: mp["nope"]); t(lambda: mp.__setitem__); t(lambda: mp.pop); t(lambda: mp.update); t(lambda: hash(mp))
def smp(): mp["x"] = 1
def dmp(): del mp["plain"]
def imp():
    m = mp; m |= {}
t(smp); t(dmp); t(imp)
MP = type(mp); m2 = MP({"a": 1}); print(m2, repr(m2), str(m2), m2["a"], len(m2), list(m2), dict(m2), m2 == {"a": 1}, MP(m2), MP(frozendict(b=2)))
src = {"a": 1}; view = MP(src); src["b"] = 2; print(view, len(view))
t(lambda: MP()); t(lambda: MP(1)); t(lambda: MP([1])); t(lambda: MP((1,))); t(lambda: MP("a")); t(lambda: MP({}, {})); t(lambda: MP(None))
