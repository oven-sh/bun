# Foreign functions of libc and libm, callbacks, errno, errcheck, paramflags.
import ctypes, ctypes.util, _ctypes, re, os, sys, gc, math, errno, threading
from ctypes import *

def show(label, f):
    try:
        r = f()
    except BaseException as e:
        r = "%s: %s" % (type(e).__name__, e)
    r = re.sub(r"0x[0-9a-f]+", "ADDR", repr(r) if not isinstance(r, str) else r)
    print(ascii(label)[1:-1], ascii(re.sub(r"[^ ]*: undefined symbol", "EXE: undefined symbol", r))[1:-1])

libc = CDLL(None)
libm = CDLL(ctypes.util.find_library("m"))
show("find_library", lambda: (bool(ctypes.util.find_library("c")), bool(ctypes.util.find_library("m")), ctypes.util.find_library("no_such_library_xyz")))
show("handle", lambda: (type(libc._handle).__name__, libc._name, type(libc.strlen).__name__, libc.strlen.__name__, libc.strlen is libc.strlen, libc["strlen"] is libc["strlen"]))
show("missing", lambda: libc.no_such_function_xyz)
show("missing item", lambda: libc["no_such_function_xyz"])
show("missing library", lambda: type(CDLL("/no/such/library.so")))
show("dunder", lambda: libc.__foo__)
show("pythonapi", lambda: (type(pythonapi).__name__, pythonapi._name))
show("cdll", lambda: type(cdll.LoadLibrary(None)).__name__)
show("dllist", lambda: (type(ctypes.util.dllist()).__name__, all(isinstance(n, str) for n in ctypes.util.dllist())))

# Without argtypes
show("strlen", lambda: (libc.strlen(b"hello"), libc.strlen(b""), libc.strlen(create_string_buffer(b"abc")), libc.strlen(c_char_p(b"abcd"))))
show("abs", lambda: (libc.abs(-5), libc.abs(5), libc.abs(c_int(-7))))
show("wcslen", lambda: (libc.wcslen("h\xe9llo"), libc.wcslen(c_wchar_p("ab")), libc.wcslen(create_unicode_buffer("abc"))))
show("toupper", lambda: chr(libc.toupper(ord("a"))))
show("getpid", lambda: libc.getpid() == os.getpid())
show("float argument", lambda: libc.abs(1.5))
show("list argument", lambda: libc.abs([]))
show("big int", lambda: libc.abs(2**64))
show("int wraps", lambda: (libc.abs(2**32 + 5), libc.abs(2**63)))
class AsParam:
    def __init__(self, v): self._as_parameter_ = v
show("as parameter", lambda: (libc.abs(AsParam(-3)), libc.strlen(AsParam(b"xyz")), libc.abs(AsParam(AsParam(c_int(-4))))))
show("as parameter bad", lambda: libc.abs(AsParam(1.5)))
show("None is NULL", lambda: libc.time(None) > 1000000000)

# restype and argtypes
strlen = libc.strlen
show("defaults", lambda: (strlen.restype.__name__, strlen.argtypes, strlen.errcheck))
strlen.restype = c_size_t
strlen.argtypes = [c_char_p]
show("typed", lambda: (strlen(b"abc"), strlen.restype.__name__, [t.__name__ for t in strlen.argtypes]))
show("wrong type", lambda: strlen("abc"))
show("wrong type 2", lambda: strlen(5))
show("too few", lambda: strlen())
show("more is allowed", lambda: strlen(b"ab", 1, 2))
show("argtypes bad", lambda: setattr(strlen, "argtypes", [int]))
show("argtypes bad 2", lambda: setattr(strlen, "argtypes", 5))
show("restype bad", lambda: setattr(strlen, "restype", 5))
show("errcheck bad", lambda: setattr(strlen, "errcheck", 5))
show("argtypes None", lambda: (setattr(strlen, "argtypes", None), strlen.argtypes))
show("del", lambda: (delattr(strlen, "restype"), strlen.restype.__name__, delattr(strlen, "argtypes"), strlen.argtypes, delattr(strlen, "errcheck"), strlen.errcheck))
for name, args in (("sin", (1.0,)), ("cos", (0.0,)), ("sqrt", (2.0,)), ("pow", (2.0, 10.0)), ("fabs", (-1.5,)), ("floor", (2.7,)), ("atan2", (1.0, 2.0)), ("fmod", (7.5, 2.0)), ("ldexp", (1.5, 4)), ("hypot", (3, 4))):
    f = getattr(libm, name)
    f.restype = c_double
    f.argtypes = [c_double] * len(args) if name != "ldexp" else [c_double, c_int]
    show(name, lambda: f(*args))
