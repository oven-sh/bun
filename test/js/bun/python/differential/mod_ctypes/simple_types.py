# The simple types: sizes, values, conversions, reprs, errors.
import ctypes, _ctypes, re
from ctypes import *
from _ctypes import _Pointer, _SimpleCData, CFuncPtr as _CFuncPtr

def show(label, f):
    try:
        r = f()
    except BaseException as e:
        r = "%s: %s" % (type(e).__name__, e)
    print(ascii(label)[1:-1], ascii(re.sub(r"0x[0-9a-f]+|p\(\d{6,}\)", "ADDR", repr(r) if not isinstance(r, str) else r))[1:-1])

names = ("c_byte c_ubyte c_short c_ushort c_int c_uint c_long c_ulong c_longlong c_ulonglong c_int8 c_int16 c_int32 c_int64 "
         "c_uint8 c_uint16 c_uint32 c_uint64 c_size_t c_ssize_t c_time_t c_float c_double c_longdouble c_float_complex c_double_complex "
         "c_longdouble_complex c_bool c_char c_wchar c_char_p c_wchar_p c_void_p py_object").split()
for n in names:
    t = getattr(ctypes, n)
    x = t()
    m = memoryview(x)
    print(n, t.__name__, t._type_, sizeof(t), sizeof(x), alignment(t), alignment(x), m.format, m.itemsize, m.ndim, m.shape, m.readonly, m.nbytes,
          _ctypes.buffer_info(t), n == "c_longdouble_complex" or bool(x), type(t).__name__, t.__mro__[1].__name__, x._objects, x._b_base_, x._b_needsfree_)
    for e in ("__ctype_be__", "__ctype_le__"):
        s = getattr(t, e, None)
        print("  ", e, s and (s.__name__, memoryview(s()).format, s.__ctype_le__.__name__, s.__ctype_be__.__name__, sizeof(s)))

values = [0, 1, -1, 127, 128, 255, 256, 32767, 32768, 65535, 65536, 2**31 - 1, 2**31, 2**32 - 1, 2**32, 2**63 - 1, 2**63, 2**64 - 1, 2**64, 2**70 + 5,
          -2**31, -2**31 - 1, -2**63, -2**63 - 1, -2**70, True, False, 1.5, -0.0, 1e40, 1e400, float("nan"), 1 + 2j, "a", "ab", "", "\U0001f600", "\ud800",
          b"a", b"ab", b"", bytearray(b"x"), bytearray(b"xy"), None, [], (1,), object]
class Index:
    def __index__(self): return 300
class Float:
    def __float__(self): return 2.25
class Bad:
    def __index__(self): raise KeyError("index")
    def __float__(self): raise KeyError("float")
    def __bool__(self): raise KeyError("bool")
values += [Index(), Float(), Bad()]
for n in names:
    t = getattr(ctypes, n)
    if n == "py_object":
        continue
    for v in values:
        if n in ("c_char_p", "c_wchar_p") and isinstance(v, int) and v:
            continue # An address that is read from.
        label = "%s(%s)" % (n, type(v).__name__ if type(v).__name__ in ("Index", "Float", "Bad", "type") else repr(v))
        show(label, lambda: t(v).value)
        be = getattr(t, "__ctype_be__", None)
        if be is not None and be is not t:
            show("  be", lambda: (be(v).value, bytes(be(v))))

for n in names:
    t = getattr(ctypes, n)
    show(n + " repr", lambda: repr(t()))
    show(n + " two args", lambda: t(1, 2))
    show(n + " keyword", lambda: t(value=1))
    show(n + " del value", lambda: delattr(t(), "value"))
    show(n + " hash", lambda: hash(t()))
    show(n + " eq", lambda: t() == t())
    show(n + " bytes", lambda: bytes(t()))
    show(n + " byref", lambda: byref(t()))
    show(n + " from_param own", lambda: type(t.from_param(t())).__name__)
    for v in (5, 5.5, b"x", "x", None, True, [], c_int(3), c_double(3), c_char_p(b"q"), byref(c_int(1)), byref(c_char(b"x")), (c_char * 3)(), (c_wchar * 3)(), pointer(c_int(1))):
        show("  %s.from_param(%s)" % (n, type(v).__name__), lambda: t.from_param(v))

# Classes derived from the simple types.
class MyInt(c_int):
    pass
class MyInt2(MyInt):
    _type_ = "h"
show("MyInt", lambda: (sizeof(MyInt), MyInt(5).value, repr(MyInt(5)), MyInt._type_, hasattr(MyInt, "__ctype_be__"), MyInt.__ctype_be__ is c_int.__ctype_be__))
show("MyInt2", lambda: (sizeof(MyInt2), MyInt2(70000).value))
show("array of MyInt", lambda: type((MyInt * 2)(1, 2)[0]).__name__)
show("array of c_int", lambda: type((c_int * 2)(1, 2)[0]).__name__)
show("outparam", lambda: (c_int(3).__ctypes_from_outparam__(), type(MyInt(3).__ctypes_from_outparam__()).__name__))

for body in ({}, {"_type_": 5}, {"_type_": "xx"}, {"_type_": ""}, {"_type_": "x"}, {"_type_": "i"}, {"_type_": "Zd"}, {"_type_": "Z"}, {"_type_": "v"}, {"_type_": "s"}, {"_type_": "U"}):
    show("class with %r" % body, lambda: (lambda c: (c.__name__, sizeof(c), c().value))(type(c_int)("X", (_SimpleCData,), dict(body))))
show("abstract", lambda: _SimpleCData())
show("abstract sizeof", lambda: sizeof(_SimpleCData))
show("abstract from_param", lambda: _SimpleCData.from_param(1))
show("abstract from_address", lambda: _SimpleCData.from_address(1))
show("CData", lambda: _SimpleCData.__mro__[1]())
show("attributes", lambda: (lambda x: (setattr(x, "foo", 1), x.foo, x.__dict__))(c_int()))
show("v", lambda: (lambda c: (c(5).value, c(0).value, bytes(c(1))))(type(c_int)("VB", (_SimpleCData,), {"_type_": "v"})))

# py_object
o = [1, 2]
p = py_object(o)
show("py_object", lambda: (p.value is o, p._objects is o, repr(py_object(5)), repr(py_object()), bool(py_object()), bool(p)))
show("py_object null", lambda: py_object().value)
for v in (None, 5, 2**70, 1.5, 2.0, "s", b"b", (1,), True, int, len):
    show("py_object(%r)" % (v,), lambda: py_object(v).value is v or py_object(v).value == v)
p.value = "other"
show("py_object set", lambda: (p.value, p._objects))

# sizeof and friends on what is not ctypes
for f in (sizeof, alignment, byref, addressof, _ctypes.buffer_info, pointer, POINTER):
    for v in (5, int, None, "x"):
        show("%s(%r)" % (f.__name__, v), lambda: f(v))
show("byref offset", lambda: byref(c_int(), 2))
show("byref bad offset", lambda: byref(c_int(), "x"))
show("resize", lambda: resize(5, 5))
