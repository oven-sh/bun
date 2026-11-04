# ctypes without addresses: no from_address, no cast, no pointer arithmetic, no foreign calls. Whatever happens must be a result or an exception.
# usage: ctypes_safe.py [SEED [ROUNDS]]. First the cases that were thought of, then random ones.
import os, sys, gc, random, pickle, array, threading, mmap, copy
import ctypes, ctypes._layout, _ctypes
from ctypes import *

TRACE = "CTYPES_SAFE_TRACE" in os.environ
def attempt(f, *a):
    if TRACE:
        print(getattr(f, "__qualname__", f), getattr(getattr(f, "__self__", None), "__class__", None), [type(x).__name__ for x in a], getattr(getattr(f, "__code__", None), "co_firstlineno", ""), file=sys.stderr, flush=True)
    try:
        return f(*a)
    except RecursionError:
        return None
    except Exception as e:
        return e

class P(Structure):
    _fields_ = [("x", c_longlong), ("y", c_longlong), ("z", c_longlong * 8)]

# A field asked about an instance that is too small for it.
for small in (c_byte(1), (c_byte * 3)(), c_int(5), pointer(c_int(1))):
    for f in (P.x, P.y, P.z):
        attempt(f.__get__, small)
        attempt(f.__set__, small, 1)
        attempt(f.__set__, small, (c_longlong * 8)())

# Conversions that pull the rug.
class Evil:
    def __init__(self, f): self.f = f
    def __index__(self): self.f(); return 7
    def __float__(self): self.f(); return 7.0
    def __bool__(self): self.f(); return True
for t in (c_int, c_double, c_bool, c_longlong):
    x = (t * 4)()
    attempt(x.__setitem__, 3, Evil(lambda: (resize(x, 100000), gc.collect())))
    attempt(x.__setitem__, 3, Evil(lambda: (resize(x, sizeof(x)), gc.collect())))
    b = bytearray(64)
    y = (t * 4).from_buffer(b)
    attempt(y.__setitem__, 3, Evil(lambda: y._objects["ffffffff"].release()))
    attempt(y.__getitem__, 3)
    attempt(lambda: y[:])
    attempt(bytes, y)
    attempt(memoryview, y)
    attempt(b.clear)
    attempt(y.__setitem__, 0, 1)
    v = t.from_buffer(bytearray(16))
    attempt(setattr, v, "value", Evil(lambda: v._objects.release()))
    attempt(getattr, v, "value")

# What from_buffer looks at goes away or changes size.
for make in (lambda: bytearray(128), lambda: array.array("b", bytes(128)), lambda: mmap.mmap(-1, 4096), lambda: (c_char * 128)(), lambda: memoryview(bytearray(128))[8:]):
    src = make()
    s = attempt(P.from_buffer, src)
    a = attempt((c_int * 4).from_buffer, src, 4)
    part = attempt(lambda: a[1:3])
    for op in ("clear", "close", "release", "pop", "append", "extend", "resize"):
        m = getattr(src, op, None)
        if m:
            attempt(m); attempt(m, 1); attempt(m, b"x" * 10000)
    del src
    gc.collect()
    attempt(lambda: (a[0], a[3], a[:], bytes(a)))
    attempt(a.__setitem__, 0, 5)

# resize, and what was made before it.
s = (P * 4)()
parts = [s[i] for i in range(4)] + [s[3].z, pointer(s[2]), pointer(s)]
for n in (sizeof(s), 10**6, sizeof(s), 10**5, sizeof(s) + 1, 10**7):
    attempt(resize, s, n)
    parts.append(s[3]); parts.append(memoryview(s))
    gc.collect()
    for p in parts:
        attempt(lambda: (p.x, p.y, list(p.z)))
        attempt(lambda: p[0])
        attempt(bytes, p)
        attempt(lambda: p.contents.x)
for bad in (-1, 0, 2**62, 2**63 - 1, 2**64, "x"):
    attempt(resize, s, bad)

# A metaclass that says yes to everything.
class Yes(type(Structure)):
    def __instancecheck__(self, o): return True
    def __subclasscheck__(self, o): return True
class Big(Structure, metaclass=Yes):
    _fields_ = [("a", c_longlong * 100)]
