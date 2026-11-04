# As a package that wraps a library has it: the callbacks are globals of its modules, and the library is given their addresses.
import ctypes

libc = ctypes.CDLL(None)
libc.qsort.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_void_p]
libc.qsort.restype = None


@ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int))
def descending(a, b):
    return b[0] - a[0]


address = ctypes.cast(descending, ctypes.c_void_p).value


def sort(numbers):
    array = (ctypes.c_int * len(numbers))(*numbers)
    libc.qsort(array, len(numbers), ctypes.sizeof(ctypes.c_int), address)
    return list(array)
