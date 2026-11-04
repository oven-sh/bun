# Memory: from_buffer, from_buffer_copy, the buffer protocol, resize, pickling, string_at and friends.
import ctypes, _ctypes, re, pickle, copy, array, gc, struct
from ctypes import *
from _ctypes import _Pointer, _SimpleCData

def show(label, f):
    try:
        r = f()
    except BaseException as e:
        r = "%s: %s" % (type(e).__name__, e)
    print(ascii(label)[1:-1], ascii(re.sub(r"0x[0-9a-f]+", "ADDR", repr(r) if not isinstance(r, str) else r))[1:-1])

class P(Structure):
    _fields_ = [("x", c_int), ("y", c_int)]

# from_buffer
b = bytearray(b"\x01\0\0\0\x02\0\0\0\x03\0\0\0")
x = c_int.from_buffer(b)
show("from_buffer", lambda: (x.value, x._b_needsfree_, x._b_base_, type(x._objects).__name__))
x.value = 0x0a0b0c0d
show("writes through", lambda: bytes(b))
b[0] = 0xff
show("reads through", lambda: hex(x.value))
show("offset", lambda: (c_int.from_buffer(b, 4).value, c_int.from_buffer(b, 8).value))
show("offset too large", lambda: c_int.from_buffer(b, 9))
show("offset huge", lambda: c_int.from_buffer(b, 2**62))
show("offset negative", lambda: c_int.from_buffer(b, -1))
show("offset type", lambda: c_int.from_buffer(b, "x"))
show("struct", lambda: (lambda p: (p.x, p.y, sorted(p._objects), type(p._objects["ffffffff"]).__name__))(P.from_buffer(b, 4)))
show("array", lambda: list((c_ubyte * 4).from_buffer(b, 4)))
show("too small", lambda: (c_int * 4).from_buffer(b))
show("resize exported", lambda: b.append(1))
show("resize exported 2", lambda: b.clear())
show("bytes", lambda: c_int.from_buffer(b"abcd"))
show("readonly view", lambda: c_int.from_buffer(memoryview(b).toreadonly()))
show("not contiguous", lambda: c_int.from_buffer(memoryview(bytearray(16))[::2]))
show("int", lambda: c_int.from_buffer(5))
show("abstract", lambda: Structure.from_buffer(b))
show("array.array", lambda: (lambda a: (c_int.from_buffer(a, 4).value, ))(array.array("i", [1, 2, 3])))
def grow():
    a = array.array("i", [1, 2, 3])
    v = c_int.from_buffer(a)
    a.append(4)
show("array.array resize", grow)
show("ctypes source", lambda: (lambda s: (lambda v: (v.value, setattr(v, "value", 5), s.y))(c_int.from_buffer(s, 4)))(P(1, 2)))
show("memoryview source", lambda: c_short.from_buffer(memoryview(b)[4:]).value)
del x
gc.collect()
def after():
    bb = bytearray(8)
    v = c_int.from_buffer(bb)
    del v
    gc.collect()
    bb.append(1)
    return len(bb)
show("free again", after)
def part_keeps():
    bb = bytearray(8)
    part = P.from_buffer(bb)
    field = (c_int * 2).from_buffer(bb)[0:1]
    sub = (P * 1).from_buffer(bb)[0]
    del part
    gc.collect()
    try:
        bb.append(1)
    except BufferError as e:
        return "still exported"
show("part keeps", part_keeps)
def released():
    bb = bytearray(8)
    v = c_int.from_buffer(bb)
    return type(v._objects).__name__
show("objects of simple", released)

