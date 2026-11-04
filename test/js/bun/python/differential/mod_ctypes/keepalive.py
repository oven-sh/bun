# What keeps what alive: _objects, _b_base_, _b_needsfree_, and that it does.
import ctypes, re, gc, weakref
from ctypes import *

def norm(o):
    if isinstance(o, dict):
        return {re.sub(r"^\d{6,}$", "ID", str(k)): norm(v) for k, v in o.items()}
    if isinstance(o, tuple):
        return tuple(norm(v) for v in o)
    if isinstance(o, (bytes, str, int, type(None))):
        return o
    return "<%s>" % type(o).__name__

def show(label, f):
    try:
        r = f()
    except BaseException as e:
        r = "%s: %s" % (type(e).__name__, e)
    print(label, r)

class X(Structure):
    _fields_ = [("a", c_int), ("b", c_int)]
class Y(Structure):
    _fields_ = [("x", X), ("y", X)]
class Ptrs(Structure):
    _fields_ = [("s", c_char_p), ("w", c_wchar_p), ("p", POINTER(c_int)), ("o", py_object), ("v", c_void_p), ("arr", c_char_p * 2), ("inner", X)]

show("c_int", lambda: norm(c_int(5)._objects))
show("c_char_p", lambda: norm(c_char_p(b"abc")._objects))
show("c_char_p None", lambda: norm(c_char_p()._objects))
show("c_char_p int", lambda: norm(c_char_p(0)._objects))
show("c_wchar_p", lambda: norm(c_wchar_p("abc")._objects))
show("c_void_p", lambda: norm(c_void_p(5)._objects))
show("py_object", lambda: norm(py_object((1, 2))._objects))
def reassign():
    x = c_char_p(b"one")
    x.value = b"two"
    return norm(x._objects), x.value
show("reassign", reassign)
show("struct", lambda: norm(X(1, 2)._objects))
def nested():
    y = Y()
    y.x = X(1, 2)
    y.y.a = 3
    return norm(y._objects), norm(y.x._objects)
show("nested", nested)
def ptrs():
    s = Ptrs()
    out = [norm(s._objects)]
    s.s = b"bytes"; out.append(norm(s._objects))
    s.w = "text"; out.append(norm(s._objects))
    s.p = pointer(c_int(5)); out.append(norm(s._objects))
    s.o = [1]; out.append(norm(s._objects))
    s.v = 5; out.append(norm(s._objects))
    s.arr[1] = b"item"; out.append(norm(s._objects))
    s.arr = (c_char_p * 2)(b"p", b"q"); out.append(norm(s._objects))
    s.inner = X(1, 2); out.append(norm(s._objects))
    s.s = None; out.append(norm(s._objects))
    return "\n   ".join(map(str, out))
show("pointers in a struct", ptrs)
show("array of char_p", lambda: norm((c_char_p * 3)(b"a", None, b"c")._objects))
show("array of struct", lambda: norm((Ptrs * 2)(Ptrs(b"a"), Ptrs(b"b"))._objects))
show("pointer", lambda: norm(pointer(c_int(5))._objects))
show("pointer to pointer", lambda: norm(pointer(pointer(c_int(5)))._objects))
show("pointer to char_p", lambda: norm(pointer(c_char_p(b"x"))._objects))
def set_item():
    p = pointer(c_char_p(b"x"))
    p[0] = b"y"
    return norm(p._objects), p[0]
show("pointer set item", set_item)
show("cast", lambda: (lambda a: (norm(cast(a, POINTER(c_int))._objects), norm(a._objects)))((c_int * 2)()))
show("cast char_p", lambda: (lambda a: (norm(cast(a, c_void_p)._objects), norm(a._objects)))(c_char_p(b"x")))
show("cast int", lambda: norm(cast(0, c_void_p)._objects))
show("byref", lambda: (lambda x: byref(x)._obj is x)(c_int()))
show("from_param", lambda: [norm(t.from_param(v)._obj) for t, v in ((c_int, 1), (c_char_p, b"x"), (c_wchar_p, "x"), (c_void_p, b"x"), (c_void_p, 1), (py_object, (1,)))])
show("function", lambda: norm(CFUNCTYPE(c_int)(lambda: 1)._objects))
show("library function", lambda: norm(CDLL(None).strlen._objects))
show("bases", lambda: (lambda y: (y._b_base_, y.x._b_base_ is y, y.x._b_needsfree_, y._b_needsfree_, (Y * 2)()[1].y._b_base_._b_base_._b_base_))(Y()))
def deep():
    t = c_char_p
    for i in range(60):
        t = t * 1
    v = t()
    x = v
    for i in range(59):
        x = x[0]
    x[0] = b"deep"
    return len(list(v._objects)[0])
show("deep", deep)
def too_deep():
    t = c_char_p
    for i in range(130):
        t = t * 1
    v = t()
    x = v
    for i in range(129):
        x = x[0]
    x[0] = b"deep"
show("too deep", too_deep)

# It works: what is pointed to outlives the names it had.
class Tracked:
    pass
def alive_object():
    o = Tracked()
    r = weakref.ref(o)
    p = py_object(o)
    del o
    gc.collect()
    first = r() is not None and p.value is r()
    del p
    gc.collect()
    return first, r() is None
show("py_object keeps", alive_object)
def alive_memory():
    p = pointer(c_int(1234))
    s = Ptrs(b"x" * 1000, "y" * 1000, pointer(c_int(99)))
    a = (c_char_p * 100)(*[b"%d" % i * 10 for i in range(100)])
    junk = [bytes(1000) for i in range(2000)]
    del junk
    gc.collect()
    return p[0], s.s == b"x" * 1000, s.w == "y" * 1000, s.p[0], all(a[i] == b"%d" % i * 10 for i in range(100))
