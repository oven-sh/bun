# A tp_finalize that returns with an exception set. Nobody is there to catch it. (CPython goes on with the exception set, and trips over it later.)
import ctypes, gc, sys
from ctypes import c_long, py_object

lib = ctypes.PyDLL(sys.argv[1])
lib.make_types.restype = py_object
lib.set_on_finalize.argtypes = [py_object, c_long]
lib.take_events.restype = py_object
Watched = lib.make_types()[2]


def hook(unraisable):
    print("unraisable:", unraisable.exc_type.__name__, unraisable.exc_value, "|", unraisable.err_msg, "|", unraisable.object)


sys.unraisablehook = hook
watched = Watched()
lib.set_on_finalize(watched, 3)
del watched
try:
    gc.collect()
    print("nothing is raised where the collection was asked for")
finally:
    print(lib.take_events())

# The same for a tp_dealloc. When the program hears of it, the object has been destroyed: C is not given its data, by whatever pointer.
lib.set_id.argtypes = [py_object, c_long]
lib.remember_borrowed.argtypes = [py_object]
Chatty = lib.make_types()[3]


def hook(unraisable):
    print("unraisable:", unraisable.exc_type.__name__, unraisable.exc_value, "|", unraisable.err_msg, "|", unraisable.object, "| data of", lib.id_of_borrowed_if_it_has_data())


sys.unraisablehook = hook
chatty = Chatty()
lib.set_id(chatty, 7)
lib.remember_borrowed(chatty)
lib.raise_at_its_end(1)
del chatty
gc.collect()
print(lib.take_events())
