# The result of cast() keeps the source alive, if it points into it. Whether it did went by what the source had kept so far. (So it does in CPython, which reads memory that it has freed.)
import ctypes, gc


def attempt(f):
    try:
        return repr(f())
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


def fresh(letter):
    return bytes(bytearray(letter * 3000))


def churn():
    for i in range(4):
        gc.collect()
    return [fresh(b'j') for i in range(3000)] + [ctypes.create_string_buffer(4096) for i in range(2000)]


def make(x):
    ctypes.resize(x, 4096)
    x.__class__ = ctypes.c_char_p * 512
    result = ctypes.cast(x, ctypes.POINTER(ctypes.c_char_p))
    print(type(x._objects).__name__, type(result._objects).__name__)
    return result
result = make(ctypes.c_char_p(fresh(b'C')))
junk = churn()
print(attempt(lambda: result[0][:8]))
result = make(ctypes.c_longdouble())
result[0] = fresh(b'R')
junk = churn()
print(attempt(lambda: result[0][:8]))

# The class of the result runs code when the result is made, and gives the source its old class back. What counts is what the source was when its address was taken.
def make_with_a_class_that_meddles():
    sources = [ctypes.c_char_p(fresh(b'M'))]
    ctypes.resize(sources[0], 4096)
    sources[0].__class__ = ctypes.c_char_p * 512
    class Meddling(ctypes._Pointer):
        _type_ = ctypes.c_char_p
        def __init__(self):
            sources.pop().__class__ = ctypes.c_char_p
    result = ctypes.cast(sources[0], Meddling)
    print(len(sources), type(result._objects).__name__)
    return result
result = make_with_a_class_that_meddles()
junk = churn()
print(attempt(lambda: result[0][:8]))

# Of a simple type: the result points where the value points, and keeps what the source keeps.
source = ctypes.c_char_p(fresh(b'S'))
result = ctypes.cast(source, ctypes.POINTER(ctypes.c_char))
print(type(source._objects).__name__, type(result._objects).__name__, result[0], result._objects is source._objects)
source = ctypes.c_void_p(0)
result = ctypes.cast(source, ctypes.POINTER(ctypes.c_char))
print(type(source._objects).__name__, type(result._objects).__name__, bool(result), len(result._objects))
