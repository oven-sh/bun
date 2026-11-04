# Attributes that are not simply in the object: of classes, static and class methods, fields of named tuples; and what changes under an instruction that has seen them.
import collections, enum, functools, types
out = []
def rec(label, f, *a):
    try:
        r = repr(f(*a))
    except Exception as e:
        r = type(e).__name__ + ":" + str(e)
    out.append("%s -> %s" % (label, r))
def thrice(f, *a):
    # The first time the instruction learns, then it knows.
    return [f(*a), f(*a), f(*a)]

# ---- One instruction each, given one object after another ----
def get_x(o): return o.x
def call_m(o): return o.m()
def call_m1(o, a): return o.m(a)
def get_m(o): return o.m

class A:
    x = 1
    def m(self=None, a="none"): return ("A.m", type(self).__name__, a)
class S:
    x = staticmethod(lambda: "S.x")
    @staticmethod
    def m(a="none"): return ("S.m", a)
class K:
    x = classmethod(lambda cls: ("K.x", cls.__name__))
    @classmethod
    def m(cls, a="none"): return ("K.m", cls.__name__, a)
class SubS(S): pass
class SubK(K): pass
module = types.ModuleType("module"); module.x = "module.x"; module.m = lambda a="none": ("module.m", a)
THINGS = [A, A(), S, S(), K, K(), SubS, SubS(), SubK, SubK(), module]
def shown(v): return v() if callable(v) else v
for n, o in enumerate(THINGS):
    rec("x %d" % n, lambda: [shown(v) for v in thrice(get_x, o)])
    rec("m() %d" % n, thrice, call_m, o)
    rec("m(1) %d" % n, thrice, call_m1, o, 1)
    rec("m %d" % n, lambda: [v(2) for v in thrice(get_m, o)])
rec("mixed", lambda: [(shown(get_x(o)), call_m(o), call_m1(o, n), get_m(o)(n)) for _ in range(3) for n, o in enumerate(THINGS)])
rec("identity", lambda: (S.m is S().m, S.m is S.__dict__["m"].__func__, K.m is K.m, K.m == K().m, K.m.__self__ is K, SubK().m.__self__ is SubK, A.m is A.__dict__["m"], A().m.__func__ is A.m))

# ---- What a static or class method wraps is replaced ----
class R:
    s = staticmethod(lambda: "first")
    c = classmethod(lambda cls: ("first", cls.__name__))
def rs(o): return o.s()
def rc(o): return o.c()
def rg(o): return o.s
r = R()
rec("wrapped", lambda: (thrice(rs, r), thrice(rs, R), thrice(rc, r), thrice(rc, R), rg(r)(), rg(R)()))
R.__dict__["s"].__init__(lambda: "second")
R.__dict__["c"].__init__(lambda cls: ("second", cls.__name__))
rec("wrapped anew", lambda: (thrice(rs, r), thrice(rs, R), thrice(rc, r), thrice(rc, R), rg(r)(), rg(R)()))
R.s = staticmethod(lambda: "third")
R.c = classmethod(lambda cls: "third")
rec("replaced", lambda: (thrice(rs, r), thrice(rs, R), thrice(rc, r), thrice(rc, R), rg(r)(), rg(R)()))
R.s = lambda *a: ("function", len(a))
R.c = 5
rec("other kinds", lambda: (thrice(rs, r), thrice(rs, R), rg(r)(), rg(R)()))
rec("not callable", rc, r)
rec("not callable, class", rc, R)
r.s = lambda: "of the instance"
rec("in the instance", lambda: (thrice(rs, r), thrice(rs, R)))
del r.s, R.s
rec("gone", rs, r)
rec("gone, class", rs, R)
class Odd:
    none = staticmethod(None)
    cnone = classmethod(None)
    cls = staticmethod(int)
    ccls = classmethod(dict)
    part = classmethod(functools.partial(lambda *a: [getattr(v, "__name__", v) for v in a], "p"))
    nested = staticmethod(staticmethod(lambda: "nested"))
    prop = classmethod(property(lambda cls: "property"))
for name in ("none", "cnone", "cls", "ccls", "part", "nested", "prop"):
    for o in (Odd, Odd()):
        def call(o=o, name=name): return eval("o.%s()" % name)
        rec("odd %s %s" % (name, type(o).__name__), call)
def odd_none(o): return o.none
def odd_call(o): return o.none()
rec("odd get", lambda: (thrice(odd_none, Odd), thrice(odd_none, Odd())))
rec("odd call", odd_call, Odd); rec("odd call", odd_call, Odd); rec("odd call", odd_call, Odd())

