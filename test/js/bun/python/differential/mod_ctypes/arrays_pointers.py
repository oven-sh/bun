# Arrays and pointers: items, slices, strings, POINTER and pointer, cast, errors.
import ctypes, _ctypes, re
from ctypes import *
from _ctypes import _Pointer, _SimpleCData, CFuncPtr as _CFuncPtr

def show(label, f):
    try:
        r = f()
    except BaseException as e:
        r = "%s: %s" % (type(e).__name__, e)
    print(ascii(label)[1:-1], ascii(re.sub(r"0x[0-9a-f]+", "ADDR", repr(r) if not isinstance(r, str) else r))[1:-1])

A = c_int * 5
a = A(1, 2, 3)
show("type", lambda: (A.__name__, A._type_.__name__, A._length_, sizeof(A), alignment(A), len(a), type(A).__name__, A.__mro__[1].__name__, _ctypes.buffer_info(A)))
show("items", lambda: (list(a), a[0], a[-1], a[-5], a[4]))
for i in (5, -6, 2**70, -2**70, "x", 1.5, None, (1,)):
    show("get %r" % (i,), lambda: a[i])
    show("set %r" % (i,), lambda: a.__setitem__(i, 1))
for s in (slice(None), slice(1, 3), slice(None, None, -1), slice(None, None, 2), slice(10, 20), slice(-2, None), slice(4, 0, -2), slice(0, 0), slice(None, None, 0), slice("a")):
    show("slice %r" % (s,), lambda: a[s])
show("set slice", lambda: (a.__setitem__(slice(0, 2), (7, 8)), list(a)))
show("set slice step", lambda: (a.__setitem__(slice(None, None, 2), [1, 1, 1]), list(a)))
show("set slice wrong size", lambda: a.__setitem__(slice(0, 2), (1,)))
show("set slice not a sequence", lambda: a.__setitem__(slice(0, 2), 5))
show("set slice bad item", lambda: (a.__setitem__(slice(0, 2), (9, "x")), list(a)))
show("after", lambda: list(a))
show("del", lambda: a.__delitem__(0))
show("del slice", lambda: a.__delitem__(slice(0, 1)))
show("too many", lambda: A(1, 2, 3, 4, 5, 6))
show("bad item", lambda: A("x"))
show("keyword", lambda: list(A(x=1)))
show("in", lambda: (1 in a, 99 in a))
show("iter", lambda: (hasattr(a, "__iter__"), [x for x in a], list(reversed(a))))
show("unpack", lambda: (lambda p, q, *r: (p, q, r))(*a))
show("repr", lambda: repr(a))
show("bool", lambda: (bool(a), bool((c_int * 0)())))
show("generic", lambda: Array[int])
show("empty", lambda: (lambda e: (len(e), list(e), sizeof(e), e[:]))((c_int * 0)()))
show("empty get", lambda: (c_int * 0)()[0])
show("empty set", lambda: (c_int * 0)().__setitem__(0, 1))
show("cache", lambda: (c_int * 5 is A, c_int * 6 is A))
show("nested", lambda: (lambda t: (t.__name__, sizeof(t), _ctypes.buffer_info(t), [list(r) for r in t((1, 2, 3), (4, 5, 6))]))(c_int * 3 * 2))
show("nested base", lambda: (lambda m: (m[1]._b_base_ is m, m[1]._b_needsfree_, m[1]._objects))((c_int * 3 * 2)()))
show("huge", lambda: (c_int * 2**61))
show("huge2", lambda: (c_char * (2**63 - 1)).__name__)
show("huge instance", lambda: (c_char * (2**62))())
show("too large", lambda: c_int * 2**64)
for body in ({}, {"_length_": 1}, {"_type_": c_int}, {"_length_": "x", "_type_": c_int}, {"_length_": -1, "_type_": c_int}, {"_length_": 2**70, "_type_": c_int}, {"_length_": 1, "_type_": int},
             {"_length_": 1.0, "_type_": c_int}, {"_length_": True, "_type_": c_int}, {"_length_": 2, "_type_": c_int}):
    show("class %r" % sorted(body), lambda: sizeof(type(Array)("X", (Array,), dict(body))))
class Sub(A):
    pass
