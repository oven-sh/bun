# The __init__ of a metaclass of ctypes raises. The class is there all the same, among the subclasses of its base too: what it still is.
import ctypes, _ctypes


def attempt(f):
    try:
        return repr(f())
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


def failed(base, name, members):
    # What calling the metaclass does, in two steps: so that the class is held on to.
    T = type(base).__new__(type(base), name, (base,), members)
    print(name, attempt(lambda: type(base).__init__(T, name, (base,), members)), T in base.__subclasses__())
    return T


def show(name, T):
    print(name, 'sizeof', attempt(lambda: ctypes.sizeof(T)))
    print(name, 'instance', attempt(lambda: ctypes.sizeof(T())))
    print(name, 'bool', attempt(lambda: bool(T())))
    print(name, 'again', attempt(lambda: type(T).__init__(T, name, T.__bases__, {})))
    if name != 'BadTarget': # CPython: "returned NULL without setting an exception"
        print(name, 'times', attempt(lambda: ctypes.sizeof(T * 3)))


show('NoFlags', failed(_ctypes.CFuncPtr, 'NoFlags', {}))
show('BadArgtypes', failed(_ctypes.CFuncPtr, 'BadArgtypes', dict(_flags_=1, _argtypes_=(int,))))
show('BadRestype', failed(_ctypes.CFuncPtr, 'BadRestype', dict(_flags_=1, _restype_=5)))
show('BadFields', failed(ctypes.Structure, 'BadFields', dict(_fields_=[('a', int)])))
show('BadUnion', failed(ctypes.Union, 'BadUnion', dict(_fields_=5)))
show('BadTarget', failed(_ctypes._Pointer, 'BadTarget', dict(_type_=int)))
show('BadCode', failed(_ctypes._SimpleCData, 'BadCode', dict(_type_='xx')))
show('NoLength', failed(ctypes.Array, 'NoLength', dict(_type_=ctypes.c_int)))
show('NoType', failed(ctypes.Array, 'NoType', dict(_length_=1)))

# A class that is whole: its __init__ does not run twice.
for T in (ctypes.c_int, ctypes.c_int * 3, ctypes.POINTER(ctypes.c_int), ctypes.CFUNCTYPE(None), type('S', (ctypes.Structure,), {})):
    print(attempt(lambda: type(T).__init__(T, T.__name__, T.__bases__, dict(vars(T)))).replace(repr(T), T.__name__))

# The abstract classes, where a pointer type is asked for.
libc = ctypes.CDLL(None)
print(attempt(lambda: ctypes.cast(ctypes.pointer(ctypes.c_int()), _ctypes._Pointer)))
print(attempt(lambda: ctypes.cast(ctypes.pointer(ctypes.c_int()), _ctypes.CFuncPtr)))
print(attempt(lambda: ctypes.cast(ctypes.pointer(ctypes.c_int()), ctypes.Array)))
print(attempt(lambda: ctypes.cast(ctypes.pointer(ctypes.c_int()), ctypes.Structure)))
f = attempt(lambda: ctypes.CFUNCTYPE(None, _ctypes._Pointer)(('abs', libc), ((2,),)))
print(f[:20])
print(attempt(lambda: ctypes.CFUNCTYPE(None, _ctypes._Pointer)(('abs', libc), ((2,),))()))
print(attempt(lambda: ctypes.CFUNCTYPE(None, ctypes.Array)(('abs', libc), ((2,),))()))
print(attempt(lambda: ctypes.CFUNCTYPE(None, ctypes.Structure)(('abs', libc), ((2,),))))
print(attempt(lambda: ctypes.CFUNCTYPE(None, ctypes.c_int * 2)(('abs', libc), ((2,),))()[:]))
print(attempt(lambda: ctypes.CFUNCTYPE(None, ctypes.POINTER(ctypes.c_int))(('abs', libc), ((2,),))()))