show("memory stays", alive_memory)
def contents_outlive():
    p = pointer(c_int(1))
    c = p.contents
    p.contents = c_int(2)
    gc.collect()
    junk = [c_int(i) for i in range(5000)]
    return c.value, p[0]
show("contents outlive the pointer's change", contents_outlive)
def part_outlives():
    part = Y(X(1, 2), X(3, 4)).y
    gc.collect()
    junk = [Y() for i in range(5000)]
    return part.a, part.b
show("part outlives the name of the whole", part_outlives)
def callback_alive():
    cb = CFUNCTYPE(c_int, c_int)(lambda v: v + 1)
    gc.collect()
    return cb(41)
show("callback", callback_alive)

# What follows the memory of a small instance is zero: C finds the end of a string that has none of its own.
libc = CDLL(None)
libc.strlen.restype = c_size_t
libc.wcslen.restype = c_size_t
memchr = libc.memchr
def dirty():
    junk = [(c_ubyte * n)(*([0xf1] * n)) for n in (16, 15, 12, 32, 8, 4, 1) for i in range(30)]
    junk += [create_string_buffer(b"\xf1" * n) for n in (14, 7, 30) for i in range(20)]
    junk += [c_longlong(-1) for i in range(60)] + [c_wchar_p("\U0010ffff" * n) for n in (1, 2, 3, 5, 7) for i in range(12)]
    del junk
    gc.collect()
def zeros_follow():
    bad = []
    for round in range(4):
        dirty()
        for i in range(40):
            ca = c_wchar("a")
            memchr.restype = c_wchar_p
            for arg in (byref(ca), pointer(ca)):
                if memchr(arg, ord("a"), 4) != "a": bad.append("c_wchar")
            if libc.wcslen(byref(c_wchar("b"))) != 1: bad.append("wcslen")
            if libc.wcslen((c_wchar * 3)("x", "y", "z")) != 3: bad.append("wchar array")
            if libc.strlen(byref(c_char(b"x"))) != 1: bad.append("c_char")
            for n in (1, 3, 7, 15):
                if libc.strlen((c_char * n)(*b"q" * n)) != n: bad.append("char array %d" % n)
            memchr.restype = c_char_p
            if memchr((c_char * 5)(*b"hello"), ord("h"), 5) != b"hello": bad.append("c_char_p result")
            if pointer(c_char(b"x"))[0:16] != b"x" + bytes(15): bad.append("chars through a pointer")
            if pointer(c_wchar("x"))[0:4] != "x\0\0\0": bad.append("wchars through a pointer")
            if pointer(c_short(-1))[0:8] != [-1] + [0] * 7: bad.append("shorts through a pointer")
    return sorted(set(bad))
show("zeros follow a small instance", zeros_follow)

# The wchar_t copy of a str lives as long as what holds the pointer, whatever is collected meanwhile.
def wide_copies():
    bad = []
    memchr.restype = c_wchar_p
    memchr.argtypes = [c_wchar_p, c_int, c_size_t]
    class S(Structure):
        _fields_ = [("w", c_wchar_p), ("z", c_char_p), ("ws", c_wchar_p * 2)]
    held = []
    for i in range(60):
        text = "t\xe9xt\u20ac%d" % i
        data = b"bytes%d" % i
        if memchr(text, ord("t"), 4) != text: bad.append("argument")
        if memchr(c_wchar_p(text), ord("t"), 4) != text: bad.append("instance argument")
        x = c_wchar_p(); x.value = text
        s = S(text, data, (c_wchar_p * 2)(text, text + "!"))
        a = (c_wchar_p * 3)(text, None, text * 2)
        p = pointer(c_wchar_p(text))
        f = c_wchar_p.from_param(text)
        held.append((text, data, x, s, a, p, f))
        if i % 15 == 0:
            dirty()
    dirty()
    others = [c_wchar_p("#" * n) for n in (6, 7, 8, 12, 14) for i in range(80)] + [c_char_p(b"#" * n) for n in (6, 7) for i in range(80)]
    for text, data, x, s, a, p, f in held:
        if x.value != text: bad.append("value")
        if (s.w, s.z, s.ws[0], s.ws[1]) != (text, data, text, text + "!"): bad.append("fields")
        if (a[0], a[1], a[2]) != (text, None, text * 2): bad.append("items")
        if p[0] != text or p.contents.value != text: bad.append("pointer")
        if libc.wcslen(f) != len(text): bad.append("from_param")
    memchr.argtypes = None
    return sorted(set(bad))
show("wide copies", wide_copies)

# What a callback returns a pointer into is never let go.
def callback_strings():
    import warnings
    bad = []
    with warnings.catch_warnings(record=True) as seen:
        warnings.simplefilter("always")
        for t, make in ((c_char_p, lambda i: b"result %3d" % i), (c_wchar_p, lambda i: "r\xe9sult %3d" % i)):
            cb = CFUNCTYPE(t, c_int)(make)
            raw = cast(cb, CFUNCTYPE(c_void_p, c_int))
            pointers = [raw(i) for i in range(40)]
            gc.collect()
            others = [t(make(500 + i)) for i in range(400)] # Of the same size: they would get the memory.
            for i, address in enumerate(pointers):
                if cast(address, t).value != make(i): bad.append(t.__name__)
    return sorted(set(bad)), sorted(set(str(w.message) for w in seen))
show("strings from callbacks", callback_strings)
