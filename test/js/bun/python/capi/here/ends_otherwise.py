# A call of C's that ends otherwise than by handing over its result: neither the reference that came with the result nor what C raised outlives it.
# (CPython keeps the reference for ever in the first case, and the second is the end of the process there.)
import ctypes, gc, sys, weakref
from ctypes import c_char_p, c_long, py_object

lib = ctypes.PyDLL(sys.argv[1])
lib.raise_and_return.argtypes = [py_object, py_object]
lib.raise_and_return.restype = py_object
lib.count.argtypes = [py_object]
lib.count.restype = c_long


class Thing:
    pass


thing = Thing()
base = lib.count(thing)
for i in range(3):
    try:
        lib.raise_and_return(KeyError, thing)
    except KeyError:
        print("KeyError", lib.count(thing) - base)
# Nor has the program got what it has not got: a tuple that C goes on filling.
lib.raise_and_return_new_tuple.argtypes = lib.fill_tuple_returned_beside_an_exception.argtypes = [py_object]
lib.raise_and_return_new_tuple.restype = lib.fill_tuple_returned_beside_an_exception.restype = py_object
try:
    lib.raise_and_return_new_tuple(KeyError)
except KeyError:
    print("KeyError", lib.fill_tuple_returned_beside_an_exception(7))
ref = weakref.ref(thing)
del thing
gc.collect()
print(ref())

# No other thread wants the GIL, so the thread has kept it, and C gets in.
without = ctypes.CDLL(sys.argv[1])
without.raise_string.argtypes = [py_object, c_char_p]
without.raise_string.restype = None
try:
    without.raise_string(ValueError, b"by a function of a CDLL")
except ValueError as e:
    print("ValueError", e)
print(lib.count([]) > 1)
