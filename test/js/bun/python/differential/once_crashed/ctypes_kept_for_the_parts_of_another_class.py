# What has parts keeps something alive for each of them; what has none keeps one thing, and lets go of it when it is given another. Which of the two an instance is
# went by the class that it was made with. (So it does in CPython, which reads memory that it has freed.)
import ctypes, gc


def attempt(f):
    try:
        return repr(f())
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


class Two(ctypes.Structure):
    _fields_ = [('a', ctypes.c_char_p), ('b', ctypes.c_char_p)]
class Pointers(ctypes.Structure):
    _fields_ = [('a', ctypes.POINTER(ctypes.c_int)), ('b', ctypes.POINTER(ctypes.c_int))]


def fresh(letter):
    return bytes(bytearray(letter * 3000))


def churn():
    for i in range(4):
        gc.collect()
    return [fresh(b'j') for i in range(3000)]


print('--- made without parts, given a class with two')
x = ctypes.c_longdouble()
x.__class__ = Two
x.a, x.b = fresh(b'A'), fresh(b'B')
print(type(x._objects).__name__, len(x._objects))
junk = churn()
print(x.a[:8], x.b[:8], len(x.a), len(x.b))

print('--- it kept something before')
x = ctypes.c_char_p(fresh(b'C'))
ctypes.resize(x, 16)
x.__class__ = Two
before = x.a[:4]
x.b = fresh(b'B')
junk = churn()
print(before, x.a[:8], x.b[:8], type(x._objects).__name__, sorted(x._objects))

print('--- over a buffer: the view stays')
memory = bytearray(16)
x = ctypes.c_longdouble.from_buffer(memory)
x.__class__ = Two
x.a, x.b = fresh(b'A'), fresh(b'B')
junk = churn()
print(x.a[:8], x.b[:8], sorted(x._objects), attempt(lambda: memory.extend(b'x')))

print('--- pointers')
x = ctypes.c_longdouble()
x.__class__ = Pointers
x.a, x.b = ctypes.pointer(ctypes.c_int(1)), ctypes.pointer(ctypes.c_int(2))
junk = churn() + [ctypes.c_int(7) for i in range(3000)]
print(x.a[0], x.b[0], attempt(lambda: x.a[100]))

print('--- an array of them')
x = ctypes.c_longdouble()
x.__class__ = ctypes.c_char_p * 2
x[0], x[1] = fresh(b'A'), fresh(b'B')
junk = churn()
print(attempt(lambda: x[0][:8]), attempt(lambda: x[1][:8]), len(x))

print('--- the other way: made with parts, given a class without')
x = Two(fresh(b'A'), fresh(b'B'))
x.__class__ = ctypes.c_char_p
x.value = fresh(b'C')
junk = churn()
print(x.value[:8], type(x._objects).__name__)
x.__class__ = Two
print(x.a[:8], x.b[:8])

print('--- given the class of a pointer: what it points to, and what that keeps')
x = ctypes.c_void_p()
x.__class__ = ctypes.POINTER(Two)
x.contents = Two(fresh(b'A'), fresh(b'B'))
junk = churn() + [Two() for i in range(3000)]
print(x[0].a[:8], x[0].b[:8], type(x._objects).__name__, sorted(x._objects))

print('--- the value of an instance that lies in another: a field of a class derived from a simple type is read as an instance')
class Mine(ctypes.c_char_p):
    pass
class TwoOfMine(ctypes.Structure):
    _fields_ = [('a', Mine), ('b', Mine)]
x = ctypes.c_longdouble()
x.__class__ = TwoOfMine
x.a.value, x.b.value = fresh(b'A'), fresh(b'B')
print(type(x._objects).__name__, len(x._objects))
junk = churn()
print(x.a.value[:8], x.b.value[:8], len(x.a.value), len(x.b.value))
x = ctypes.c_longdouble()
TwoOfMine.a.__get__(x).value, TwoOfMine.b.__get__(x).value = fresh(b'A'), fresh(b'B')
junk = churn()
print(TwoOfMine.a.__get__(x).value[:8], TwoOfMine.b.__get__(x).value[:8], type(x._objects).__name__)