# from_buffer_copy
show("copy", lambda: (lambda v: (v.value, v._b_needsfree_, v._objects))(c_int.from_buffer_copy(b"\x01\x02\x03\x04")))
show("copy offset", lambda: c_short.from_buffer_copy(b"\x01\x02\x03\x04", 2).value)
show("copy too small", lambda: c_int.from_buffer_copy(b"abc"))
show("copy offset too large", lambda: c_int.from_buffer_copy(b"abcd", 1))
show("copy negative", lambda: c_int.from_buffer_copy(b"abcd", -1))
show("copy int", lambda: c_int.from_buffer_copy(5))
show("copy str", lambda: c_int.from_buffer_copy("abcd"))
show("copy abstract", lambda: Structure.from_buffer_copy(b"abcd"))
show("copy independent", lambda: (lambda s: (lambda v: (s.__setitem__(0, 9), v.value))(c_ubyte.from_buffer_copy(s)))(bytearray(b"\x01")))
show("copy struct", lambda: (lambda p: (p.x, p.y))(P.from_buffer_copy(struct.pack("ii", 5, 6))))

# The buffer protocol
class S2(Structure):
    _fields_ = [("a", c_byte), ("b", c_double), ("c", c_int * 2), ("d", P), ("e", POINTER(c_int)), ("f", c_char * 3), ("g", c_int, 3)]
class Pk(Structure):
    _pack_ = 1
    _layout_ = "ms"
    _fields_ = [("a", c_byte), ("b", c_int)]
class Un(Union):
    _fields_ = [("a", c_int), ("b", c_double)]
class Em(Structure):
    _fields_ = []
class BE(BigEndianStructure):
    _fields_ = [("a", c_int), ("b", c_double)]
for t in (c_int, c_double, c_char, c_wchar, c_bool, c_void_p, c_char_p, py_object, c_longdouble, c_int * 3, c_int * 3 * 2, c_char * 4, c_double * 0, (c_int * 0) * 3, P, P * 2, S2, Pk, Un, Em, BE, POINTER(c_int), POINTER(P),
          POINTER(c_int * 2), CFUNCTYPE(c_int), c_int.__ctype_be__, c_int.__ctype_be__ * 2, POINTER(POINTER(c_int)) * 2):
    m = memoryview(t())
    print(t.__name__, m.format, m.itemsize, m.ndim, m.shape, m.strides, m.nbytes, m.readonly, m.c_contiguous, m.suboffsets, type(m.obj).__name__)
a = (c_int * 3)(1, 2, 3)
m = memoryview(a)
show("tolist", lambda: m.cast("B").cast("i").tolist())
show("write", lambda: (m.cast("B").__setitem__(0, 9), a[0]))
show("bytes", lambda: (bytes(a), bytearray(a), bytes(P(1, 2))))
show("__buffer__", lambda: (type(a.__buffer__(0)).__name__, a.__buffer__(0).format, a.__buffer__(0x11c).shape))
show("__buffer__ bad", lambda: a.__buffer__("x"))
show("struct.unpack", lambda: struct.unpack("3i", a))
show("obj", lambda: m.obj is a)
show("join", lambda: b"".join([c_char(b"a"), (c_char * 2)(b"b", b"c")]))
show("int.from_bytes", lambda: int.from_bytes(c_int(258), "little"))

# resize
r = (c_int * 2)(1, 2)
show("resize small", lambda: resize(r, 4))
show("resize", lambda: (resize(r, 32), sizeof(r), len(r), list(r), bytes(r)))
show("resize back", lambda: (resize(r, 8), sizeof(r), bytes(r)))
show("resize again", lambda: (resize(r, 16), bytes(r)))
show("resize type", lambda: sizeof(type(r)))
show("resize part", lambda: resize(P.from_buffer(bytearray(8)), 16))
show("resize field", lambda: resize((P * 2)()[0], 16))
show("resize bad", lambda: resize(r, "x"))
show("resize huge", lambda: resize(r, 2**62))
show("resize negative", lambda: resize(r, -1))
def old_parts():
    s = (P * 2)(P(1, 2), P(3, 4))
    part = s[1]
    resize(s, 4096)
    gc.collect()
    return part.x, part.y, s[1].x
show("old parts", old_parts)
c = c_int(5)
show("resize simple", lambda: (resize(c, 100), sizeof(c), c.value, len(bytes(c)), len(memoryview(c).tobytes())))

