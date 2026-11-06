# A callback whose prototype says that it returns a number is called by its address, with a prototype that says that it returns an object. No reference comes with the number.
# In CPython the caller gives up a reference that nobody gave. argv: the library, what the number is, and whether the API has been set up by then.
# Only _ctypes at first: `import ctypes` calls dlopen(), which sets the API up.
import _ctypes, sys


class c_void_p(_ctypes._SimpleCData):
    _type_ = "P"


class py_object(_ctypes._SimpleCData):
    _type_ = "O"


class ReturnsNumber(_ctypes.CFuncPtr):
    _flags_ = _ctypes.FUNCFLAG_CDECL
    _argtypes_ = ()
    _restype_ = c_void_p


class ReturnsObject(_ctypes.CFuncPtr):
    _flags_ = _ctypes.FUNCFLAG_CDECL
    _argtypes_ = ()
    _restype_ = py_object


x = ["the list"]
number = id(x) if sys.argv[2] == "the id() of a list" else 0x10000
callback = ReturnsNumber(lambda: number)
address = c_void_p.from_address(_ctypes.addressof(callback)).value


def call():
    try:
        return ReturnsObject(address)()
    except BaseException as e:
        return f"{type(e).__name__}: {e}"


if sys.argv[3] == "not set up":
    # Nothing is counted yet, so there is nothing to give back either.
    _ctypes.Py_DECREF(x)
    print(call())
else:
    # C owns a reference to the list, and still does afterwards.
    import ctypes

    count = ctypes.PyDLL(sys.argv[1]).count
    count.argtypes = [ctypes.py_object]
    count.restype = ctypes.c_long
    before = count(x)
    _ctypes.Py_INCREF(x)
    print(count(x) - before, call(), count(x) - before)
