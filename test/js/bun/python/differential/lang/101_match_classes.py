def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__ + ':', e)

class Point:
    __match_args__ = ("x", "y")
    def __init__(s, x, y): s.x = x; s.y = y
class Point3(Point):
    __match_args__ = ("x", "y", "z")
    def __init__(s, x, y, z): super().__init__(x, y); s.z = z
class NoArgs:
    def __init__(s, **k): s.__dict__.update(k)
def cls(p):
    match p:
        case Point(0, 0): return "origin"
        case Point(0, y): return ("on y axis", y)
        case Point(x=x, y=0): return ("on x axis", x)
        case Point3(x, y, z): return ("3d", x, y, z)
        case Point(x, y=y) if x == y: return ("diagonal", x)
        case Point(): return "some point"
        case NoArgs(a=1, b=b): return ("noargs", b)
        case NoArgs(): return "noargs any"
        case _: return "other"
print([cls(v) for v in (Point(0, 0), Point(0, 5), Point(5, 0), Point3(1, 2, 3), Point3(0, 0, 9), Point(4, 4), Point(1, 2), NoArgs(a=1, b=2), NoArgs(a=2, b=2), NoArgs(a=1), 5, None, Point)])
# Built-in types take one positional sub-pattern that matches the whole subject.
def bi(x):
    match x:
        case bool(b): return ("bool", b)
        case int(i): return ("int", i)
        case float(f): return ("float", f)
        case str(s): return ("str", s)
        case bytes(b): return ("bytes", b)
        case bytearray(b): return ("bytearray", b)
        case list(l): return ("list", l)
        case tuple(t_): return ("tuple", t_)
        case dict(d): return ("dict", d)
        case set(s): return ("set", s)
        case frozenset(s): return ("frozenset", s)
        case complex(): return "complex has no self-matching"
        case range(): return "range"
        case type(): return "a class"
        case object(): return "object"
class MyInt(int): pass
class MyStr(str): pass
print([bi(v) for v in (True, 1, 1.5, "s", b"b", bytearray(b"a"), [1], (1,), {1: 2}, {1}, frozenset({1}), 1j, range(1), int, None, MyInt(3), MyStr("m"))])
def bi2(x):
    match x:
        case int(0 | 1): return "bit"
        case int(n) if n > 100: return "large"
        case str("a" | "b" as s): return "ab:" + s
        case list([1, *r]): return ("list starting with 1", r)
        case dict({"k": v}): return ("dict with k", v)
        case tuple((a, b)): return ("pair", a, b)
        case int(real=r, imag=0): return ("attributes of int", r)
        case str(): return "str"
print([bi2(v) for v in (0, 1, 500, "a", [1, 2], {"k": 3}, (1, 2), 7, "zz", True)])
t(lambda: exec("match 1:\n case int(1, 2): pass")); t(lambda: exec("match 'a':\n case str(a, b): pass")); t(lambda: exec("match 1j:\n case complex(a): pass")); t(lambda: exec("match 1:\n case object(a): pass")); t(lambda: exec("match range(1):\n case range(a): pass")); t(lambda: exec("match []:\n case list(a, b, c): pass")); t(lambda: exec("match 1.5:\n case int(1, 2): pass\nprint('not an instance: the count is not checked')"))
# Errors.
def too_many(p):
    match p:
        case Point(1, 2, 3): return "?"
def no_match_args(p):
    match p:
        case NoArgs(1): return "?"
def not_a_class(p):
    x = 5
    match p:
        case x(): return "?"
def not_a_class2(p):
    f = len
    match p:
        case f(): return "?"
def dup_attr(p):
    match p:
        case Point(1, x=1): return "?"
def undefined_class(p):
    match p:
        case Undefined(): return "?"
def inst_as_class(p):
    c = Point(1, 2)
    match p:
        case c(): return "?"
def union_class(p):
    u = int | str
    match p:
        case u(): return "union"
def generic_class(p):
    g = list[int]
    match p:
        case g(): return "?"
def tuple_class(p):
    tt = (int, str)
    match p:
        case tt(): return "?"
for f in (too_many, no_match_args, not_a_class, not_a_class2, dup_attr, undefined_class, inst_as_class, union_class, generic_class, tuple_class): t(lambda: f(Point(1, 2)))
t(lambda: too_many(5)); t(lambda: no_match_args(5)); t(lambda: union_class(5))
def bad_ma(ma):
    C = type("C", (), {"__match_args__": ma, "a": 1, "b": 2})
    match C():
        case C(x): return ("matched", x)
    return "no match"
t(lambda: bad_ma(("a",))); t(lambda: bad_ma(["a"])); t(lambda: bad_ma("a")); t(lambda: bad_ma((1,))); t(lambda: bad_ma(())); t(lambda: bad_ma(None)); t(lambda: bad_ma(("missing",))); t(lambda: bad_ma((b"a",))); t(lambda: bad_ma(("a", "a")))
def dup_ma():
    C = type("C", (), {"__match_args__": ("a", "a"), "a": 1})
    match C():
        case C(x, y): return (x, y)
