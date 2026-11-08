# The __init__ of a metaclass of ctypes raises. The class is there all the same: Array.__subclasses__() has it until it is collected, or __new__() was called for it. It knows nothing
# of itself that could be gone by, so it is an abstract class. (CPython dies in most of these.)
import ctypes, _ctypes


def attempt(f):
    try:
        return repr(f())
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


def failed(name, members):
    # What calling the metaclass does, in two steps: so that the class is held on to.
    T = type(ctypes.Array).__new__(type(ctypes.Array), name, (ctypes.Array,), members)
    print(name, attempt(lambda: type(ctypes.Array).__init__(T, name, (ctypes.Array,), members)))
    return T


libc = ctypes.CDLL(None)
for name, members in (('NoInfo', dict(_length_=1, _type_=int)), ('TooLarge', dict(_length_=2 ** 62, _type_=ctypes.c_int))):
    T = failed(name, members)
    print(name, 'sizeof', attempt(lambda: ctypes.sizeof(T)))
    print(name, 'instance', attempt(lambda: T()))
    print(name, 'from_address', attempt(lambda: T.from_address(ctypes.addressof(ctypes.c_long()))))
    print(name, 'from_buffer', attempt(lambda: T.from_buffer(bytearray(64))))
    print(name, 'from_buffer_copy', attempt(lambda: T.from_buffer_copy(bytes(64))))
    print(name, 'from_param', attempt(lambda: T.from_param(5)))
    print(name, 'times', attempt(lambda: (T * 2).__name__))
    print(name, 'pointer', attempt(lambda: ctypes.POINTER(T).__name__))
    print(name, 'field', attempt(lambda: type('S', (ctypes.Structure,), dict(_fields_=[('a', T)]))))
    print(name, 'argtype', attempt(lambda: ctypes.CFUNCTYPE(None, T)(lambda a: None)))
    print(name, 'restype', attempt(lambda: ctypes.CFUNCTYPE(T)(('abs', libc))()))
    print(name, 'derived', attempt(lambda: type(ctypes.Array)('D', (T,), {})))
    print(name, 'again', attempt(lambda: type(ctypes.Array).__init__(T, name, (ctypes.Array,), {})))
    print(name, 'buffer_info', attempt(lambda: _ctypes.buffer_info(T)))
    print(name, 'alignment', attempt(lambda: ctypes.alignment(T)))

# Made by type.__new__(), for a metaclass derived from two: the from_param() of the other one.
class Two(type(ctypes.Array), type(ctypes.c_int)):
    pass
T = type.__new__(Two, 'T', (ctypes.Array,), dict(_length_=1, _type_=int))
print(attempt(lambda: type(ctypes.Array).__init__(T, 'T', (ctypes.Array,), {})))
print(attempt(lambda: type(ctypes.c_int).from_param(T, 5)))
print(attempt(lambda: T()))

# While the __init__ runs: what it asks of the class may look at the class.
seen = []
class Meta(type(ctypes.Array)):
    def __getattribute__(cls, name):
        if name == '_type_':
            seen.append(attempt(lambda: ctypes.sizeof(cls)))
        return super().__getattribute__(name)
A = Meta('A', (ctypes.Array,), dict(_length_=3, _type_=ctypes.c_short))
print(seen, ctypes.sizeof(A), len(A()))

# A shape that takes a long int to write.
print(ctypes.POINTER(ctypes.c_char * 2 ** 62).__name__, _ctypes.buffer_info(ctypes.POINTER(ctypes.c_char * 2 ** 62)))