# Pickling and copying
c_int_Array_3 = c_int * 3
P_Array_2 = P * 2
for v in (c_int(5), c_double(2.5), c_char(b"x"), c_wchar("y"), c_bool(True), (c_int * 3)(1, 2, 3), P(1, 2), (P * 2)(P(1, 2), P(3, 4)), Un(5), c_longlong(-1)):
    for proto in (0, 2, pickle.HIGHEST_PROTOCOL):
        w = pickle.loads(pickle.dumps(v, proto))
        print(type(v).__name__, proto, type(w) is type(v), bytes(w) == bytes(v), w is not v)
    w = copy.copy(v)
    print("  copy", type(w) is type(v), bytes(w) == bytes(v))
    w = copy.deepcopy(v)
    print("  deepcopy", type(w) is type(v), bytes(w) == bytes(v))
for v in (c_char_p(b"x"), c_wchar_p("x"), c_void_p(1), py_object(1), pointer(c_int(1)), S2(), (c_char_p * 1)(), CFUNCTYPE(c_int)(lambda: 1)):
    show("pickle %s" % type(v).__name__, lambda: pickle.dumps(v))
pv = P(1, 2); pv.extra = "attr"
show("attributes", lambda: pickle.loads(pickle.dumps(pv)).extra)
show("reduce", lambda: (lambda r: (r[0].__name__, r[1][0].__name__, r[1][1]))(pv.__reduce__()))
show("setstate", lambda: (lambda q: (q.__setstate__({"k": 1}, b"\x07\0\0\0"), q.x, q.y, q.k))(P(1, 2)))
show("setstate long", lambda: (lambda q: (q.__setstate__({}, b"\x07" * 100), q.x))(P()))
show("setstate str", lambda: (lambda q: (q.__setstate__({}, "ab"), q.x))(P()))
show("setstate bad", lambda: P().__setstate__(5, b""))
show("setstate bad 2", lambda: P().__setstate__({}, 5))
show("unpickle bad", lambda: _ctypes._unpickle(P, 5))
show("unpickle", lambda: _ctypes._unpickle(P, ({}, b"\x01\0\0\0\x02\0\0\0")).y)

# string_at and friends
s = create_string_buffer(b"hello\0world")
show("string_at", lambda: (string_at(s), string_at(s, 8), string_at(s, 0), string_at(addressof(s) + 6), string_at(b"abc"), string_at(b"abc", 2)))
show("string_at negative", lambda: string_at(s, -2))
show("string_at bad", lambda: string_at(1.5))
u = create_unicode_buffer("h\xe9llo\0w")
show("wstring_at", lambda: (wstring_at(u), wstring_at(u, 7), wstring_at(u, 0), wstring_at(addressof(u) + sizeof(c_wchar))))
d = create_string_buffer(8)
show("memmove", lambda: (memmove(d, b"abcd", 4) == addressof(d), d.raw))
show("memmove overlap", lambda: (memmove(addressof(d) + 1, d, 4), d.raw)[1])
show("memset", lambda: (memset(d, ord("x"), 3) == addressof(d), d.raw))
show("memmove bad", lambda: memmove(d, 1.5, 1))
show("memmove count", lambda: memmove(d, b"a"))
show("memoryview_at", lambda: (lambda v: (type(v).__name__, bytes(v), v.readonly, v.format, v.shape, v.__setitem__(0, 65), d.raw[:1]))(memoryview_at(d, 4)))
show("memoryview_at readonly", lambda: (lambda v: (v.readonly, v.__setitem__(0, 65)))(memoryview_at(d, 4, True)))
show("memoryview_at negative", lambda: memoryview_at(d, -1))
show("memoryview_at zero", lambda: bytes(memoryview_at(d, 0)))

# from_address
v = c_int(77)
show("from_address", lambda: (lambda w: (w.value, w._b_needsfree_, w._b_base_, w._objects, setattr(w, "value", 78), v.value))(c_int.from_address(addressof(v))))
show("from_address view", lambda: bytes(memoryview(c_int.from_address(addressof(v)))))
show("from_address bad", lambda: c_int.from_address("x"))
show("from_address float", lambda: c_int.from_address(1.5))
