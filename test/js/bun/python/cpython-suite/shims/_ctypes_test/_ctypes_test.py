"""A stand-in for CPython's _ctypes_test, for the scoreboard only.

The real one is an extension module that the tests load a second time, as a plain shared library, through its __file__. Here the
library is Modules/_ctypes/_ctypes_test.c built against src/Python.h, which needs no C API (build.sh), and this module has its path
for a __file__ and the few functions that the extension module has for Python."""

import ctypes as _ctypes
import os as _os

__file__ = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "_ctypes_test_library.so")
if not _os.path.exists(__file__):
    raise ImportError("the library has not been built: run build.sh")


class _Object(_ctypes.Structure):
    pass


_Object._fields_ = [("kind", _ctypes.c_int), ("number", _ctypes.c_longlong), ("data", _ctypes.POINTER(_ctypes.c_char)), ("size", _ctypes.c_size_t),
                    ("items", _ctypes.POINTER(_ctypes.POINTER(_Object)))]
_Function = _ctypes.CFUNCTYPE(_ctypes.POINTER(_Object), _ctypes.POINTER(_Object), _ctypes.POINTER(_Object))


class _Method(_ctypes.Structure):
    _fields_ = [("name", _ctypes.c_char_p), ("function", _Function), ("flags", _ctypes.c_int), ("doc", _ctypes.c_char_p)]


_library = _ctypes.CDLL(__file__)
_library.PyInit__ctypes_test.restype = _ctypes.POINTER(_Method)
_library.standin_string.restype = _ctypes.POINTER(_Object)
_library.standin_string.argtypes = [_ctypes.c_char_p]
_library.standin_last_error.restype = _ctypes.c_char_p


def _value(pointer):
    if not pointer:
        raise ValueError(_library.standin_last_error().decode())
    o = pointer.contents
    if o.kind == 0:
        return None
    if o.kind == 1:
        return o.number
    if o.kind == 2:
        return o.number & (2**64 - 1)
    if o.kind == 3:
        return o.data[:o.size].decode()
    if o.kind == 4:
        return o.data[:o.size]
    return [_value(o.items[i]) for i in range(o.size)]


def _make(function, flags):
    if flags == 8:
        def call(argument):
            if not isinstance(argument, str):
                raise TypeError("need a string")
            return _value(function(None, _library.standin_string(argument.encode())))
    else:
        def call(*arguments):
            return _value(function(None, None))
    return call


_methods = _library.PyInit__ctypes_test()
_i = 0
while _methods[_i].name:
    globals()[_methods[_i].name.decode()] = _make(_methods[_i].function, _methods[_i].flags)
    _i += 1
