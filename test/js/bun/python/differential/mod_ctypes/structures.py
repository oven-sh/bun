# Structure and Union: layout, fields, bit fields, anonymous members, byte order, errors.
import ctypes, _ctypes, re, sys
from ctypes import *
from _ctypes import _Pointer, _SimpleCData, CFuncPtr as _CFuncPtr

def show(label, f):
    try:
        r = f()
    except BaseException as e:
        r = "%s: %s" % (type(e).__name__, e)
    print(ascii(label)[1:-1], ascii(re.sub(r"0x[0-9a-f]+", "ADDR", repr(r) if not isinstance(r, str) else r))[1:-1])

def describe(cls):
    print(cls.__name__, sizeof(cls), alignment(cls), _ctypes.buffer_info(cls))
    for item in cls._fields_:
        f = getattr(cls, item[0])
        print("  ", repr(f), f.name, f.type.__name__, f.offset, f.byte_offset, f.byte_size, f.size, f.bit_size, f.bit_offset, f.is_bitfield, f.is_anonymous)

class Point(Structure):
    _fields_ = [("x", c_int), ("y", c_int)]
describe(Point)
p = Point(1, 2)
show("values", lambda: (p.x, p.y, bytes(p), p._objects, p._b_needsfree_, p._b_base_))
show("keyword", lambda: (lambda q: (q.x, q.y))(Point(y=5)))
show("both", lambda: Point(1, x=2))
show("too many", lambda: Point(1, 2, 3))
show("unknown keyword", lambda: Point(z=3).z)
show("bad value", lambda: Point("a"))
show("delete", lambda: delattr(p, "x"))
show("repr", lambda: repr(p))
show("class attribute", lambda: Point.x.__get__(None, Point) is Point.__dict__["x"])
show("field on int", lambda: Point.x.__get__(5))
show("field set on int", lambda: Point.x.__set__(5, 1))
show("CField()", lambda: _ctypes.CField())
show("CField(...)", lambda: _ctypes.CField(name="a", type=c_int, byte_size=4, byte_offset=0, index=0, _internal_use=False))
for kw in (dict(byte_size=-1), dict(type=int), dict(byte_size=3), dict(bit_size=3), dict(bit_size=3, bit_offset=30), dict(bit_size=0, bit_offset=0), dict(bit_size=300, bit_offset=0),
           dict(bit_size=3, bit_offset=-1), dict(bit_offset=1), dict(type=c_double, byte_size=8, bit_size=3, bit_offset=0), dict(type=c_char, byte_size=1, bit_size=3, bit_offset=0), dict(name=5), dict(bit_size=3, bit_offset=2)):
    args = dict(name="a", type=c_int, byte_size=4, byte_offset=0, index=0, _internal_use=True)
    args.update(kw)
    show("CField %r" % sorted(kw), lambda: _ctypes.CField(**args))

class Mixed(Structure):
    _fields_ = [("a", c_char), ("b", c_double), ("c", c_short), ("d", c_char * 3), ("e", c_void_p), ("f", c_wchar * 2), ("g", c_longdouble), ("h", c_bool), ("i", Point), ("j", Point * 2), ("k", POINTER(c_int)), ("l", c_float)]
describe(Mixed)
m = Mixed(b"x", 1.5, -2, b"ab", None, "hi", 2.5, True, Point(3, 4), (Point * 2)(Point(5, 6), Point(7, 8)), None, 0.5)
show("mixed", lambda: (m.a, m.b, m.c, m.d, m.e, m.f, m.g, m.h, m.i.x, m.i.y, m.j[1].y, bool(m.k), m.l))
show("tuple for struct", lambda: (setattr(m, "i", (9, 10)), m.i.x, m.i.y))
show("bad tuple", lambda: setattr(m, "i", (1, 2, 3)))
show("wrong type", lambda: setattr(m, "i", 5))
show("wrong instance", lambda: setattr(m, "i", c_int(5)))
show("char array too long", lambda: setattr(m, "d", b"abcd"))
show("char array exact", lambda: (setattr(m, "d", b"abc"), m.d))
show("char array nul", lambda: (setattr(m, "d", b"a\0c"), m.d))
show("char array str", lambda: setattr(m, "d", "a"))
show("wchar array too long", lambda: setattr(m, "f", "abc"))
show("wchar array bytes", lambda: setattr(m, "f", b"a"))
show("base of part", lambda: (m.i._b_base_ is m, m.i._b_needsfree_, m.j[0]._b_base_._b_base_ is m))
show("pointer from array", lambda: (setattr(m, "k", (c_int * 2)(11, 12)), m.k[1], sorted(m._objects)))
show("pointer from wrong array", lambda: setattr(m, "k", (c_short * 2)()))
show("pointer None", lambda: (setattr(m, "k", None), bool(m.k)))

