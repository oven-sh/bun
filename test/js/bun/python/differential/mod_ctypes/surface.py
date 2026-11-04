# What the module _ctypes has, and what its types have.
import _ctypes, ctypes, inspect, types

for name in sorted(dir(_ctypes)):
    if name in ("__loader__", "__spec__", "__file__", "__package__", "__cached__"):
        continue
    v = getattr(_ctypes, name)
    if name.endswith("_addr"):
        print(name, type(v).__name__, v > 0)
    elif isinstance(v, (int, str)) or v is None:
        print(name, repr(v))
    else:
        print(name, type(v).__name__, getattr(v, "__module__", None), getattr(v, "__text_signature__", None))

def describe(t):
    print(t.__module__, t.__qualname__, type(t).__name__, [b.__name__ for b in t.__mro__], t.__flags__ & ((1 << 7) | (1 << 8) | (1 << 10)), repr(t.__doc__)[:60], t.__dictoffset__ != 0, t.__weakrefoffset__ != 0)
    for k, v in t.__dict__.items():
        if k in ("__doc__", "__module__"):
            continue
        print("   ", k, type(v).__name__, getattr(v, "__text_signature__", None), repr(getattr(v, "__doc__", None))[:50])

S = _ctypes._SimpleCData
types_ = [S.__mro__[1], S, _ctypes.Structure, _ctypes.Union, _ctypes.Array, _ctypes._Pointer, _ctypes.CFuncPtr, _ctypes.CField, _ctypes.ArgumentError,
          type(S).__mro__[1], type(S), type(_ctypes.Structure), type(_ctypes.Union), type(_ctypes.Array), type(_ctypes._Pointer), type(_ctypes.CFuncPtr),
          type(ctypes.byref(ctypes.c_int()))]
for t in types_:
    describe(t)
for t in (ctypes.c_int, ctypes.c_char_p, ctypes.c_void_p, ctypes.c_wchar_p, ctypes.py_object, ctypes.c_char * 2, ctypes.c_wchar * 2, ctypes.c_int * 2, ctypes.POINTER(ctypes.c_int), ctypes.CFUNCTYPE(None)):
    print(t.__name__, t.__module__, sorted(k for k in t.__dict__ if k not in ("__firstlineno__", "__static_attributes__")))
    print("   ", [(k, type(t.__dict__[k]).__name__) for k in ("from_param", "raw", "value") if k in t.__dict__])
for t in types_:
    try:
        t.some_attribute = 1
        print(t.__name__, "mutable")
    except TypeError as e:
        print(t.__name__, e)
print(issubclass(_ctypes.ArgumentError, Exception), _ctypes.ArgumentError("x"))
# Where there is no C API there is no pythonapi.
print(sorted(n for n in dir(ctypes) if not n.startswith("__") and n != "pythonapi"))
import ctypes.wintypes, ctypes.util, ctypes._endian, ctypes._layout, ctypes._aix, ctypes.macholib
print(ctypes.sizeof(ctypes.wintypes.DWORD), ctypes.sizeof(ctypes.wintypes.RECT), ctypes.sizeof(ctypes.wintypes.WIN32_FIND_DATAW), ctypes.wintypes.VARIANT_BOOL(True).value, ctypes.wintypes.LPCWSTR.__name__)