libm.sinf.restype = c_float; libm.sinf.argtypes = [c_float]
show("sinf", lambda: round(libm.sinf(1.0), 6))
libm.powf.restype = c_float; libm.powf.argtypes = [c_float, c_float]
show("powf", lambda: libm.powf(2.0, 0.5) == c_float(math.sqrt(2)).value)
libm.frexp.restype = c_double; libm.frexp.argtypes = [c_double, POINTER(c_int)]
show("frexp", lambda: (lambda e: (libm.frexp(8.0, byref(e)), e.value))(c_int()))
show("frexp instance", lambda: (lambda e: (libm.frexp(8.0, e), e.value))(c_int()))
show("frexp pointer", lambda: (lambda e: (libm.frexp(8.0, pointer(e)), e.value))(c_int()))
show("frexp wrong", lambda: libm.frexp(8.0, c_short()))
libm.modf.restype = c_double; libm.modf.argtypes = [c_double, POINTER(c_double)]
show("modf", lambda: (lambda i: (libm.modf(3.25, i), i.value))(c_double()))
libc.strtod.restype = c_double; libc.strtod.argtypes = [c_char_p, POINTER(c_char_p)]
show("strtod", lambda: (lambda e: (libc.strtod(b"3.5abc", byref(e)), e.value))(c_char_p()))
libc.strtol.restype = c_long; libc.strtol.argtypes = [c_char_p, c_void_p, c_int]
show("strtol", lambda: (libc.strtol(b"-123", None, 10), libc.strtol(b"ff", None, 16), libc.strtol(b"9223372036854775807", None, 10)))
libc.strtoull.restype = c_ulonglong; libc.strtoull.argtypes = [c_char_p, c_void_p, c_int]
show("strtoull", lambda: libc.strtoull(b"18446744073709551615", None, 10))
libc.labs.restype = c_long; libc.labs.argtypes = [c_long]
show("labs", lambda: libc.labs(-2**40))
libc.getenv.restype = c_char_p; libc.getenv.argtypes = [c_char_p]
os.environ["CTYPES_TEST_VARIABLE"] = "value"
show("getenv", lambda: (libc.getenv(b"CTYPES_TEST_VARIABLE"), libc.getenv(b"CTYPES_NO_SUCH_VARIABLE")))
libc.strchr.restype = c_char_p; libc.strchr.argtypes = [c_char_p, c_int]
show("strchr", lambda: (libc.strchr(b"abcdef", ord("d")), libc.strchr(b"abcdef", ord("x"))))
libc.strchr.argtypes = [c_char_p, c_char]
show("strchr char", lambda: libc.strchr(b"abcdef", b"c"))
show("strchr char bad", lambda: libc.strchr(b"abcdef", b"cd"))
libc.strchr.restype = c_void_p
show("void_p result", lambda: (type(libc.strchr(b"abc", b"b")).__name__, libc.strchr(b"abc", b"x")))
libc.strchr.restype = POINTER(c_char)
show("pointer result", lambda: (lambda r: (type(r).__name__, r[0], r[0:2]))(libc.strchr(b"abc", b"b")))
libc.strchr.restype = None
show("no result", lambda: libc.strchr(b"abc", b"b"))
libc.strchr.restype = lambda v: ("called", type(v).__name__)
show("callable result", lambda: libc.strchr(b"abc", b"x"))
class MyInt(c_int): pass
libc.abs.restype = MyInt
show("subclass result", lambda: (type(libc.abs(-3)).__name__, libc.abs(-3).value))
for t, v in ((c_byte, -3), (c_ubyte, 253), (c_short, -3), (c_ushort, 65533), (c_int, -3), (c_uint, 2**32 - 3), (c_bool, True), (c_char, b"\xfd")):
    libc.abs.restype = c_int
    ident = CFUNCTYPE(t, t)(lambda x: x)
    show("identity %s" % t.__name__, lambda: ident(v))