# Classes derived from staticmethod and classmethod.
class MyStatic(staticmethod):
    def __get__(self, o, t=None): return lambda: ("MyStatic", o is None, t.__name__)
class MyClass(classmethod):
    def __get__(self, o, t=None): return lambda: ("MyClass", o is None, t.__name__)
class PlainStatic(staticmethod): pass
class PlainClass(classmethod): pass
class D:
    a = MyStatic(lambda: 0)
    b = MyClass(lambda cls: 0)
    c = PlainStatic(lambda: "plain static")
    d = PlainClass(lambda cls: ("plain class", cls.__name__))
def da(o): return o.a()
def db(o): return o.b()
def dc(o): return o.c()
def dd(o): return o.d()
rec("derived", lambda: [thrice(f, o) for f in (da, db, dc, dd) for o in (D, D())])
PlainStatic.__get__ = lambda self, o, t=None: lambda: "now it has a __get__"
PlainClass.__get__ = lambda self, o, t=None: lambda: "this one too"
rec("derived, changed", lambda: [thrice(f, o) for f in (dc, dd) for o in (D, D())])

# ---- Attributes of classes ----
class Base:
    v = "Base.v"
    def f(self): return "Base.f"
class Mid(Base): pass
class Leaf(Mid): pass
def cv(c): return c.v
def cf(c): return c.f
def ccall(c, *a): return c.f(*a)
rec("class", lambda: (thrice(cv, Leaf), thrice(cv, Mid), cf(Leaf) is Base.f, thrice(ccall, Leaf, None)))
Base.v = "Base.v 2"
rec("base set", thrice, cv, Leaf)
Mid.v = "Mid.v"
rec("mid set", lambda: (thrice(cv, Leaf), thrice(cv, Mid), thrice(cv, Base)))
del Mid.v
rec("mid deleted", thrice, cv, Leaf)
Leaf.f = lambda *a: "Leaf.f"
rec("leaf f", lambda: (thrice(ccall, Leaf), thrice(ccall, Mid, None)))
class Other: v = "Other.v"
Leaf.__bases__ = (Other,)
rec("bases", lambda: (thrice(cv, Leaf), Leaf.__mro__[1].__name__))
del Base.v
rec("deleted", cv, Mid)
rec("missing", lambda: [cv(Leaf), cv(Other)])
rec("of type", lambda: [(c.__name__, c.__qualname__, c.__module__, c.__mro__[-1].__name__, type(c.__dict__).__name__, c.__bases__[0].__name__, c.__doc__, c.mro()[0].__name__) for _ in range(3) for c in (Leaf, Base, int, type)])
def name_of(c): return c.__name__
rec("name", lambda: (thrice(name_of, Leaf), thrice(name_of, int)))
Leaf.__name__ = "Renamed"
rec("renamed", thrice, name_of, Leaf)
rec("built in", lambda: [(int.bit_length(5), str.upper("a"), dict.fromkeys("ab"), object.__new__(Base).f(), int.__add__(1, 2), list.__len__([1]), int.from_bytes(b"\x01"), type.__call__(int, "7"), int.real.__get__(3), float.fromhex("0x1p3"),
                          bytes.maketrans(b"a", b"b")[97], str.maketrans("a", "b"), tuple.__new__(tuple, "ab"), dict.__name__) for _ in range(3)])
class Outer:
    class Inner: w = "inner"
    t = (1, 2); l = [3]; d = {4: 5}; s = "str"; n = None; i = 10 ** 30; fl = 1.0; b = True; fz = frozenset({6}); p = property(lambda self: "property"); e = Ellipsis
rec("values", lambda: [(Outer.Inner.w, Outer.t, Outer.l, Outer.d, Outer.s, Outer.n, Outer.i, Outer.fl, Outer.b, Outer.fz, type(Outer.p).__name__, Outer().p, Outer.e, Outer().t, Outer().Inner.w) for _ in range(3)])

# ---- The class of the class ----
class Meta(type):
    inMeta = "Meta.inMeta"
    both = "Meta.both"
    def metaMethod(cls): return ("metaMethod", cls.__name__)
    @property
    def metaProperty(cls): return ("metaProperty", cls.__name__)
class WithMeta(metaclass=Meta):
    both = "WithMeta.both"
    metaProperty = "hidden by the property"
    later = "WithMeta.later"
