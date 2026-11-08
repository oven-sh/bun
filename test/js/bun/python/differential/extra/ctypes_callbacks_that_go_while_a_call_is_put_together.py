# The code of a callback belongs to its thunk, and is given to the next callback when the thunk has gone. An address of it that has been read keeps the thunk until it has been used.
# (No oracle: CPython calls memory that has been freed.)
import gc
from ctypes import *
CB = CFUNCTYPE(c_int, c_int)
CALL = CFUNCTYPE(c_int, CB, c_int)
caller = CALL(lambda f, x: f(x))
kept = []
def attempt(f):
    try: return f()
    except Exception as e: return '%s: %s' % (type(e).__name__, e)
def take_what_is_free():
    gc.collect(); gc.collect()
    kept.extend(CB(lambda x, i=i: 5000 + i) for i in range(3))
class S(Structure): _fields_ = [('f', CB), ('g', CB)]

print('--- the conversion of an argument stores another function where the one that is being called was')
s = S(); s.f = CB(lambda x: x + 1)
class Replaces:
    @property
    def _as_parameter_(self):
        s.f = CB(lambda x: 1000 + x); take_what_is_free(); return 1
print(attempt(lambda: s.f(Replaces())), attempt(lambda: s.f(1)))
s.f = CB(lambda x: x + 1)
print('as an argument:', attempt(lambda: caller(s.f, Replaces())), attempt(lambda: caller(s.f, 1)))
class FromParam:
    @classmethod
    def from_param(cls, value):
        s.f = CB(lambda x: 2000 + x); take_what_is_free(); return 1
s.f = CB(lambda x: x + 1)
f = s.f; f.argtypes = [FromParam]
print('by from_param():', attempt(lambda: f(0)))

print('--- the callback stores another function where it was called through')
def body(x):
    s.g = CB(lambda y: 0); take_what_is_free(); return x + 7
s.g = CB(body)
print(attempt(lambda: s.g(1)), attempt(lambda: s.g(1)))

print('--- declared as c_void_p')
CMP = CFUNCTYPE(c_int, POINTER(c_int), POINTER(c_int))
class T(Structure): _fields_ = [('f', CMP)]
qsort = CDLL(None).qsort; qsort.restype = None
for declared in (CMP, c_void_p):
    qsort.argtypes = [c_void_p, c_size_t, c_size_t, declared]
    t = T(); t.f = CMP(lambda a, b: a[0] - b[0]); others = []
    class ReplacesComparison:
        @property
        def _as_parameter_(self):
            t.f = CMP(lambda a, b: 0); gc.collect(); gc.collect()
            kept.extend(CMP(lambda a, b: others.append(1) or 0) for i in range(8)); return 1
    a = (c_int * 4)(4, 3, 2, 1)
    print(declared.__name__, attempt(lambda: qsort(a, 4, 4, t.f, ReplacesComparison())), list(a), len(others))
s.f = CB(lambda x: x + 1)
argument = c_void_p.from_param(s.f); s.f = CB(lambda x: 0); take_what_is_free()
print('an argument that is kept:', attempt(lambda: CFUNCTYPE(c_int, c_void_p, c_int)(lambda f, x: cast(f, CB)(x))(argument, 1)))

print('--- what a finalizer saves goes on working')
saved = []
class Holder:
    def __init__(self, f): self.f = f
    def __del__(self): saved.append(self.f)
Holder(CB(lambda x: x + 1)); take_what_is_free()
print(len(saved), attempt(lambda: saved[0](1)))

print('--- code of a library, a null pointer, an address given as an int')
labs = CDLL(None).labs
print(labs(-3), attempt(lambda: CB()(1)), attempt(lambda: CFUNCTYPE(c_long, c_long)(cast(labs, c_void_p).value)(-4)))

print('--- a value that is read and stored again leaves what is written down for the place')
class K:
    def __init__(self, n): self.n = n
class U(Union): _fields_ = [('f', CB), ('o', py_object), ('v', c_void_p)]
u = U(); u.f = CB(lambda x: x + 21); u._objects.clear(); u.v = u.v; take_what_is_free()
print(attempt(lambda: u.f(1)))
u = U(); u.o = K(5); u._objects.clear(); u.v = u.v; gc.collect(); junk = [K(i) for i in range(2000)]
print(attempt(lambda: u.o.n))