t(dup_ma)
class TupSub(tuple): pass
t(lambda: bad_ma(TupSub(("a",))))
# Attribute lookup.
class Props:
    __match_args__ = ("p", "q")
    @property
    def p(s): print("p read", end="; "); return 1
    @property
    def q(s): print("q read", end="; "); raise AttributeError("q is missing")
    @property
    def r(s): raise ValueError("not an AttributeError")
def props(x):
    match x:
        case Props(2): return "p is 2"
        case Props(1, q): return "has q"
        case Props(p=1, q=_): return "has q by keyword"
        case Props(p=v): return ("p only", v)
print(props(Props()))
def props_err(x):
    match x:
        case Props(r=_): return "?"
t(lambda: props_err(Props()))
class GA:
    def __getattr__(s, n):
        if n.startswith("dyn"): return n
        raise AttributeError(n)
match GA():
    case GA(dyn_a=a, dyn_b=b): print(a, b)
match GA():
    case GA(other=o): print("no")
    case GA(): print("missing attribute: no match")
class ClsAttr: shared = "class attribute"
match ClsAttr():
    case ClsAttr(shared=s): print(s)
match Point(1, 2):
    case Point(x=1, y=2, __class__=c): print(c.__name__)
match Point(1, None):
    case Point(y=None): print("None attribute matches None")
# isinstance semantics, including __instancecheck__.
class Meta(type):
    def __instancecheck__(c, o): print("instancecheck", end="; "); return o == "magic"
class Virtual(metaclass=Meta): pass
def virt(x):
    match x:
        case Virtual(): return "virtual instance"
        case _: return "no"
print(virt("magic"), virt("plain"))
class Base: pass
class Derived(Base): pass
def inh(x):
    match x:
        case Derived(): return "derived"
        case Base(): return "base"
print(inh(Derived()), inh(Base()), inh(1))
# Dotted class names, nested patterns.
class NSp:
    class Inner:
        __match_args__ = ("v",)
        def __init__(s, v): s.v = v
match NSp.Inner(5):
    case NSp.Inner(v): print("dotted class", v)
import sys
match sys:
    case sys.__class__(): print("module type via dotted name")
class Line:
    __match_args__ = ("a", "b")
    def __init__(s, a, b): s.a = a; s.b = b
def line(l):
    match l:
        case Line(Point(0, 0), Point(x, y)): return ("from origin to", x, y)
        case Line(Point(x=x1), Point(x=x2)) if x1 == x2: return "vertical"
        case Line(a=Point() as p, b=None): return ("open", p.x)
        case Line([Point(x, _), *_], _): return ("list of points", x)
        case Line({"p": Point(y=y)}, _): return ("dict of points", y)
print([line(v) for v in (Line(Point(0, 0), Point(1, 2)), Line(Point(3, 0), Point(3, 9)), Line(Point(7, 7), None), Line([Point(4, 5)], 0), Line({"p": Point(1, 8)}, 0), Line(1, 2))])
# Exceptions, types, and other objects as subjects.
def exc(e):
    match e:
        case ValueError(args=(msg,)): return ("ValueError", msg)
        case OSError(errno=2, filename=f): return ("ENOENT", f)
        case KeyError() | IndexError(): return "lookup"
        case Exception(args=[]): return "no args"
        case BaseException(): return "base"
print([exc(v) for v in (ValueError("m"), OSError(2, "x", "f.txt"), KeyError("k"), IndexError(), RuntimeError(), KeyboardInterrupt("x"), ValueError(1, 2))])
def ty(x):
    match x:
        case type(__name__="int"): return "the int class"
        case type(__name__=n): return ("class", n)
print(ty(int), ty(str), ty(1))
def sl(x):
    match x:
        case slice(start=None, stop=s, step=None): return ("simple slice", s)
        case slice(start=a, stop=b, step=c): return (a, b, c)
print(sl(slice(5)), sl(slice(1, 2, 3)))
# __match_args__ inheritance and overriding.
class A:
    __match_args__ = ("a",)
    a = 1; b = 2
class B(A): pass
class C(A): __match_args__ = ("b", "a")
match B():
    case B(v): print("inherited", v)
match C():
    case C(v, w): print("overridden", v, w)
match C():
    case A(v): print("the pattern's class decides", v)
print(int.__dict__.get("__match_args__"), hasattr(int, "__match_args__"), Point.__match_args__, type(sys.version_info).__match_args__[:2], type(sys.float_info).__match_args__[:1])
match sys.version_info:
    case (3, minor, *_) if minor >= 15: print("version tuple")
match sys.version_info:
    case sys.version_info.__class__(3, m): print("structseq positional", m >= 15)
# Keyword patterns evaluate in order; positional first.
class Ord:
    __match_args__ = ("p1", "p2")
    def __getattr__(s, n): print("read", n, end="; "); return n
match Ord():
    case Ord(_, _, k2=_, k1=_): print()
match Ord():
    case Ord("nope", _, k1=_): print("no")
    case _: print("stops at the first failure")
