# For terminated.mjs: a parent that holds two in C's data goes, and the tp_dealloc of the first of the two calls code that does not end.
import ctypes, gc
from ctypes import c_long, c_void_p, py_object


def run(libraries):
    lib = ctypes.PyDLL(f"{libraries}/liblifecycle.so")
    lib.make_types.restype = py_object
    lib.set_id.argtypes = [py_object, c_long]
    lib.set_first.argtypes = lib.set_second.argtypes = [py_object, py_object]
    lib.call_at_dealloc.argtypes = [c_void_p]
    Node = lib.make_types()[0]

    @ctypes.CFUNCTYPE(None, c_long)
    def at_dealloc(id):
        while id == 2:
            pass

    parent, first, second = Node(), Node(), Node()
    for id, node in enumerate((parent, first, second), 1):
        lib.set_id(node, id)
    lib.set_first(parent, first)
    lib.set_second(parent, second)
    lib.call_at_dealloc(ctypes.cast(at_dealloc, c_void_p))
    del parent, first, second, node
    gc.collect()
