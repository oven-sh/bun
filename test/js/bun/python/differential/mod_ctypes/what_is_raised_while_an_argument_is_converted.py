# What is raised while an argument of a foreign function is converted becomes an ArgumentError that names the argument, whatever it is. Not where the stack is at its end: there a
# RecursionError is what comes out, if anything.
import ctypes, sys

labs = ctypes.CDLL(None).labs


def attempt(f):
    try:
        return repr(f())
    except BaseException as e:
        # (How the want of stack is worded differs.)
        return '%s: %s' % (type(e).__name__, str(e).split('RecursionError: ')[0] + ('RecursionError' if 'RecursionError: ' in str(e) else ''))


class Raises:
    def __init__(self, e):
        self.e = e
    @property
    def _as_parameter_(self):
        raise self.e


class Parameter:
    e = None
    @classmethod
    def from_param(cls, value):
        raise cls.e


for e in (RecursionError('r'), MemoryError('m'), KeyboardInterrupt('k'), SystemExit(3), ValueError('v'), TypeError('t'), OverflowError('o'), AttributeError('a'), GeneratorExit('g'),
          StopIteration('s'), ctypes.ArgumentError('x'), BaseException('b')):
    labs.argtypes = None
    print(type(e).__name__, '| _as_parameter_:', attempt(lambda: labs(Raises(e))))
    Parameter.e = e
    labs.argtypes = [Parameter]
    print('    from_param():', attempt(lambda: labs(1)))
    labs.argtypes = [ctypes.c_long]
    print('    _as_parameter_ under c_long:', attempt(lambda: labs(Raises(e))))


class Chain:
    @property
    def _as_parameter_(self):
        return Chain()


class Deep:
    @property
    def _as_parameter_(self):
        def again():
            return again()
        return again()


for argtypes in (None, [ctypes.c_long], [ctypes.c_void_p], [ctypes.c_char_p], [ctypes.POINTER(ctypes.c_int)]):
    labs.argtypes = argtypes
    print(argtypes and argtypes[0].__name__, '| a chain of _as_parameter_:', attempt(lambda: labs(Chain())), '| one that never ends:', attempt(lambda: labs(Deep())))


print('--- at the end of the stack, and in the frames above that until the call goes through')
class S(ctypes.Structure):
    _fields_ = [('a', ctypes.c_int)]


def kinds_of_end(value):
    seen = []
    def down():
        try:
            down()
        except RecursionError:
            pass
        if 'ok' not in seen[-20:]:
            try:
                labs(value)
                seen.append('ok')
            except BaseException as e:
                seen.append(type(e).__name__)
    down()
    return sorted(set(seen) - {'ok', 'RecursionError'}), seen[-1]


limit = sys.getrecursionlimit()
sys.setrecursionlimit(10 ** 7)
for name, argtypes, value in (('an int', None, 5), ('c_long', [ctypes.c_long], 5), ('an instance', [ctypes.c_long], ctypes.c_long(5)), ('py_object', [ctypes.py_object], 5),
                              ('c_void_p', [ctypes.c_void_p], None), ('bytes', [ctypes.c_void_p], b'x'), ('c_char_p', [ctypes.c_char_p], b'x'),
                              ('an array', [ctypes.POINTER(ctypes.c_int)], (ctypes.c_int * 2)()), ('byref()', [ctypes.POINTER(ctypes.c_int)], ctypes.byref(ctypes.c_int())),
                              ('a structure', [S], S())):
    labs.argtypes = argtypes
    print(name, kinds_of_end(value))
sys.setrecursionlimit(limit)
