# What is passed or returned by value is gone through, field by field, to see which registers it goes into: structures and unions, one in the other 5,000 times, were more than the stack
# of a thread has room for, and arrays of arrays of a structure without fields are 64 ** 12 items and no byte. A structure
# that contains itself has no end at all. (CPython dies of the first and of the last.)
import ctypes, threading


def attempt(f):
    try:
        return repr(f()).split(' at 0x')[0]
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


def main():
    T = ctypes.c_int
    for i in range(5000):
        T = type('T', ((ctypes.Structure, ctypes.Union)[i % 2],), {'_fields_': [('f', T)]})
    # How much a stack of that size holds is the platform's matter.
    either = ('0', '<__main__.T object', 'RecursionError: maximum recursion depth exceeded')
    print(ctypes.sizeof(T), attempt(lambda: ctypes.CDLL(None).abs(T())) in either)
    function = ctypes.CDLL(None)['abs']
    function.argtypes = [T]
    print(attempt(lambda: function(T())) in either)
    function = ctypes.CDLL(None)['abs']
    function.argtypes, function.restype = [ctypes.c_int], T
    print(attempt(lambda: function(1)) in either)


threading.stack_size(256 * 1024)
thread = threading.Thread(target=main)
thread.start()
thread.join()

class Empty(ctypes.Structure):
    pass
T = Empty
for i in range(12):
    T = T * 64
class Holds(ctypes.Structure):
    _fields_ = [('a', T), ('b', ctypes.c_int)]
print(ctypes.sizeof(T), ctypes.sizeof(Holds), attempt(lambda: ctypes.CDLL(None).abs(Holds(b=-5))))

print('--- a structure that contains itself: it is refused, and has its fields all the same, as in CPython')
for base in (ctypes.Structure, ctypes.Union):
    for fields in (lambda S: [('x', S)], lambda S: [('x', S), ('n', ctypes.c_int)], lambda S: [('n', ctypes.c_int), ('x', S * 2)]):
        class S(base):
            pass
        print(base.__name__, attempt(lambda: setattr(S, '_fields_', fields(S))), ctypes.sizeof(S), attempt(lambda: setattr(S, '_fields_', [('a', ctypes.c_int)])))
        print(attempt(lambda: ctypes.CDLL(None).abs(S())))
        function = ctypes.CDLL(None)['abs']
        function.restype = S
        print(attempt(lambda: function(1)))
        class Derived(S):
            _fields_ = [('m', ctypes.c_int)]
        class Holds(ctypes.Structure):
            _fields_ = [('s', S), ('a', S * 2), ('m', ctypes.c_int)]
        print(ctypes.sizeof(Derived), ctypes.sizeof(Holds), attempt(lambda: ctypes.CDLL(None).abs(Derived())), attempt(lambda: ctypes.CDLL(None).abs(Holds())))
