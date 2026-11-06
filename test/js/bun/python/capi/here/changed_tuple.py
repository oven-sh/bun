# A tuple that C changes after somebody has asked for its hash. CPython 3.15 goes on answering with the hash of what it held before.
import ctypes, sys
from ctypes import PYFUNCTYPE, py_object

lib = ctypes.PyDLL(sys.argv[1])
LOOKS = PYFUNCTYPE(None, py_object)
lib.tuple_changed_after_a_look.restype = py_object
lib.tuple_changed_after_a_look.argtypes = [LOOKS, py_object, py_object]
changed = lib.tuple_changed_after_a_look(LOOKS(hash), 4, 5)
print(changed, hash(changed) == hash((5,)), changed in {(5,): 1}, changed in {(4,): 1})
