# C raises a tuple that it has made, and keeps a reference. The program gets the tuple, so C fills it no longer. (CPython has no use for an exception that is none.)
import ctypes, sys
from ctypes import c_int, py_object

lib = ctypes.PyDLL(sys.argv[1])
lib.raise_tuple_and_keep_it.argtypes = lib.set_item_of_kept_tuple.argtypes = [py_object]
lib.raise_tuple_and_keep_it.restype = None
lib.set_item_of_kept_tuple.restype = c_int
try:
    lib.raise_tuple_and_keep_it(4)
except BaseException as e:
    thrown = e.value
found = {thrown: "found"}
try:
    print(lib.set_item_of_kept_tuple(5))
except SystemError as e:
    print(type(e).__name__, e)
print(thrown, found.get(thrown), found.get((4,)))
