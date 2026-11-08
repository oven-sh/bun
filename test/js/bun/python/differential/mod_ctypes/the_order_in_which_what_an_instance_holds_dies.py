# What an instance of ctypes keeps alive dies with it, in the order in which _objects lets go of it.
import gc
from ctypes import *

log = []
class K:
    def __init__(self, n): self.n = n
    def __del__(self): log.append(self.n)
class Int(c_int):
    def __del__(self): log.append(('Int', self.value))
class Long(c_long):
    def __del__(self): log.append(('Long', self.value))

def in_order(): a = (py_object * 12)(*[K(i) for i in range(12)])
def stored_from_the_end():
    a = (py_object * 12)()
    for i in reversed(range(12)): a[i] = K(i)
def stored_here_and_there():
    a = (py_object * 12)()
    for i in (5, 3, 9, 0, 11, 7, 1): a[i] = K(i)
def many():
    a = (py_object * 3000)()
    for i in (2999, 5, 1500, 0, 2000): a[i] = K(i)
def a_structure():
    class S(Structure): _fields_ = [('a', py_object), ('b', py_object), ('c', py_object), ('d', py_object)]
    s = S(K(0), K(1), K(2), K(3))
def fields_from_the_end():
    class S(Structure): _fields_ = [('a', py_object), ('b', py_object), ('c', py_object), ('d', py_object)]
    s = S(); s.d = K(3); s.c = K(2); s.b = K(1); s.a = K(0)
def pointers(): a = (POINTER(Int) * 6)(*[pointer(Int(i)) for i in range(6)])
def pointers_from_the_end():
    a = (POINTER(Int) * 6)()
    for i in reversed(range(6)): a[i] = pointer(Int(i))
def pointers_to_instances_over_bytearrays():
    buffers = [bytearray(8) for i in range(6)]
    a = (POINTER(Long) * 6)()
    for i in (4, 0, 5, 2):
        x = Long.from_buffer(buffers[i]); x.value = i; a[i] = pointer(x)
def an_array_stored_into_an_item():
    a = (py_object * 6)(*[K(i) for i in range(6)]); w = (type(a) * 2)(); w[1] = a; del a
def over_a_bytearray():
    b = bytearray(8 * 6); a = (py_object * 6).from_buffer(b)
    for i in (0, 1, 3, 5): a[i] = K(i)
def a_holder_with_a_finalizer():
    class H(Structure):
        _fields_ = [('o', py_object), ('p', py_object)]
        def __del__(self): log.append('holder')
    h = H(K(1), K(2))
def one(): o = py_object(K(1))
def stored_to_again():
    a = (py_object * 4)(*[K(i) for i in range(4)]); a[1] = K(10); gc.collect(); a[2] = None
def a_packed_structure():
    class P(Structure):
        _pack_ = 1; _layout_ = 'ms'
        _fields_ = [('c', c_char), ('a', py_object), ('b', py_object), ('d', py_object)]
    p = P(); p.d = K(3); p.a = K(1); p.b = K(2)

for f in (in_order, stored_from_the_end, stored_here_and_there, many, a_structure, fields_from_the_end, pointers, pointers_from_the_end, pointers_to_instances_over_bytearrays, an_array_stored_into_an_item,
          over_a_bytearray, a_holder_with_a_finalizer, one, stored_to_again, a_packed_structure):
    log.clear(); f(); gc.collect(); gc.collect()
    print('%-42s %s' % (f.__name__, log))