libc.memcpy.restype = c_void_p; libc.memcpy.argtypes = [c_void_p, c_void_p, c_size_t]
show("memcpy", lambda: (lambda d: (libc.memcpy(d, b"hello", 5) == addressof(d), d.raw))(create_string_buffer(6)))
show("memcpy array", lambda: (lambda d, s: (libc.memcpy(d, s, sizeof(s)), list(d))[1])((c_int * 3)(), (c_int * 3)(1, 2, 3)))
libc.memcmp.argtypes = [c_void_p, c_void_p, c_size_t]
show("memcmp", lambda: (libc.memcmp(b"abc", b"abc", 3), libc.memcmp(b"abd", b"abc", 3) > 0))

# Many arguments, variadic functions
def fmt(f, *args):
    b = create_string_buffer(256)
    n = libc.snprintf(b, 256, f, *args)
    return n, b.value
show("snprintf", lambda: fmt(b"%d %s %c %x", 42, b"str", ord("c"), 255))
show("snprintf double", lambda: fmt(b"%f %g %.2f", c_double(1.5), c_double(2.5e10), c_double(-0.125)))
show("snprintf mixed", lambda: fmt(b"%d %f %s %f %d %f", 1, c_double(2.0), b"three", c_double(4.0), 5, c_double(6.0)))
show("snprintf many ints", lambda: fmt(b"%d %d %d %d %d %d %d %d %d %d %d %d", *range(1, 13)))
show("snprintf many doubles", lambda: fmt(b"%.0f %.0f %.0f %.0f %.0f %.0f %.0f %.0f %.0f %.0f %.0f %.0f", *[c_double(i) for i in range(1, 13)]))
show("snprintf both", lambda: fmt(b"%d %.0f " * 12, *[x for i in range(12) for x in (i, c_double(i + 0.0))]))
show("snprintf long", lambda: fmt(b"%ld %lld %lu %zu", c_long(-2**40), c_longlong(2**50), c_ulong(2**64 - 1), c_size_t(7)))
show("snprintf wide", lambda: fmt(b"%ls", "wide"))
show("snprintf pointer null", lambda: fmt(b"%s", b"x")[0])
show("snprintf long double", lambda: fmt(b"%Lf", c_longdouble(1.5)))
libc.snprintf.argtypes = [c_char_p, c_size_t, c_char_p]
show("snprintf argtypes", lambda: fmt(b"%d %f", 7, c_double(0.5)))
libc.snprintf.argtypes = None
show("too many arguments", lambda: libc.abs(*range(1025)))
libc.sscanf.argtypes = None
show("sscanf", lambda: (lambda a, b, s: (libc.sscanf(b"12 3.5 word", b"%d %lf %s", byref(a), byref(b), s), a.value, b.value, s.value))(c_int(), c_double(), create_string_buffer(16)))

# Structures by value
class div_t(Structure):
    _fields_ = [("quot", c_int), ("rem", c_int)]
class ldiv_t(Structure):
    _fields_ = [("quot", c_long), ("rem", c_long)]
libc.div.restype = div_t; libc.div.argtypes = [c_int, c_int]
show("div", lambda: (lambda r: (type(r).__name__, r.quot, r.rem))(libc.div(17, 5)))
libc.ldiv.restype = ldiv_t; libc.ldiv.argtypes = [c_long, c_long]
show("ldiv", lambda: (lambda r: (r.quot, r.rem))(libc.ldiv(-2**40 - 3, 7)))
class timespec(Structure):
    _fields_ = [("tv_sec", c_long), ("tv_nsec", c_long)]
show("nanosleep", lambda: libc.nanosleep(byref(timespec(0, 1000)), None))
class tm(Structure):
    _fields_ = [(n, c_int) for n in "sec min hour mday mon year wday yday isdst".split()] + [("gmtoff", c_long), ("zone", c_char_p)]
