# The first things of a process: nothing has called a function of a PyDLL yet.
import ctypes, gc, sys, weakref
from ctypes import CFUNCTYPE, PYFUNCTYPE, c_int, c_long, py_object


def attempt(function, *args):
    try:
        return function(*args)
    except BaseException as e:
        return f"{type(e).__name__}: {e}"


print(ctypes.CDLL(None).Py_IsInitialized())

print("--- a call that does not get as far as C fails as it does anywhere")
print(attempt(ctypes.PyDLL(None).abs, *range(2000)))
print(attempt(ctypes.PyDLL(None).abs, object()))

print("--- what a callback returns is C's, whoever called C and however")
lib = ctypes.CDLL(sys.argv[1])
MAKES = CFUNCTYPE(py_object)
lib.keep_result_of.argtypes = lib.result_of.argtypes = [MAKES]
lib.keep_result_of.restype = None
lib.result_of.restype = py_object


class List(list):
    pass


refs = []


def make():
    made = List([1, 2, 3])
    refs.append(weakref.ref(made))
    return made


callback = MAKES(make)
lib.keep_result_of(callback)
for i in range(3):
    gc.collect()
junk = [List([i]) for i in range(10000)]
print(refs[0]() is not None)
with_gil = ctypes.PyDLL(sys.argv[1])
with_gil.size_of_kept.restype = with_gil.count.restype = c_long
with_gil.give_kept.restype = py_object
with_gil.count.argtypes = [py_object]
print(with_gil.size_of_kept())
print(with_gil.give_kept())
gc.collect()
print(refs[0]())

print("--- and is the caller's when C hands it on")
thing = List()
base = with_gil.count(thing)
same = MAKES(lambda: thing)
for i in range(3):
    print(lib.result_of(same) is thing, same() is thing, with_gil.count(thing) - base)