for pack in (1, 2, 4, 8, 16):
    class Packed(Structure):
        _pack_ = pack
        _layout_ = "ms"
        _fields_ = [("a", c_char), ("b", c_double), ("c", c_short), ("d", c_int)]
    describe(Packed)
for align in (1, 2, 8, 16, 64):
    class Aligned(Structure):
        _align_ = align
        _fields_ = [("a", c_char), ("b", c_int)]
    describe(Aligned)
for bad in ({"_pack_": -1, "_layout_": "ms"}, {"_pack_": "x", "_layout_": "ms"}, {"_align_": -1}, {"_align_": "x"}, {"_layout_": "zz"}, {"_pack_": 2**70, "_layout_": "ms"}, {"_pack_": 1}):
    show("bad %r" % bad, lambda: sizeof(type(Structure)("B", (Structure,), dict(bad, _fields_=[("a", c_int)]))))

class Bits(Structure):
    _fields_ = [("a", c_int, 3), ("b", c_int, 5), ("c", c_uint, 8), ("d", c_int, 17), ("e", c_short, 4), ("f", c_ubyte, 1), ("g", c_longlong, 40), ("h", c_ulonglong, 64), ("i", c_byte, 8)]
describe(Bits)
b = Bits()
for name, *_ in Bits._fields_:
    for v in (0, 1, -1, 3, 4, 7, 8, 255, 2**16, 2**39, 2**40 - 1, 2**63, -2**63, 2**64 - 1):
        setattr(b, name, v)
        print("  ", name, v, getattr(b, name), bytes(b).hex())
    setattr(b, name, 0)
for layout in ("ms", "gcc-sysv"):
    class BitsL(Structure):
        _layout_ = layout
        _fields_ = [("a", c_byte, 4), ("b", c_int, 4), ("c", c_short, 12), ("d", c_longlong, 1), ("e", c_int, 32)]
    describe(BitsL)
for t, n in ((c_double, 3), (c_char, 3), (c_wchar, 3), (c_void_p, 3), (Point, 3), (c_int, 0), (c_int, 33), (c_int, -1), (c_bool, 1), (c_int, "x")):
    show("bit field %s:%r" % (t.__name__, n), lambda: sizeof(type(Structure)("B", (Structure,), {"_fields_": [("a", t, n)]})))

class U(Union):
    _fields_ = [("i", c_int), ("b", c_ubyte * 8), ("d", c_double), ("p", Point)]
describe(U)
u = U()
u.d = 1.0
show("union", lambda: (u.i, list(u.b), u.p.y, bytes(u)))
show("union init", lambda: (U(5).i, U(d=2.0).d, U(1, (c_ubyte * 8)(2)).i))

class Derived(Point):
    _fields_ = [("z", c_int)]
describe(Derived)
show("derived", lambda: (lambda d: (d.x, d.y, d.z, sizeof(d)))(Derived(1, 2, 3)))
show("derived too many", lambda: Derived(1, 2, 3, 4))
class NoFields(Point):
    pass
show("no fields", lambda: (sizeof(NoFields), NoFields(1, 2).y, _ctypes.buffer_info(NoFields)))
show("base is final", lambda: setattr(Point, "_fields_", []))
class Later(Structure):
    pass
show("later sizeof", lambda: sizeof(Later))
Later._fields_ = [("a", c_int)]
show("later", lambda: (sizeof(Later), Later(4).a))
show("twice", lambda: setattr(Later, "_fields_", [("a", c_int)]))
class Used(Structure):
    pass
Used()
show("after use", lambda: setattr(Used, "_fields_", [("a", c_int)]))
class Rec(Structure):
    pass
show("self", lambda: setattr(Rec, "_fields_", [("a", Rec)]))
class Node(Structure):
    pass