libc.gmtime_r.restype = POINTER(tm); libc.gmtime_r.argtypes = [POINTER(c_long), POINTER(tm)]
show("gmtime_r", lambda: (lambda t: (libc.gmtime_r(c_long(86400 * 365), t).contents.year, t.year, t.mon, t.mday, t.yday))(tm()))

# errno
libc2 = CDLL(None, use_errno=True)
set_errno(0)
show("errno", lambda: (libc2.open(b"/no/such/file/xyz", 0), get_errno() == errno.ENOENT, set_errno(5) == errno.ENOENT, get_errno(), set_errno(0)))
show("errno untouched", lambda: (libc.open(b"/no/such/file/xyz", 0), get_errno()))
show("set_errno bad", lambda: set_errno("x"))
def in_thread():
    out = []
    set_errno(11)
    t = threading.Thread(target=lambda: out.append((get_errno(), set_errno(22), get_errno())))
    t.start(); t.join()
    return out, get_errno()
show("errno per thread", in_thread)
set_errno(0)

# errcheck
def check(result, func, args):
    return ("checked", result, func is libc.abs, args)
libc.abs.restype = c_int
libc.abs.errcheck = check
show("errcheck", lambda: libc.abs(-4))
libc.abs.errcheck = lambda r, f, a: a
show("errcheck returns args", lambda: libc.abs(-4))
def failing(r, f, a): raise ValueError("from errcheck")
libc.abs.errcheck = failing
show("errcheck raises", lambda: libc.abs(-4))
del libc.abs.errcheck
class Checked(c_int):
    def _check_retval_(v): return ("retval", type(v).__name__, v.value if hasattr(v, "value") else v)
libc.abs.restype = Checked
show("_check_retval_", lambda: libc.abs(-4))
libc.abs.restype = c_int

# Prototypes and paramflags
proto = CFUNCTYPE(c_int, c_int)
show("prototype", lambda: (proto.__name__, proto._restype_.__name__, [t.__name__ for t in proto._argtypes_], proto._flags_, CFUNCTYPE(c_int, c_int) is proto, sizeof(proto), type(proto).__name__))
show("from name", lambda: proto(("abs", libc))(-9))
show("from name bytes", lambda: proto((b"abs", libc))(-9))
show("from missing name", lambda: proto(("no_such_function_xyz", libc)))
show("from bad name", lambda: proto((1.5, libc)))
show("from bad library", lambda: proto(("abs", 5)))
show("from bad tuple", lambda: proto(("abs",)))
show("from address", lambda: proto(cast(libc.abs, c_void_p).value)(-8))
show("null", lambda: (bool(proto()), bool(proto(0)), bool(proto(("abs", libc)))))
show("not callable", lambda: proto("x"))
show("exact count", lambda: proto(("abs", libc))())
show("named", lambda: proto(("abs", libc), ((1, "value"),))(value=-6))
show("named default", lambda: proto(("abs", libc), ((1, "value", -5),))())
show("named missing", lambda: proto(("abs", libc), ((1, "value"),))())
show("unnamed missing", lambda: proto(("abs", libc), ((1,),))())
show("named twice", lambda: proto(("abs", libc), ((1, "value"),))(1, value=2))
for flags in (5, ((1, "a"), (1, "b")), (5,), ((1, 5),), (("x",),), ((2, "out"),), ((8,),), ((1, "a", 1, 2),), None, ()):
    show("paramflags %r" % (flags,), lambda: type(proto(("abs", libc), flags)).__name__)
