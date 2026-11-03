# The same instruction gets, sets or calls an attribute again and again while what it may have remembered stops being true.
import sys, types

def get_x(o): return o.x
def set_x(o, v): o.x = v
def call_m(o, *a): return o.m(*a)
def get_m(o): return o.m
def try_(f, *a):
    try:
        return f(*a)
    except Exception as e:
        return type(e).__name__ + ": " + str(e)

def warm(f, *a):
    for _ in range(5):
        r = f(*a)
    return r

print("--- instance attribute, then the class changes")
class A:
    def __init__(self): self.x = 1
    def m(self, *a): return ("A.m", a)
a = A()
print(warm(get_x, a))
A.x = property(lambda self: "property")
print(get_x(a), try_(set_x, a, 5))
del A.x
print(get_x(a))
A.x = "class value"
print(get_x(a))
del a.x
print(warm(get_x, a))
A.x = "other class value"
print(get_x(a))
del A.x
print(try_(get_x, a))
a.x = 3
print(warm(get_x, a))

print("--- different layouts at one place")
class B:
    pass
b1 = B(); b1.x = 1; b1.y = 2
b2 = B(); b2.y = 2; b2.x = 10
b3 = B(); b3.z = 0; b3.y = 0; b3.x = 100
print([get_x(o) for o in (b1, b2, b3, b1, b1, b2, b2, b3, b3)])
for o in (b1, b2, b3, b1, b2, b3):
    set_x(o, get_x(o) + 1)
print([get_x(o) for o in (b1, b2, b3)], b1.__dict__, b2.__dict__, b3.__dict__)

print("--- adding attributes through one place")
objs = [B() for _ in range(6)]
for i, o in enumerate(objs):
    if i == 3: o.w = "first"
    set_x(o, i)
print([(get_x(o), list(vars(o))) for o in objs])

print("--- methods")
print(warm(call_m, a, 1))
A.m = lambda self, *a: ("new A.m", a)
print(call_m(a, 2))
a.m = lambda *a: ("on the instance", a)
print(warm(call_m, a, 3))
del a.m
print(warm(call_m, a, 4))
class A2(A):
    pass
a2 = A2()
print(warm(call_m, a2, 5))
A.m = lambda self, *a: ("newer A.m", a)
print(call_m(a2, 6))
A2.m = lambda self, *a: ("A2.m", a)
print(call_m(a2, 7), call_m(a, 7))
del A2.m
print(call_m(a2, 8))
A.m = staticmethod(lambda *a: ("static", a))
print(warm(call_m, a2, 9), warm(get_m, a2)(10))
A.m = classmethod(lambda cls, *a: ("class", cls.__name__, a))
print(warm(call_m, a2, 11), warm(call_m, a, 11), warm(get_m, a2)(12))
A.m = len
print(warm(call_m, a2, "four"))
A.m = B
print(type(warm(call_m, a2)).__name__)
A.m = 5
print(try_(call_m, a2), warm(get_m, a2))
class Callable:
    def __call__(self, *a): return ("callable object", a)
A.m = Callable()
print(warm(call_m, a2, 13))
class Descriptor:
    def __get__(self, o, t): return lambda *a: ("from __get__", type(o).__name__, a)
A.m = Descriptor()
print(warm(call_m, a2, 14))
a2.m = lambda *a: ("instance beats non-data descriptor", a)
print(warm(call_m, a2, 15))
Descriptor.__set__ = lambda self, o, v: None
print(warm(call_m, a2, 16))
del Descriptor.__set__
print(warm(call_m, a2, 17))

print("--- __dict__")
class C:
    def __init__(self): self.x = 1; self.y = 2
    def m(self): return "C.m"