show("subclass", lambda: (sizeof(Sub), list(Sub(1)), Sub._length_))
class Sub2(A):
    _length_ = 2
show("subclass with length", lambda: (sizeof(Sub2), list(Sub2(1))))
show("Array()", lambda: Array())

# Strings
c = (c_char * 5)()
show("char", lambda: (c.value, c.raw, c[0], c[:], c[1:3], c[::2], list(c)[:2]))
c.value = b"abc"
show("char value", lambda: (c.value, c.raw, c[::-1], c[1:100]))
c.value = b"abcde"
show("char full", lambda: (c.value, c.raw))
show("char too long", lambda: setattr(c, "value", b"abcdef"))
show("char str", lambda: setattr(c, "value", "a"))
show("char del", lambda: delattr(c, "value"))
c.raw = b"x\0y"
show("raw", lambda: (c.value, c.raw))
show("raw too long", lambda: setattr(c, "raw", b"abcdef"))
show("raw int", lambda: setattr(c, "raw", 5))
show("raw bytearray", lambda: (setattr(c, "raw", bytearray(b"QQ")), c.raw))
show("raw memoryview", lambda: (setattr(c, "raw", memoryview(b"ZZ")), c.raw))
show("char init", lambda: (c_char * 3)(b"a", b"b").raw)
show("char init bytes", lambda: (c_char * 3)(b"ab"))
show("char init star", lambda: (c_char * 3)(*b"ab").raw)
show("no value", lambda: (c_int * 2)().value)
show("ubyte no value", lambda: (c_ubyte * 2)().raw)
w = (c_wchar * 4)()
show("wchar", lambda: (w.value, w[0], w[:], list(w)[:1], hasattr(w, "raw")))
w.value = "h\xe9€"
show("wchar value", lambda: (w.value, w[:], w[::-1], w[1:3], bytes(w)))
w.value = "\U0001f600"
show("wchar astral", lambda: (w.value, len(w.value), w[0]))
show("wchar too long", lambda: setattr(w, "value", "abcde"))
show("wchar full", lambda: (setattr(w, "value", "abcd"), w.value))
show("wchar bytes", lambda: setattr(w, "value", b"a"))
show("wchar del", lambda: delattr(w, "value"))
show("bad wchar", lambda: (lambda x: (memmove(x, b"\xff\xff\xff\x7f", 4), x.value))((c_wchar * 1)()))
show("create_string_buffer", lambda: [(type(b).__name__, b.raw) for b in (create_string_buffer(3), create_string_buffer(b"ab"), create_string_buffer(b"ab", 5))])
show("create_string_buffer bad", lambda: create_string_buffer("x"))
show("create_string_buffer short", lambda: create_string_buffer(b"abc", 2))
show("create_unicode_buffer", lambda: [(type(b).__name__, b.value, len(b)) for b in (create_unicode_buffer(3), create_unicode_buffer("ab"), create_unicode_buffer("ab", 5), create_unicode_buffer("\U0001f600"))])

# Pointers
i = c_int(42)
p = pointer(i)
P = POINTER(c_int)
show("pointer", lambda: (type(p) is P, P.__name__, P._type_ is c_int, sizeof(P), alignment(P), type(P).__name__, P.__mro__[1].__name__, _ctypes.buffer_info(P), bool(p), bool(P())))
show("contents", lambda: (p.contents.value, p[0], p.contents is p.contents, p.contents._b_base_ is p, p.contents._b_needsfree_))
p[0] = 7
show("set item", lambda: (i.value, p[0]))
p.contents.value = 8
show("through contents", lambda: i.value)
j = c_int(9)
p.contents = j
show("set contents", lambda: (p[0], p._objects["1"] is j, sorted(p._objects)))
show("contents wrong", lambda: setattr(p, "contents", 5))
show("contents other ctype", lambda: (setattr(P(), "contents", c_short(1)), "accepted"))
show("del contents", lambda: delattr(p, "contents"))
show("null contents", lambda: P().contents)
show("null item", lambda: P()[0])
show("null set", lambda: P().__setitem__(0, 1))
show("del item", lambda: p.__delitem__(0))
show("index type", lambda: p["x"])
show("set index type", lambda: p.__setitem__("x", 1))
show("len", lambda: len(p))
arr = (c_int * 4)(10, 20, 30, 40)
q = cast(arr, P)
show("cast", lambda: (q[0], q[3], q[1:3], q[:4], q[3:0:-1], q[0:4:2], q[2:2], q[3:1]))
for s in (slice(None), slice(1, None), slice(None, None, -1), slice(0, 2, 0), slice(None, 2, -1), slice("a", 2), slice(0, "b"), slice(0, 2, "c")):
    show("pointer slice %r" % (s,), lambda: q[s])
