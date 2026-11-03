import _struct as S

def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__module__ + "." + type(e).__name__, e)

def tn(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__)

import warnings
s = S.Struct("<ih")
print(s, s.format, s.size, repr(s), str(s), type(s).__name__, type(s).__module__, type(s).__qualname__, S.Struct.__mro__)
print(s.pack(1, 2), s.unpack(b"\1\0\0\0\2\0"), s.unpack_from(b"x\1\0\0\0\2\0", 1), s.unpack_from(buffer=b"\1\0\0\0\2\0", offset=0), list(s.iter_unpack(bytes(12))))
b = bytearray(8); print(s.pack_into(b, 1, 3, 4), b)
t(lambda: S.Struct()); t(lambda: S.Struct(1)); t(lambda: S.Struct("i", 1)); t(lambda: S.Struct(format="i")); t(lambda: S.Struct(fmt="i")); t(lambda: S.Struct(None)); t(lambda: S.Struct("z")); t(lambda: S.Struct("i", format="i")); t(lambda: S.Struct(b"i")); t(lambda: S.Struct("é")); t(lambda: S.Struct(bytearray(b"i"))); t(lambda: S.Struct(format="i", x=1))
t(lambda: s.pack()); t(lambda: s.pack(1, 2, 3)); t(lambda: s.pack(x=1)); t(lambda: s.unpack()); t(lambda: s.unpack("a")); t(lambda: s.unpack(b"a")); t(lambda: s.unpack(b"a", 1)); t(lambda: s.unpack(buffer=b"a")); t(lambda: s.unpack_from()); t(lambda: s.unpack_from(b"abcdef", 0, 1)); t(lambda: s.unpack_from(b"abcdef", x=1)); t(lambda: s.unpack_from(b"abc")); t(lambda: s.pack_into()); t(lambda: s.pack_into(b"abcdef", 0, 1, 2)); t(lambda: s.pack_into(bytearray(6))); t(lambda: s.pack_into(bytearray(6), 0)); t(lambda: s.pack_into(bytearray(6), 0, 1, 2, x=1)); t(lambda: s.pack_into("x", 0, 1, 2)); t(lambda: s.iter_unpack()); t(lambda: s.iter_unpack(1)); t(lambda: s.iter_unpack(b"abc")); t(lambda: s.iter_unpack(b"", 1))
print([S.Struct(f).__sizeof__() for f in ("", "i", "iii", "3i", "ihb", "3s", "x", "0i", "i x h")])
t(lambda: setattr(s, "format", "x")); t(lambda: setattr(s, "size", 1)); t(lambda: delattr(s, "format")); tn(lambda: setattr(s, "foo", "x")); tn(lambda: setattr(S.Struct, "foo", 1)); print(hash(s) == hash(s), s == s, s == S.Struct("<ih"), s != S.Struct("<ih"))
print(sorted(k for k in S.Struct.__dict__ if k not in ("__doc__", "__module__", "__getattribute__", "__setattr__", "__delattr__")))
print(S.Struct.__doc__)
import weakref
r = weakref.ref(s); print(r() is s)

def w(f):
    with warnings.catch_warnings(record=True) as log:
        warnings.simplefilter("always")
        t(f)
        for x in log: print("  warning:", x.category.__name__, x.message)
# Explicit __init__ calls
s = S.Struct("i"); w(lambda: s.__init__("i")); print(s.format, s.size); w(lambda: s.__init__(b"i")); w(lambda: s.__init__("h")); print(s.format, s.size, s.pack(1)); w(lambda: s.__init__("q")); print(s.format); w(lambda: s.__init__()); w(lambda: s.__init__("z")); print(s.format); w(lambda: s.__init__(1)); w(lambda: s.__init__("i", "i")); w(lambda: s.__init__(format="b")); print(s.format)
n = S.Struct.__new__(S.Struct); print(type(n).__name__, n.size); t(lambda: n.format); t(lambda: repr(n)); t(lambda: n.pack()); t(lambda: n.unpack(b"")); t(lambda: n.unpack_from(b"")); t(lambda: n.pack_into(bytearray(1), 0)); t(lambda: n.iter_unpack(b"")); t(lambda: n.__sizeof__()); t(lambda: n.unpack("x"))
w(lambda: n.__init__("h")); print(n, n.size)
n = S.Struct.__new__(S.Struct, "i"); print(n, n.size); w(lambda: n.__init__("i")); w(lambda: n.__init__("i")); n = S.Struct.__new__(S.Struct, "i"); w(lambda: n.__init__("h")); print(n)
w(lambda: S.Struct.__new__(S.Struct, "z")); w(lambda: S.Struct.__new__(S.Struct, 1)); w(lambda: S.Struct.__new__(S.Struct, "i", "h")); w(lambda: S.Struct.__new__(S.Struct, format="i")); w(lambda: S.Struct.__new__(S.Struct, fmt="i")); tn(lambda: S.Struct.__new__(int)); tn(lambda: S.Struct.__new__())
class Sub(S.Struct): pass
x = Sub("<h"); x.attr = 1; print(x, type(x).__name__, x.pack(1), x.attr, x.__dict__, isinstance(x, S.Struct)); w(lambda: Sub()); w(lambda: Sub("z")); w(lambda: Sub("i", 1)); w(lambda: Sub(format="i"))
class WithInit(S.Struct):
    def __init__(self, fmt, extra=None):
        super().__init__(fmt)
        self.extra = extra
w(lambda: WithInit("<h")); w(lambda: WithInit("<h", 5)); w(lambda: WithInit("<h", extra=5).extra); w(lambda: WithInit(fmt="<h")); w(lambda: WithInit("z")); w(lambda: WithInit(1))
class InitOther(S.Struct):
    def __init__(self, a): super().__init__("<q")
w(lambda: InitOther("<h")); w(lambda: InitOther("<q")); w(lambda: InitOther("zzz")); w(lambda: InitOther(5))
class NoSuperInit(S.Struct):
    def __init__(self, *a): pass
w(lambda: NoSuperInit("<h")); w(lambda: NoSuperInit()); w(lambda: NoSuperInit().size); w(lambda: NoSuperInit().pack()); w(lambda: NoSuperInit(1, 2, 3).size)
class WithNew(S.Struct):
    def __new__(cls, n): return super().__new__(cls, "%db" % n)
w(lambda: WithNew(3)); w(lambda: WithNew(3).size)
class WithNew2(S.Struct):
    def __new__(cls, *a, **k): return super().__new__(cls, *a, **k)
w(lambda: WithNew2("i")); w(lambda: WithNew2()); w(lambda: WithNew2("i", "h")); w(lambda: WithNew2("z")); w(lambda: WithNew2(format="i")); w(lambda: WithNew2(fmt="i")); w(lambda: WithNew2(1))
class WithBoth(S.Struct):
    def __new__(cls, n): return super().__new__(cls, "%db" % n)
    def __init__(self, n): self.n = n
w(lambda: WithBoth(2)); w(lambda: WithBoth(2).n)
with warnings.catch_warnings():
    warnings.simplefilter("error")
    s = S.Struct("i"); t(lambda: s.__init__("h")); print(s.format); t(lambda: NoSuperInit()); t(lambda: InitOther("zzz"))