class Holder(Structure):
    _fields_ = [("b", Big), ("p", POINTER(Big))]
h = Holder()
for v in (c_byte(1), P(), 5, "x", (c_byte * 2)(), pointer(c_byte(1))):
    attempt(setattr, h, "b", v)
    attempt(setattr, h, "p", v)
    attempt(POINTER(Big).from_param, v)
    attempt(Big.from_param, v)
    attempt((Big * 2)().__setitem__, 0, v)
    attempt(pointer(Big()).__setitem__, 0, v)

# A layout that lies.
real = ctypes._layout.get_layout
class Fake:
    pass
def lying(size, align, offsets):
    def get_layout(cls, fields, is_struct, base):
        r = real(cls, fields, is_struct, base)
        f = Fake()
        f.size, f.align, f.format_spec = size, align, r.format_spec
        f.fields = [attempt(_ctypes.CField, name=x.name, type=x.type, byte_size=x.byte_size, byte_offset=o, index=i, _internal_use=True) for i, (x, o) in enumerate(zip(r.fields, offsets))]
        return f
    return get_layout
for size, align, offsets in ((0, 1, (0, 8)), (4, 1, (100, -8)), (8, 0, (2**62, -2**62)), (2**62, 1, (0, 2**61)), (16, 2**40, (8, 9)), (-1, 1, (0, 0)), (16, -1, (0, 0))):
    ctypes._layout.get_layout = lying(size, align, offsets)
    try:
        L = attempt(type(Structure), "L", (Structure,), {"_fields_": [("a", c_longlong), ("b", c_double)]})
    finally:
        ctypes._layout.get_layout = real
    if isinstance(L, type):
        o = attempt(L)
        for n in ("a", "b"):
            attempt(getattr, o, n); attempt(setattr, o, n, 1)
        attempt(bytes, o); attempt(memoryview, o); attempt(lambda: (L * 3)()[2].b); attempt(pickle.dumps, o); attempt(L.from_buffer_copy, bytes(64)); attempt(L.from_buffer, bytearray(64))
for junk in (None, 5, Fake(), [1]):
    ctypes._layout.get_layout = lambda *a, **k: junk
    try:
        attempt(type(Structure), "L", (Structure,), {"_fields_": [("a", c_int)]})
    finally:
        ctypes._layout.get_layout = real

# Classes whose __new__ or __init__ do something else.
class Odd(c_int):
    def __new__(cls, *a): return 5
class OddS(Structure):
    _fields_ = [("a", c_int)]
    def __new__(cls, *a): return c_byte(1)
class HolderOdd(Structure):
    _fields_ = [("o", OddS), ("i", Odd)]
ho = attempt(HolderOdd)
attempt(setattr, ho, "o", (1,)); attempt(getattr, ho, "o"); attempt(getattr, ho, "i"); attempt(setattr, ho, "i", 3)
attempt(lambda: (Odd * 2)()[0]); attempt(lambda: (OddS * 2)()[1].a); attempt(pickle.loads, attempt(pickle.dumps, (c_int * 2)()))
attempt(_ctypes._unpickle, OddS, ({}, b"x" * 100)); attempt(_ctypes._unpickle, Odd, ({}, b"x" * 100)); attempt(_ctypes._unpickle, int, ({}, b""))

# State that does not fit.
for t in (c_int, P, c_char * 3, c_int * 0):
    o = t()
    for state in (b"", b"x" * 10**6, "x" * 1000, bytearray(5), memoryview(b"abc"), 5, None):
        attempt(o.__setstate__, {}, state)
        attempt(o.__setstate__, {"a": 1}, state)

# py_object: what is in the memory need not be an object.
o = py_object([1, 2])
m = memoryview(o).cast("B")
for pattern in (b"\0" * 8, b"\xff" * 8, b"\x01" * 8, b"\x10\0\0\0\0\0\0\0", (id(o) + 8).to_bytes(8, "little"), (id(o) + 16).to_bytes(8, "little"), id(m).to_bytes(8, "little"), (2**47 - 16).to_bytes(8, "little"),
                b"\x02\0\0\0\0\0\0\0", b"\x04\0\0\0\0\0\0\0", b"\x06\0\0\0\0\0\0\0", b"\x07\0\0\0\0\0\0\0", b"\x0a\0\0\0\0\0\0\0", b"\0\0\0\0\0\0\xfe\xff", b"\0\0\0\0\0\0\x02\0", id(type(o)).to_bytes(8, "little")):
    m[:] = pattern
    r = attempt(getattr, o, "value")
    attempt(repr, r); attempt(repr, o); attempt(type, r); attempt(hash, r)