show("cast objects", lambda: (q._objects is arr._objects, [type(v).__name__ for v in q._objects.values()]))
cp = cast(create_string_buffer(b"hello"), POINTER(c_char))
show("char pointer", lambda: (cp[0], cp[0:5], cp[4:0:-1], cp[0:0]))
wp = cast(create_unicode_buffer("hello"), POINTER(c_wchar))
show("wchar pointer", lambda: (wp[0], wp[0:5], wp[4:0:-2], wp[0:0]))
show("pointer to pointer", lambda: (lambda pp: (type(pp).__name__, pp.contents.contents.value, pp[0][0]))(pointer(pointer(c_int(5)))))
show("pointer init", lambda: P(c_int(3))[0])
show("pointer init wrong", lambda: P(3))
show("pointer init two", lambda: P(c_int(1), c_int(2)))
show("POINTER cache", lambda: (POINTER(c_int) is P, c_int.__pointer_type__ is P))
show("POINTER(None)", lambda: POINTER(None) is c_void_p)
show("POINTER(int)", lambda: POINTER(int))
show("POINTER str", lambda: POINTER("x"))
show("_Pointer()", lambda: _Pointer())
class Incomplete(_Pointer):
    pass
show("incomplete", lambda: (sizeof(Incomplete), _ctypes.buffer_info(Incomplete)))
show("incomplete instance", lambda: Incomplete())
show("incomplete from_param", lambda: Incomplete.from_param(c_int()))
show("set_type bad", lambda: Incomplete.set_type(int))
show("set_type 5", lambda: Incomplete.set_type(5))
Incomplete.set_type(c_short)
show("set_type", lambda: (Incomplete._type_.__name__, Incomplete(c_short(4))[0], _ctypes.buffer_info(Incomplete), c_short.__pointer_type__ is Incomplete))
for body in ({"_type_": 5}, {"_type_": int}, {"_type_": Structure}):
    show("pointer class %r" % (body,), lambda: type(P)("X", (_Pointer,), dict(body)))
show("formats", lambda: [_ctypes.buffer_info(POINTER(t)) for t in (c_int, c_int * 3, c_int * 3 * 2, POINTER(c_int), c_char_p)])
show("from_param", lambda: [type(P.from_param(v)).__name__ for v in (None, p, c_int(1), arr, byref(c_int(1)))])
for v in (5, c_short(1), (c_short * 2)(), pointer(c_short(1)), byref(c_short(1)), "x"):
    show("from_param %s" % type(v).__name__, lambda: P.from_param(v))

# cast
show("cast to void", lambda: type(cast(arr, c_void_p)).__name__)
show("cast int", lambda: cast(0, P)[:0])
show("cast None", lambda: bool(cast(None, P)))
show("cast bytes", lambda: cast(b"abc", c_char_p).value)
show("cast char_p", lambda: cast(c_char_p(b"xyz"), POINTER(c_char))[0:3])
show("cast to int", lambda: cast(arr, c_int))
show("cast to array", lambda: cast(arr, c_int * 4))
show("cast to 5", lambda: cast(arr, 5))
show("cast of float", lambda: cast(1.5, P))
show("cast of struct", lambda: cast(type(Structure)("S", (Structure,), {"_fields_": [("a", c_int)]})(), P))
show("cast function", lambda: type(cast(CFUNCTYPE(c_int)(lambda: 1), c_void_p)).__name__)
show("cast to py_object", lambda: (lambda o: cast(id(o), py_object).value is o)([1, 2]))
show("addressof", lambda: (addressof(arr) == cast(arr, c_void_p).value, addressof(arr) + 4 == addressof(c_int.from_buffer(arr, 4))))
