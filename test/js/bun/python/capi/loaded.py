# A library that reads the data of the API and calls it while it is being loaded: a constructor, or in C++ the initializer of a static variable.
import ctypes, gc, sys
from ctypes import c_int, py_object

lib = ctypes.PyDLL(sys.argv[1])
gc.collect()
junk = [[i] for i in range(10000)]
lib.is_the_none_of_then.argtypes = lib.is_int_type.argtypes = [py_object]
lib.list_of_then.restype = lib.type_of_the_number.restype = lib.error_of_then.restype = lib.identities_then.restype = py_object
lib.raise_the_error_of_then.restype = None
print(lib.initialized_then(), lib.is_the_none_of_then(None), lib.is_the_none_of_then(0))
print(lib.list_of_then(), lib.list_of_then() is lib.list_of_then())
print(lib.type_of_the_number() is int, lib.is_int_type(int), lib.is_int_type(lib.type_of_the_number()))
print(lib.error_of_then() is ValueError)
try:
    lib.raise_the_error_of_then()
except ValueError as e:
    print(type(e).__name__, e)
print(lib.identities_then())
