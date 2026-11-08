# The paramflags of a function are looked at when it is made only if its class has argtypes to hold them against. Then it is given a class that has. (CPython dies.)
import ctypes, _ctypes


def attempt(f):
    try:
        return repr(f())
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


libc = ctypes.CDLL(None)
class Without(_ctypes.CFuncPtr):
    _flags_ = _ctypes.FUNCFLAG_CDECL
class With(_ctypes.CFuncPtr):
    _flags_ = _ctypes.FUNCFLAG_CDECL
    _argtypes_ = (ctypes.c_int,)
    _restype_ = ctypes.c_int
for flags in ((5,), ((),), (('x',),), ((1.5,),), ([1],), ((1,),), ((1, 'n'),), ((1, 5),), ((1, 'n', -7),), ((2,),), ((2 ** 70,),), ((4, 'n', 3),), ((1,), (1,))):
    f = Without(('abs', libc), flags)
    f.__class__ = With
    print(flags, '|', attempt(lambda: f(-3)), '|', attempt(lambda: f()), '|', attempt(lambda: f(n=-4)))
    g = Without(('abs', libc), flags)
    print('   ', attempt(lambda: setattr(g, 'argtypes', (ctypes.c_int,))), '|', attempt(lambda: g(-3)))