frexp = CFUNCTYPE(c_double, c_double, POINTER(c_int))(("frexp", libm), ((1, "x"), (2, "exp")))
show("out parameter", lambda: frexp(8.0))
modf = CFUNCTYPE(c_double, c_double, POINTER(c_double))(("modf", libm), ((1, "x"), (2, "ipart")))
show("out parameter 2", lambda: modf(x=3.25))
modf.errcheck = lambda r, f, a: (r, a[1].value)
show("out with errcheck", lambda: modf(3.25))
sincos = CFUNCTYPE(None, c_double, POINTER(c_double), POINTER(c_double))(("sincos", libm), ((1,), (2,), (2,)))
show("two outs", lambda: sincos(0.0))
inout = CFUNCTYPE(c_double, c_double, POINTER(c_int))(("frexp", libm), ((1,), (3, "e")))
show("inout", lambda: (lambda e: (type(inout(8.0, e)).__name__, e.value))(c_int()))
show("out char_p", lambda: CFUNCTYPE(c_int, c_char_p)(("strlen", libc), ((2,),))())
show("repr", lambda: repr(libc.abs))
show("function types", lambda: [(t.__name__, t._flags_) for t in (CFUNCTYPE(None), CFUNCTYPE(None, use_errno=True), PYFUNCTYPE(None), CFUNCTYPE(None, use_last_error=True))])
show("bad keyword", lambda: CFUNCTYPE(None, foo=1))
for body in ({}, {"_flags_": "x"}, {"_flags_": 1, "_argtypes_": 5}, {"_flags_": 1, "_argtypes_": [int]}, {"_flags_": 1, "_restype_": 5}, {"_flags_": 1}, {"_flags_": 1, "_argtypes_": [c_int] * 1025}):
    show("function class %r" % sorted(body), lambda: type(proto)("F", (_ctypes.CFuncPtr,), dict(body)).__name__)
show("no argtypes", lambda: type(proto)("F", (_ctypes.CFuncPtr,), {"_flags_": 1})(lambda: 1))
show("CFuncPtr()", lambda: _ctypes.CFuncPtr())

# Callbacks
CMP = CFUNCTYPE(c_int, POINTER(c_int), POINTER(c_int))
def sort(values, key):
    a = (c_int * len(values))(*values)
    libc.qsort(a, len(a), sizeof(c_int), CMP(key))
    return list(a)
show("qsort", lambda: sort([5, 1, 4, 2, 3], lambda x, y: x[0] - y[0]))
show("qsort reverse", lambda: sort(list(range(50)), lambda x, y: y[0] - x[0]) == list(range(49, -1, -1)))
show("direct", lambda: CFUNCTYPE(c_int, c_int, c_int)(lambda a, b: a * b)(6, 7))
show("doubles", lambda: CFUNCTYPE(c_double, c_double, c_double)(lambda a, b: a / b)(1.0, 4.0))
show("floats", lambda: CFUNCTYPE(c_float, c_float, c_float)(lambda a, b: a + b)(1.5, 2.25))
show("mixed", lambda: CFUNCTYPE(c_double, c_int, c_double, c_char_p, c_float, c_longlong, c_bool, c_char, c_short)(lambda *a: (print("  ", a), 1.5)[1])(1, 2.5, b"three", 4.5, 2**40, True, b"c", -7))
show("many", lambda: CFUNCTYPE(c_longlong, *[c_longlong] * 12)(lambda *a: sum(a))(*range(1, 13)))
show("many doubles", lambda: CFUNCTYPE(c_double, *[c_double] * 12)(lambda *a: sum(a))(*[float(i) for i in range(1, 13)]))
show("many mixed", lambda: CFUNCTYPE(c_double, *[c_int, c_double] * 10)(lambda *a: sum(a))(*[x for i in range(10) for x in (i, i + 0.5)]))
show("void", lambda: CFUNCTYPE(None)(lambda: 5)())
show("char_p argument", lambda: CFUNCTYPE(c_int, c_char_p)(lambda s: len(s))(b"four"))
show("wchar_p argument", lambda: CFUNCTYPE(c_int, c_wchar_p)(lambda s: len(s))("four!"))
show("void_p argument", lambda: CFUNCTYPE(c_bool, c_void_p)(lambda p: p is None)(None))
show("pointer result", lambda: (lambda i: CFUNCTYPE(POINTER(c_int))(lambda: pointer(i)))(c_int(5)))
show("void_p result", lambda: CFUNCTYPE(c_void_p)(lambda: 12345)())
show("py_object", lambda: PYFUNCTYPE(py_object, py_object)(lambda o: [o, o])("x"))
show("subclass argument", lambda: CFUNCTYPE(c_int, MyInt)(lambda v: (type(v).__name__ == "MyInt") + v.value)(MyInt(4)))
show("function pointer argument", lambda: CFUNCTYPE(c_int, proto)(lambda f: f(-3))(proto(("abs", libc))))
show("nested", lambda: (lambda inner: CFUNCTYPE(c_int, c_int)(lambda v: inner(v) + 1)(1))(CFUNCTYPE(c_int, c_int)(lambda v: v * 10)))
show("recursive", lambda: (lambda box: (box.append(CFUNCTYPE(c_int, c_int)(lambda n: 1 if n <= 1 else n * box[0](n - 1))), box[0](10))[1])([]))
show("bad result type", lambda: CFUNCTYPE(div_t * 2)(lambda: 1))
show("bound method", lambda: (lambda o: CFUNCTYPE(c_int)(o.m)())(type("O", (), {"m": lambda self: 11})()))
def hooked(f):
    seen = []
    old = sys.unraisablehook
    sys.unraisablehook = lambda u: seen.append((u.exc_type.__name__, str(u.exc_value), re.sub(r" at 0x[0-9a-f]+", "", u.err_msg or ""), u.object))
    try:
        r = f()
    finally:
        sys.unraisablehook = old
    return r, seen
