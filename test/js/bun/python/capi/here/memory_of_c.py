# What C allocates hangs on objects whose tp_dealloc frees it, and that waits for a collection. The objects themselves are small: collections have to come as C's memory grows.
import ctypes, sys
from ctypes import c_long, py_object

lib = ctypes.PyDLL(sys.argv[1])
lib.make_type.restype = py_object
lib.fill.argtypes = [py_object, c_long]
Holder = lib.make_type()

made = 0
while not lib.count_destroyed() and made < 2000:
    holder = Holder()
    assert lib.fill(holder, 1 << 20)
    made += 1
print("the first was destroyed before 2,000 blocks of a megabyte had been asked for:", made < 2000)