c = C()
print(warm(get_x, c), warm(call_m, c))
d = c.__dict__
d["x"] = "through the dict"
print(get_x(c))
d["m"] = lambda: "in the dict"
print(call_m(c))
del d["m"]; del d["x"]
print(call_m(c), try_(get_x, c))
set_x(c, 9)
print(d, get_x(c))
c.__dict__ = {"x": "new dict"}
print(warm(get_x, c), d)
c2 = C()
print(warm(get_x, c2), get_x(c), get_x(c2))
vars(c2)["x"] = 7
print(get_x(c2), get_x(C()))
c3 = C()
c3.__dict__.clear()
print(try_(get_x, c3), c3.__dict__)
set_x(c3, 1); print(c3.__dict__)

print("--- __class__")
class D1:
    x = "D1.x"
    def m(self): return "D1.m"
class D2:
    x = "D2.x"
    def m(self): return "D2.m"
o = D1()
print(warm(get_x, o), warm(call_m, o))
o.__class__ = D2
print(warm(get_x, o), warm(call_m, o))
o.x = "own"
print(warm(get_x, o))
o.__class__ = D1
print(warm(get_x, o), warm(call_m, o))

print("--- __getattr__, __getattribute__, __setattr__ that come later")
class E:
    def __init__(self): self.x = 1
    def m(self): return "E.m"
e = E()
print(warm(get_x, e), warm(call_m, e))
E.__getattr__ = lambda self, name: "fallback " + name
print(get_x(e), call_m(e))
del e.x
print(warm(get_x, e))
del E.__getattr__
print(try_(get_x, e))
e.x = 2
print(warm(get_x, e))
E.__getattribute__ = lambda self, name: (lambda: "intercepted call") if name == "m" else "intercepted " + name
print(get_x(e), call_m(e))
del E.__getattribute__
print(get_x(e), call_m(e))
warm(set_x, e, 3)
log = []
E.__setattr__ = lambda self, name, value: log.append((name, value))
set_x(e, 4)
print(get_x(e), log)
del E.__setattr__
set_x(e, 5)
print(get_x(e))

print("--- __slots__")
class S:
    __slots__ = ("x", "y")
    def m(self): return "S.m"
s = S()
print(try_(get_x, s))
warm(set_x, s, 1)
print(warm(get_x, s), warm(call_m, s))
del s.x
print(try_(get_x, s))
set_x(s, 2)
print(get_x(s))
s2 = S(); s2.y = 0; s2.x = 5
print(get_x(s2), get_x(s), get_x(s2))
class S2(S):
    pass
s3 = S2(); s3.x = "slot"; s3.z = 1
print(warm(get_x, s3), s3.__dict__)
class S3(S):
    __slots__ = ()
    x = "hides the slot"
print(warm(get_x, S3()), try_(set_x, S3(), 1))

print("--- __bases__")
class F1:
    x = "F1.x"
    def m(self): return "F1.m"
class F2:
    x = "F2.x"
    def m(self): return "F2.m"
class G(F1):
    pass
g = G()
print(warm(get_x, g), warm(call_m, g))
G.__bases__ = (F2,)
print(warm(get_x, g), warm(call_m, g))

print("--- many attributes, and deleting")
class H:
    pass
h = H()
for i in range(200):
    setattr(h, "a%d" % i, i)
h.x = "after 200"
print(warm(get_x, h))
for i in range(0, 200, 2):
    delattr(h, "a%d" % i)
print(warm(get_x, h), len(vars(h)))
del h.x
print(try_(get_x, h))
h.x = "again"
print(warm(get_x, h))
k = H()
for _ in range(50):
    k.x = 1; k.y = 2
    del k.x
    assert try_(get_x, k).startswith("AttributeError")
    k.x = 3
    assert get_x(k) == 3
    del k.y; del k.x
print(vars(k))

print("--- names that are no property names")
n = H()
setattr(n, "0", "zero"); setattr(n, "x", 1); setattr(n, "", "empty"); setattr(n, "a b", "space"); setattr(n, "4294967295", "big")
print(vars(n), getattr(n, "0"), warm(get_x, n), getattr(n, ""), getattr(n, "4294967295"))
class Str(str):
    pass