Node._fields_ = [("next", POINTER(Node)), ("value", c_int)]
n1 = Node(None, 1); n2 = Node(pointer(n1), 2)
show("list", lambda: (n2.next.contents.value, n2.next[0].value, bool(n1.next), sorted(n2._objects)))
class Abstract(Structure):
    _abstract_ = 1
show("abstract", lambda: Abstract())
show("Structure()", lambda: Structure())
show("Union()", lambda: Union())
for bad in (5, [5], [("a",)], [("a", 5)], [(5, c_int)], [("a", c_int, 1, 2)], "ab", [("a", c_int), ("a", c_int)], None, [("a", Structure)]):
    show("fields %r" % (bad,), lambda: sizeof(type(Structure)("B", (Structure,), {"_fields_": bad})))

class Inner(Structure):
    _fields_ = [("p", c_int), ("q", c_int)]
class InnerU(Union):
    _anonymous_ = ["s"]
    _fields_ = [("s", Inner), ("w", c_longlong)]
class Outer(Structure):
    _anonymous_ = ("u",)
    _fields_ = [("first", c_int), ("u", InnerU), ("last", c_int)]
describe(Outer)
o = Outer(1)
o.q = 7
show("anonymous", lambda: (o.u.s.q, o.p, o.w, Outer.q, Outer.p.offset, Outer.w.offset, Outer.u.is_anonymous, Outer.q.is_anonymous))
for anon in (["x"], 5, ["first"], [5]):
    show("anonymous %r" % (anon,), lambda: sizeof(type(Structure)("B", (Structure,), {"_anonymous_": anon, "_fields_": [("first", c_int), ("u", InnerU)]})))

for base in (BigEndianStructure, LittleEndianStructure, BigEndianUnion, LittleEndianUnion):
    class E(base):
        _fields_ = [("a", c_short), ("b", c_int), ("c", c_double), ("d", c_float), ("e", c_ubyte), ("f", c_longlong), ("g", c_short * 2), ("h", c_int, 5), ("i", c_int, 9), ("j", c_bool)]
    describe(E)
    e = E()
    e.b = 0x01020304
    print("  ", bytes(e).hex(), e.b)
    e = E()
    for name, value in (("a", 0x0102), ("c", 1.5), ("d", 2.5), ("e", 7), ("f", -2), ("h", 9), ("i", -100), ("j", True)):
        setattr(e, name, value)
        print("  ", name, getattr(e, name), bytes(e).hex())
    e.g = (c_short.__ctype_be__ * 2 if "Big" in base.__name__ else c_short * 2)(1, 2)
    print("  ", list(e.g), bytes(e).hex())
show("swapped pointer", lambda: type(BigEndianStructure)("B", (BigEndianStructure,), {"_fields_": [("a", POINTER(c_int))]}))
show("swapped nested", lambda: sizeof(type(BigEndianStructure)("B", (BigEndianStructure,), {"_fields_": [("a", Point)]})))

# Metaclasses
show("metaclasses", lambda: [type(t).__name__ for t in (Structure, Union, Array, _Pointer, _SimpleCData, _CFuncPtr)])
show("meta mro", lambda: [c.__name__ for c in type(Structure).__mro__])
show("from_param", lambda: (Point.from_param(p) is p, type(Point.from_param(Derived())).__name__))
show("from_param bad", lambda: Point.from_param(5))
class AsParam:
    _as_parameter_ = p
show("from_param as", lambda: Point.from_param(AsParam()) is p)
class Loop:
    pass
Loop._as_parameter_ = Loop()
def recursion(f):
    try:
        f()
    except RecursionError:
        return "RecursionError"
show("from_param loop", lambda: recursion(lambda: Point.from_param(Loop())))
show("mul", lambda: ((Point * 2).__name__, (2 * Point).__name__, Point * 2 is Point * 2, (Point * 0).__name__))
show("mul bad", lambda: Point * -1)
show("mul float", lambda: Point * 1.5)
show("pointer type", lambda: (POINTER(Point).__name__, Point.__pointer_type__ is POINTER(Point)))
show("no pointer type", lambda: Derived.__pointer_type__)
show("pointer type of abstract", lambda: Structure.__pointer_type__)