for n in (0, 1, 8, 16, 2**47, 2**63, id(o) + 8, id(o) - 16, id("s"), id(5), id(None), id(2**70), id(1.5)):
    r = attempt(_ctypes.PyObj_FromPtr, n)
    attempt(repr, r)
junk = [object() for i in range(1000)]
ids = [id(j) for j in junk]
del junk
gc.collect()
for n in ids[::50]:
    attempt(repr, attempt(_ctypes.PyObj_FromPtr, n))

# The bytes after a small instance, and within the memory it was given, are its own and are zero.
for t in (c_char, c_wchar, c_short, c_char * 3, c_wchar * 3, c_byte * 15, c_int * 0, P):
    junk = [(c_ubyte * n)(*([0xf1] * n)) for n in (1, 4, 8, 16, 32, 80) for i in range(50)]
    del junk
    gc.collect()
    for i in range(50):
        o = t()
        n = sizeof(o)
        attempt(resize, o, max(n, 16))
        assert not any(bytes(o)), (t, bytes(o))
        attempt(resize, o, n + 100)
        assert not any(bytes(o)), (t, bytes(o))

# ---- At random ----
seed = int(sys.argv[1]) if len(sys.argv) > 1 else 1
rounds = int(sys.argv[2]) if len(sys.argv) > 2 else 300
rnd = random.Random(seed)
SIMPLE = [c_byte, c_ubyte, c_short, c_ushort, c_int, c_uint, c_long, c_ulong, c_longlong, c_ulonglong, c_float, c_double, c_longdouble, c_bool, c_char, c_wchar, c_char_p, c_wchar_p, c_void_p, py_object,
          c_float_complex, c_double_complex, c_int.__ctype_be__, c_double.__ctype_be__, c_short.__ctype_be__]
VALUES = [0, 1, -1, 255, 2**31, 2**63, -2**63, 2**70, 1.5, -0.0, float("inf"), float("nan"), 1j, True, None, b"", b"a", b"abc\0def", "", "a", "h\xe9\U0001f600", "\ud800", (), (1, 2), [1], {}, bytearray(b"xy"), object(), int]
# An int stored where a pointer is expected is an address, and bytes written over a pointer are one too. So there are two kinds of run:
# with pointers, and then without ints for values and without unions; or with those, and then without pointers.
if seed % 2:
    VALUES = [v for v in VALUES if not isinstance(v, (int, tuple, list))]
else:
    SIMPLE = [t for t in SIMPLE if t not in (c_char_p, c_wchar_p, c_void_p)]
count = 0
def make_type(depth):
    global count
    k = rnd.random()
    if depth <= 0 or k < 0.35:
        return rnd.choice(SIMPLE)
    if k < 0.55:
        return make_type(depth - 1) * rnd.choice((0, 1, 2, 3, 7))
    if k < 0.65 and seed % 2:
        return POINTER(make_type(depth - 1))
    count += 1
    fields = []
    for i in range(rnd.randrange(0, 5)):
        t = make_type(depth - 1)
        if t in SIMPLE[:10] and rnd.random() < 0.3:
            fields.append(("f%d" % i, t, rnd.randrange(1, sizeof(t) * 8 + 1)))
        else:
            fields.append(("f%d" % i, t))
    ns = {"_fields_": fields}
    if rnd.random() < 0.2: ns.update(_pack_=rnd.choice((1, 2, 4)), _layout_="ms")
    if rnd.random() < 0.1: ns["_align_"] = rnd.choice((1, 8, 32))
    base = rnd.choice((Structure, Structure, Structure if seed % 2 else Union, BigEndianStructure, LittleEndianStructure))
    r = attempt(type(base), "T%d" % count, (base,), ns)
    return r if isinstance(r, type) else c_int
