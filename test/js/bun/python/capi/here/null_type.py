# An exception is raised whose type is NULL. CPython follows the pointer.
import ctypes, sys
from ctypes import c_char_p, c_void_p

lib = ctypes.PyDLL(sys.argv[1])
for name, args in (("raise_string", (b"text",)), ("raise_object", (None,)), ("raise_none", ())):
    function = getattr(lib, name)
    function.argtypes = [c_void_p, c_char_p if name == "raise_string" else c_void_p][: 1 + len(args)]
    function.restype = None
    try:
        print(function(None, *args))
    except SystemError as e:
        print(type(e).__name__, e)