def m_both(c): return c.both
def m_in(c): return c.inMeta
def m_method(c): return c.metaMethod()
def m_prop(c): return c.metaProperty
def m_later(c): return c.later
rec("meta", lambda: (thrice(m_both, WithMeta), thrice(m_in, WithMeta), thrice(m_method, WithMeta), thrice(m_prop, WithMeta), thrice(m_later, WithMeta)))
rec("meta, instance", lambda: (WithMeta().both, WithMeta().metaProperty))
rec("meta, instance has none", lambda: WithMeta().inMeta)
Meta.later = property(lambda cls: "a property of Meta now")
rec("meta gets a property", thrice, m_later, WithMeta)
del Meta.later
rec("meta loses it", thrice, m_later, WithMeta)
Meta.later = "not a data descriptor"
rec("meta gets a value", thrice, m_later, WithMeta)
Meta.__getattribute__ = lambda cls, name: "all the same" if name == "later" else type.__getattribute__(cls, name)
rec("meta __getattribute__", lambda: (thrice(m_later, WithMeta), thrice(m_both, WithMeta)))
del Meta.__getattribute__
rec("and without", lambda: (thrice(m_later, WithMeta), thrice(m_both, WithMeta)))
Meta.__getattr__ = lambda cls, name: ("fallback", name)
rec("meta __getattr__", lambda: (thrice(m_later, WithMeta), WithMeta.nothing, thrice(cv, WithMeta)))
class Meta2(type):
    both = property(lambda cls: "Meta2.both")
rec("before the class changes class", thrice, m_both, WithMeta)
WithMeta.__class__ = Meta2
rec("after", thrice, m_both, WithMeta)
WithMeta.__class__ = Meta
rec("and back", thrice, m_both, WithMeta)
class MK(type):
    @classmethod
    def mc(mcs): return ("mc", mcs.__name__)
    @staticmethod
    def ms(): return "ms"
class UsesMK(metaclass=MK): pass
rec("methods of the metaclass", lambda: [(UsesMK.mc(), UsesMK.ms(), MK.mc(), MK.ms()) for _ in range(3)])

# ---- Values whose own class decides what they do as attributes ----
class Color(enum.Enum):
    RED = 1
    GREEN = 2
    def describe(self): return self.name.lower()
    @classmethod
    def first(cls): return cls.RED
    @staticmethod
    def count(): return len(Color)
class Flags(enum.IntFlag):
    A = 1
    B = 2
def red(c): return c.RED
rec("enum", lambda: (thrice(red, Color), red(Color) is Color(1), Color.RED.describe(), thrice(Color.first), thrice(Color.count), Color.GREEN.value, Color.RED.name, Flags.A | Flags.B, Flags.A.value, Color["RED"], Color.RED.GREEN))
class Own:
    pass
Own.me = Own(); Own.me.tag = "me"
class OwnSub(Own): pass
def me(o): return o.me
def tag(v): return getattr(v, "tag", v)
rec("of its own class", lambda: [tag(v) for o in (Own, OwnSub, Own(), OwnSub()) for v in thrice(me, o)])
Own.__get__ = lambda self, o, t=None: ("bound", o is None, t.__name__)
rec("the class gets a __get__", lambda: [tag(v) for o in (Own, OwnSub, Own(), OwnSub()) for v in thrice(me, o)])
del Own.__get__
rec("and loses it", lambda: [tag(v) for o in (Own, OwnSub, Own(), OwnSub()) for v in thrice(me, o)])
Own.__set__ = lambda self, o, v: None
holder = Own(); holder.__dict__["me"] = "in the instance"
rec("with a __set__ alone", lambda: [tag(v) for v in thrice(me, holder)])
del Own.__set__
rec("without", lambda: [tag(v) for v in thrice(me, holder)])
class Getter(Own):
    def __get__(self, o, t=None): return ("Getter", o is None, t.__name__)
