# The positional arguments of a structure go to the fields of its bases first, however many bases there are.
import ctypes, threading


def run():
    class First(ctypes.Structure):
        _fields_ = [('a', ctypes.c_int)]
    c = First
    for i in range(3000):
        c = type(ctypes.Structure)('S', (c,), {})
    class Last(c):
        _fields_ = [('b', ctypes.c_int)]
    x = Last(5, 6)
    print(x.a, x.b)
    try:
        Last(5, 6, 7)
    except TypeError as e:
        print(e)
    try:
        Last(5, a=6)
    except TypeError as e:
        print(e)


threading.stack_size(256 * 1024)
thread = threading.Thread(target=run)
thread.start()
thread.join()
