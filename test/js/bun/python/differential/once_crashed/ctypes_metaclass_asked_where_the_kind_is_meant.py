# A metaclass derived from two of the metaclasses of ctypes is an instance of both, but only one __init__ has run: what a class is, is what that wrote.
# (CPython dies in these, or writes where it should not.)
import ctypes, _ctypes, gc


def attempt(f):
    try:
        return repr(f())
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


class StructAndPointer(type(ctypes.Structure), type(_ctypes._Pointer)):
    pass


# A structure of one byte is no pointer: None is not eight bytes of zero for it.
class Byte(ctypes.Structure, metaclass=StructAndPointer):
    _fields_ = [('a', ctypes.c_char)]
arrays = [(Byte * 16)() for i in range(200)]
for array in arrays:
    ctypes.memset(array, 1, 16)
print(ctypes.sizeof(Byte), attempt(lambda: ctypes.pointer(arrays[0][15]).__setitem__(0, None)))
print(attempt(lambda: arrays[0].__setitem__(15, None)))
class Holder(ctypes.Structure):
    _fields_ = [('x', ctypes.c_char), ('b', Byte)]
print(attempt(lambda: setattr(Holder(), 'b', None)))
# Nor is an array stored into it as its address.
print(attempt(lambda: ctypes.pointer(arrays[0][15]).__setitem__(0, (ctypes.c_char * 3)())))
gc.collect()
print({bytes(array) for array in arrays})

# A real pointer takes both.
P = ctypes.POINTER(ctypes.c_char)
pointers = (P * 2)()
pointers[0] = (ctypes.c_char * 3)(b'a', b'b', b'c')
print(pointers[0][1], bool(pointers[1]))
pointers[0] = None
print(bool(pointers[0]))

# An 'out' parameter: an instance is made of what the pointer points to.
libc = ctypes.CDLL(None)
class Incomplete(_ctypes._Pointer):
    pass
print(attempt(lambda: ctypes.CFUNCTYPE(None, Incomplete)(('abs', libc), ((2,),))()))
class Empty(ctypes.Structure, metaclass=StructAndPointer):
    _fields_ = []
print(attempt(lambda: ctypes.CFUNCTYPE(None, Empty)(('abs', libc), ((2,),))()))
Empty.set_type(ctypes.c_int)
print(attempt(lambda: ctypes.CFUNCTYPE(None, Empty)(('abs', libc), ((2,),))()))
class StructAndArray(type(ctypes.Structure), type(ctypes.Array)):
    pass
class NoArray(ctypes.Structure, metaclass=StructAndArray):
    _fields_ = [('a', ctypes.c_int)]
print(attempt(lambda: ctypes.CFUNCTYPE(None, NoArray)(('abs', libc), ((2,),))()))
