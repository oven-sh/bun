# How many items a slice of a pointer has is (stop - start + 1) / step + 1 for a step below zero. With the largest index for a start that is the smallest number
# there is, divided by -1. (CPython dies of that division.)
import ctypes


def attempt(f):
    try:
        return repr(f())
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


most = 2 ** 63 - 1
for kind in (ctypes.c_int, ctypes.c_char, ctypes.c_wchar):
    pointer = ctypes.pointer(kind())
    for where in (slice(most, -2, -1), slice(most, -most - 1, -1), slice(-most - 1, most, 1), slice(-most - 1, most, most), slice(most, -most - 1, -most), slice(most, -most - 1, -most - 1), slice(0, most, 1), slice(-2, most, 1)):
        print(kind.__name__, where, attempt(lambda: pointer[where]))