n2 = H()
n2.x = 1
setattr(n2, Str("y"), 2)
print([(type(key).__name__, key) for key in vars(n2)], n2.y, warm(get_x, n2))
n3 = H(); n3.x = 1
print(getattr(n3, "x" + ""), getattr(n3, "".join(["x"])), hasattr(n3, "".join(["y", "z"])))

print("--- modules")
m = types.ModuleType("m")
m.x = 1
m.m = lambda *a: ("function of the module", a)
print(warm(get_x, m), warm(call_m, m, 1))
m.x = 2
print(get_x(m))
del m.x
print(try_(get_x, m))
m.__getattr__ = lambda name: "module fallback " + name
print(warm(get_x, m))
m.x = 3
print(warm(get_x, m))
m.__dict__["x"] = 4
print(get_x(m))
for i in range(100):
    setattr(m, "v%d" % i, i)
print(get_x(m), call_m(m, 2))
m2 = types.ModuleType("m2"); m2.x = "m2"
print([get_x(o) for o in (m, m2, m, m2, m2)])
class M(types.ModuleType):
    x = property(lambda self: "property of the module's class")
    def m(self, *a): return ("method of the module's class", a)
print(warm(get_x, m2))
m2.__class__ = M
print(get_x(m2), try_(call_m, m2, 3))
m2.__class__ = types.ModuleType
print(get_x(m2), try_(call_m, m2, 3))

print("--- built-in types and their subclasses at one place")
def call_count(o, v): return o.count(v)
def call_upper(o): return o.upper()
class L(list):
    def count(self, v): return "L.count"
class L2(list):
    pass
class T(str):
    def upper(self): return "T.upper"
print([call_count(o, 1) for o in ([1, 1], [1.5, 1], ["a"], (1, 1, 1), L([1]), [1], L2([1, 1]), "111", b"\x01", [], range(3))])
print([call_upper(o) for o in ("a", T("b"), "c", b"d", "e", bytearray(b"f"), T("g"))])
l2 = L2([1])
l2.count = lambda v: "on the instance"
print(call_count(l2, 1), call_count(L2([1]), 1), call_count([1], 1))
def call_get(o, key): return o.get(key)
class Dict(dict):
    pass
class Dict2(dict):
    def get(self, key): return "Dict2.get"
dd = Dict(a=1); dd2 = Dict(a=2); dd2.get = lambda key: "instance"
print([call_get(o, "a") for o in ({"a": 0}, dd, dd2, Dict2(a=3), {"a": 4}, dd, dd2)])

print("--- classes with the same layout")
class P1:
    k = "P1"
    def __init__(self): self.x = "p1"
class P2:
    k = "P2"
    def __init__(self): self.x = "p2"
def get_k(o): return o.k
print([(get_x(o), get_k(o)) for o in (P1(), P2(), P1(), P1(), P2(), P2())])

print("--- what a cached_property does")
import functools
class Q:
    calls = 0
    @functools.cached_property
    def x(self):
        Q.calls += 1
        return "computed"
q = Q()
print(warm(get_x, q), Q.calls, vars(q))
del q.x
print(warm(get_x, q), Q.calls)

print("--- classes that come and go")
import gc
def make(i):
    class Temp:
        def __init__(self): self.x = i
        def m(self): return i
    return Temp
total = 0
for i in range(300):
    t = make(i)()
    total += get_x(t) + call_m(t)
    set_x(t, 0)
    if i % 50 == 0:
        gc.collect()
print(total)

print("--- exceptions and functions have dicts of their own")
err = ValueError("v"); err.x = "on the exception"
def func(): pass
func.x = "on the function"
print([get_x(o) for o in (err, func, err, func)])
err2 = ValueError(); print(try_(get_x, err2))
ValueErrorSub = type("ValueErrorSub", (ValueError,), {"x": "class"})
e3 = ValueErrorSub()
print(warm(get_x, e3)); e3.x = "own"; print(warm(get_x, e3)); del e3.x; print(get_x(e3))
