# What the scripts beside this one have two interpreters of one process do. `libraries` is the directory with what the C sources were compiled to.
# They return strs: that is what JS is to print.
import _ctypes, ctypes, gc, weakref
from ctypes import CFUNCTYPE, PYFUNCTYPE, c_char_p, c_int, c_long, c_void_p, cast, py_object


def attempt(function, *args):
    try:
        return function(*args)
    except BaseException as e:
        return f"{type(e).__name__}: {e}"


class Thing:
    pass


# True, or why not.
def has_the_api(libraries):
    lib = ctypes.PyDLL(f"{libraries}/libownership.so")
    lib.count.argtypes = [py_object]
    lib.count.restype = c_long
    answer = attempt(lib.count, [1, 2])
    return str(answer > 1) if isinstance(answer, int) else answer


# Whether what C owns is held, and whether it dies when C has given it back. Only with the API.
def is_held_until_given_back(libraries):
    lib = ctypes.PyDLL(f"{libraries}/libwithout_gil.so")
    lib.take_here.argtypes = lib.give_back_here.argtypes = [py_object, c_long]
    lib.take_here.restype = lib.give_back_here.restype = None
    thing = Thing()
    ref = weakref.ref(thing)
    lib.take_here(thing, 1000)
    del thing
    gc.collect()
    held = ref() is not None
    lib.give_back_here(ref(), 1000)
    gc.collect()
    return str((held, ref() is None))


# All that ctypes can do with objects short of calling C with the GIL.
def all_but_a_call(libraries):
    return str([
        _ctypes.Py_INCREF([1]),
        _ctypes.Py_INCREF(1),
        _ctypes.Py_DECREF([1]),
        _ctypes.Py_DECREF(int),
        py_object(int).value,
        list((py_object * 2)(1, float)),
        CFUNCTYPE(py_object)(lambda: str)(),
        CFUNCTYPE(c_int, py_object)(lambda t: 1)(dict),
        PYFUNCTYPE(py_object, py_object)(lambda x: [x])("s"),
        PYFUNCTYPE(c_int, c_int)(lambda x: x + 1)(3),
        ctypes.string_at(b"abc", 2),
        attempt(PYFUNCTYPE(c_int)()),
        attempt(ctypes.PyDLL(None).abs, *range(2000)),
        attempt(ctypes.PyDLL(None).abs, object()),
        ctypes.CDLL(None).Py_IsInitialized(),
        # Its constructor reads PyExc_ValueError, takes a reference to it and calls a dozen functions.
        type(ctypes.CDLL(f"{libraries}/libloaded.so")).__name__,
        type(ctypes.PyDLL(f"{libraries}/libloaded.so")).__name__,
    ])


# C that this interpreter calls without the GIL counts, and asks.
def count_and_ask_by_cdll(libraries):
    lib = ctypes.CDLL(f"{libraries}/libwithout_gil.so")
    lib.take_here.argtypes = lib.give_back_here.argtypes = [py_object, c_long]
    lib.take_here.restype = lib.give_back_here.restype = None
    lib.ask_here.argtypes = [py_object]
    lib.ask_here.restype = c_char_p
    thing = Thing()
    lib.take_here(thing, 3)
    lib.give_back_here(thing, 1)
    return lib.ask_here([1, 2, 3]).decode()


types = [object, bool, bytes, dict, float, int, list, str, tuple, type]


def identities():
    return str([id(t) for t in types])


# null is None, as undefined is, and C knows one None.
def is_written_as_none(value):
    return str(c_void_p.from_buffer(py_object(value)).value == id(None) and (py_object * 1)(value)[0] is None)


def identities_agree():
    return str((
        all(c_void_p.from_buffer(py_object(t)).value == id(t) for t in types),
        all(cast(id(t), py_object).value is t for t in types),
        all(_ctypes.PyObj_FromPtr(id(t)) is t for t in types),
    ))