rec("before the value changes class", lambda: [tag(v) for o in (Own, OwnSub, Own(), OwnSub()) for v in thrice(me, o)])
Own.__dict__["me"].__class__ = Getter
rec("after", lambda: [tag(v) for o in (Own, OwnSub, Own(), OwnSub()) for v in thrice(me, o)])
Own.__dict__["me"].__class__ = Own
rec("and back", lambda: [tag(v) for o in (Own, OwnSub, Own(), OwnSub()) for v in thrice(me, o)])
# It goes to a class that has nothing to do with the one it is an attribute of, and that class changes later.
class Home: pass
class Away: pass
Home.x = Home(); home = Home()
def shown_x(v): return v if isinstance(v, (int, str)) else type(v).__name__
# One function for each, so that what the instruction knows is not replaced in between.
def hx(o): return shown_x(o.x)
def hxc(c): return shown_x(c.x)
def sx(o, v): o.x = v
rec("at home", lambda: (thrice(hx, home), thrice(hxc, Home)))
Home.__dict__["x"].__class__ = Away
rec("away", lambda: (thrice(hx, home), thrice(hxc, Home)))
Away.__get__ = lambda self, o, t=None: 42
# (Home.x as well, by the rules of the language; CPython 3.15 goes on with what its own instruction remembers.)
rec("away gets a __get__", thrice, hx, home)
del Away.__get__
class Home2: pass
Home2.x = Home2(); home2 = Home2(); stored = []
rec("stores", lambda: (sx(home2, 1), sx(home2, 2), sx(home2, 3), home2.__dict__))
Home2.__dict__["x"].__class__ = Away
rec("stores, away", lambda: (sx(home2, 4), sx(home2, 5), home2.__dict__))
Away.__set__ = lambda self, o, v: stored.append(v)
rec("stores, away has a __set__", lambda: (sx(home2, 6), sx(home2, 7), home2.__dict__, stored))
del Away.__set__
class Stranger: pass
class Has: s = Stranger()
def get_s(o): return type(o.s).__name__ if not isinstance(o.s, str) else o.s
rec("of another class", lambda: (thrice(get_s, Has), thrice(get_s, Has())))
Stranger.__get__ = lambda self, o, t=None: "Stranger.__get__"
rec("which gets a __get__", lambda: (thrice(get_s, Has), thrice(get_s, Has())))

# ---- Named tuples ----
Point = collections.namedtuple("Point", "x y z")
class Point3(Point):
    __slots__ = ()
    @property
    def sum(self): return self.x + self.y + self.z
class PointD(Point): pass
def px(p): return p.x
def pz(p): return p.z
p, q, d = Point(1, 2, 3), Point3(4, 5, 6), PointD(7, 8, 9)
d.extra = "extra"
rec("fields", lambda: (thrice(px, p), thrice(pz, p), thrice(px, q), thrice(pz, q), thrice(pz, d), q.sum, d.extra, [pz(v) for _ in range(3) for v in (p, q, d)]))
short = tuple.__new__(Point, (1,))
rec("short x", thrice, px, short)
rec("short z", pz, short); rec("short z", pz, short)
rec("then whole", thrice, pz, p)
rec("class", lambda: (type(Point.x).__name__, Point.x.__doc__, Point.x.__get__(p), Point.z.__get__((1, 2, 3))))
rec("set", setattr, p, "x", 5)
rec("delete", delattr, p, "x")
rec("call a field", lambda: Point(len, 2, 3).x("abc"))
rec("call a field", lambda: [Point(len, 2, 3).x("abc") for _ in range(3)])
rec("not a tuple", Point.x.__get__, [1])
Point.z = Point.x
rec("another getter", thrice, pz, p)
Point.z = property(lambda self: "a property")
rec("a property", lambda: (thrice(pz, p), thrice(pz, q)))
del Point.z
rec("none", pz, p)
class NotTuple: x = Point.x
rec("in a class that is no tuple", px, NotTuple())
rec("in a class that is no tuple", px, NotTuple())
Big = collections.namedtuple("Big", ["f%d" % i for i in range(300)])
big = Big(*range(300))
rec("big", lambda: [(big.f0, big.f255, big.f256, big.f299) for _ in range(3)])

# ---- A class that keeps changing ----
class Busy:
    n = 0
    def m(self): return "m"
    @staticmethod
    def s(): return "s"
    @classmethod
    def c(cls): return cls.n
class BusySub(Busy): pass
def busy(rounds):
    b = BusySub(); b.own = "own"; seen = set(); total = 0
    for i in range(rounds):
        Busy.n += 1
        total += Busy.n + BusySub.n + b.n + b.c() + BusySub.c()
        seen.add((b.own, b.m(), b.s(), Busy.s()))
        if i % 500 == 499: Busy.m = lambda self, i=i: i
    return total, sorted(seen, key=str), Busy.n
rec("busy", busy, 2500)
rec("busy still", busy, 10)
class Calm(Busy): n = "calm"
rec("derived from it", lambda: [(Calm.n, Calm().n, Calm.c(), Calm().s()) for _ in range(3)])
print("\n".join(out))
print(len(out))
