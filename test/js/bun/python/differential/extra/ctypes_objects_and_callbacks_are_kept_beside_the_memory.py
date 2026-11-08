# The eight bytes of a py_object stand for an object, those of a function pointer made of a Python function for the code that calls it. Both live for as long as the eight bytes say so, whatever
# has become of _objects, and go along when the eight bytes are copied. (In CPython these use what has been freed.)
import gc
from ctypes import *
import js

class Thing:
    def __init__(self, name): self.name = name
F = CFUNCTYPE(c_long, c_long)
class S(Structure): _fields_ = [('n', c_long), ('o', py_object), ('f', F)]
class D(Structure): _fields_ = [('before', c_long), ('inner', S)]
def churn():
    for _ in range(3): gc.collect()
    return [Thing('junk') for _ in range(2000)] + [F(lambda x: -1) for _ in range(50)]

s = S(); s.o = Thing('kept'); s.f = F(lambda x: x + 1); s._objects.clear()
junk = churn()
print('fields, _objects emptied:', s.o.name, s.f(41))

d = D(); d.inner = s; del s; d._objects.clear()
junk = churn()
print('the structure stored into a field:', d.inner.o.name, d.inner.f(41))

a = (py_object * 50)(*[Thing(i) for i in range(50)]); a._objects.clear()
junk = churn()
print('50 items:', [a[i].name for i in range(50)] == list(range(50)))

o = py_object(Thing('whole')); p = pointer(o); del o; p._objects.clear()
junk = churn()
print('through a pointer:', p[0].name, p.contents.value.name)

f = F(lambda x: x * 2); v = cast(f, c_void_p); del f; v._objects.clear(); g = cast(v, F); del v; g._objects.clear()
junk = churn()
print('a callback by way of a c_void_p:', g(21))

fs = (F * 3)(F(lambda x: x + 1), F(lambda x: x + 2), F(lambda x: x + 3)); fs._objects.clear()
junk = churn()
print('an array of callbacks:', [fs[i](0) for i in range(3)])

# What a py_object stands for may be anything, an array of JS among them, and values that are no cells.
o = py_object(js.eval('[1, 2, 3]'))
print('an array of JS:', list(o.value))
s = S(); s.o = js.eval('[4, 5]'); s.o = js.eval('[6]'); print('in a field:', list(s.o))
for value in (5, None, True, 2.5, 'text', 10 ** 30, (1, 2)):
    o = py_object(value); assert o.value == value and type(o.value) is type(value)
o = py_object(Thing('first')); o.value = 7; print('a small int over an object:', o.value)
# What is written down for a place that was last written as a pointer is memory, and no object, whatever the bits are made to say.
class U(Union): _fields_ = [('p', POINTER(c_long)), ('o', py_object), ('n', c_size_t)]
x = c_long(5); u = U(); u.p = pointer(x)
for back in (8, 16, 24, 32):
    u.n = addressof(x) - back
    try: print('handed out:', type(u.o))
    except ValueError as e: print(back, 'bytes in front of the memory:', e)
o = py_object()
try: o.value
except ValueError as e: print('nothing stored:', e)