def poke(o, depth=0):
    if depth > 3 or not isinstance(o, _ctypes._SimpleCData.__mro__[1]):
        return
    for i in range(rnd.randrange(1, 5)):
        k = rnd.random()
        v = rnd.choice(VALUES + live[-5:])
        if isinstance(o, (Structure, Union)) and o._fields_:
            n = rnd.choice(o._fields_)[0]
            if k < 0.5: poke(attempt(getattr, o, n), depth + 1)
            else: attempt(setattr, o, n, v)
        elif isinstance(o, Array):
            i = rnd.choice((0, 1, -1, len(o) - 1, len(o), slice(None), slice(1, None, 2), slice(None, None, -1)))
            if k < 0.5: poke(attempt(o.__getitem__, i), depth + 1)
            elif not (seed % 2 and isinstance(i, slice)): attempt(o.__setitem__, i, v) # The items of bytes are ints.
            attempt(getattr, o, "value"); attempt(getattr, o, "raw"); attempt(setattr, o, "value", v); attempt(setattr, o, "raw", v)
        elif isinstance(o, _ctypes._Pointer):
            # Contents of another type are a cast: its bytes may then be read as pointers.
            if k < 0.3 and (isinstance(v, o._type_) or not isinstance(v, _ctypes._SimpleCData.__mro__[1])): attempt(setattr, o, "contents", v)
            elif o and o._objects: poke(attempt(getattr, o, "contents"), depth + 1); attempt(o.__getitem__, 0); attempt(o.__setitem__, 0, v)
        elif isinstance(o, _ctypes._SimpleCData) and not (isinstance(o, (c_char_p, c_wchar_p)) and isinstance(v, int)):
            attempt(setattr, o, "value", v)
            if not isinstance(o, (c_char_p, c_wchar_p)) or not isinstance(o._objects, type(None)) or not o: attempt(getattr, o, "value")
    attempt(repr, o); attempt(bytes, o); attempt(bool, o); attempt(lambda: o._objects); attempt(sizeof, o)
live = []
def one_round():
    t = make_type(3)
    k = rnd.random()
    if k < 0.6: o = attempt(t)
    elif k < 0.75: o = attempt(t.from_buffer, bytearray(rnd.choice((0, 1, 8, 64, 1024))), rnd.choice((0, 0, 1, 8)))
    elif k < 0.9: o = attempt(t.from_buffer_copy, bytes(rnd.choice((0, 8, 64, 1024))), rnd.choice((0, 0, 3)))
    else: o = attempt(pointer, attempt(t)) if seed % 2 else attempt(t)
    live.append(o)
    poke(o)
    k = rnd.random()
    if k < 0.1: attempt(resize, o, rnd.choice((0, 1, 16, 4096, 10**6)))
    elif k < 0.2: attempt(pickle.loads, attempt(pickle.dumps, o))
    elif k < 0.3:
        m = attempt(memoryview, o)
        if isinstance(m, memoryview) and not any(p in m.format for p in "&zZPOX"):
            c = attempt(m.cast, "B")
            if isinstance(c, memoryview) and len(c): attempt(c.__setitem__, rnd.randrange(len(c)), rnd.randrange(256))
        live.append(m)
    elif k < 0.35: attempt(copy.deepcopy, o)
    elif k < 0.4: gc.collect()
    if len(live) > 40: del live[:rnd.randrange(1, 30)]
    poke(rnd.choice(live))
for i in range(rounds):
    one_round()
# The same objects from several threads.
shared = [x for x in live if isinstance(x, _ctypes._SimpleCData.__mro__[1])][-8:]
def worker(n):
    r = random.Random(seed * 100 + n)
    for i in range(200):
        o = r.choice(shared) if shared else c_int()
        attempt(bytes, o); attempt(repr, o); attempt(resize, o, r.choice((sizeof(o), 4096, 100000)))
        if isinstance(o, Array) and len(o): attempt(o.__getitem__, slice(None)); attempt(o.__setitem__, 0, r.choice(VALUES))
threads = [threading.Thread(target=worker, args=(n,)) for n in range(4)]
for t in threads: t.start()
for t in threads: t.join()
print("done", seed)