def raiser(): raise KeyError("in callback")
show("exception", lambda: hooked(lambda: (CFUNCTYPE(c_int)(raiser)(), None)[1]))
show("bad result", lambda: hooked(lambda: (CFUNCTYPE(c_int)(lambda: "text")(), None)[1]))
show("None for int", lambda: hooked(lambda: (CFUNCTYPE(c_int)(lambda: None)(), None)[1]))
show("exception in qsort", lambda: hooked(lambda: sorted(sort([3, 1, 2], lambda x, y: 1 // 0)))[0])
def many_callbacks():
    total = 0
    for i in range(3000):
        total += CFUNCTYPE(c_int, c_int)(lambda v, i=i: v + i)(1)
    return total
show("many callbacks, one after the other", many_callbacks)
def in_threads():
    cb = CFUNCTYPE(c_int, POINTER(c_int), POINTER(c_int))(lambda x, y: x[0] - y[0])
    out = []
    def work():
        a = (c_int * 20)(*range(20, 0, -1))
        libc.qsort(a, 20, 4, cb)
        out.append(list(a) == list(range(1, 21)))
    ts = [threading.Thread(target=work) for i in range(4)]
    for t in ts: t.start()
    for t in ts: t.join()
    return out
show("callbacks in threads", in_threads)
def sleeper():
    # A call lets other threads run.
    seen = []
    t = threading.Thread(target=lambda: seen.append(1))
    t.start()
    libc.usleep(20000)
    t.join()
    return seen
show("other threads run", sleeper)

# The functions of the module
show("call_function", lambda: _ctypes.call_function(cast(libc.abs, c_void_p).value, (-3,)))
show("call_cdeclfunction", lambda: _ctypes.call_cdeclfunction(cast(libc.abs, c_void_p).value, (-3,)))
show("dlopen", lambda: (lambda h: (type(h).__name__, type(_ctypes.dlsym(h, "abs")).__name__, _ctypes.dlclose(h)))(_ctypes.dlopen(None)))
show("dlopen bad", lambda: _ctypes.dlopen(5))
show("dlopen missing", lambda: type(_ctypes.dlopen("/no/such/library.so")))
show("dlsym missing", lambda: _ctypes.dlsym(libc._handle, "no_such_function_xyz") and None)
show("dlsym bad", lambda: _ctypes.dlsym(libc._handle, 5))
show("in_dll", lambda: type(c_void_p.in_dll(libc, "environ")).__name__)
show("in_dll value", lambda: bool(POINTER(c_char_p).in_dll(libc, "environ")[0]))
show("in_dll missing", lambda: c_int.in_dll(libc, "no_such_variable_xyz") and None)
show("version", lambda: _ctypes.__version__)
show("no attribute", lambda: _ctypes.nothing)
show("PyObj_FromPtr", lambda: (lambda o: _ctypes.PyObj_FromPtr(id(o)) is o)([1]))
show("INCREF", lambda: (lambda o: (_ctypes.Py_INCREF(o) is o, _ctypes.Py_DECREF(o) is o))([1]))
