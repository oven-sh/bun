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
