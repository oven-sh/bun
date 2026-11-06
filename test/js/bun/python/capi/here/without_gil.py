# What a thread without the GIL does to a count: nothing. In CPython it spoils a count now and then. argv: the library, and what to try.
import ctypes, gc, sys, weakref

lib = ctypes.PyDLL(sys.argv[1])
lib.change_in_another_thread.argtypes = [ctypes.py_object, ctypes.c_int]
lib.change_in_another_thread.restype = ctypes.c_long
lib.take_here.argtypes = lib.give_back_here.argtypes = [ctypes.py_object, ctypes.c_long]
lib.take_here.restype = lib.give_back_here.restype = None


class Thing:
    pass


def is_held_until_given_back():
    thing = Thing()
    ref = weakref.ref(thing)
    lib.take_here(thing, 1000)
    del thing
    gc.collect()
    held = ref() is not None
    lib.give_back_here(ref(), 1000)
    gc.collect()
    return held, ref() is None


if sys.argv[2] == "asks":
    lib.ask_in_another_thread.argtypes = [ctypes.py_object]
    lib.ask_in_another_thread.restype = ctypes.c_char_p
    for i in range(2):
        print(lib.ask_in_another_thread([1, 2, 3]).decode())
    sys.exit()

print(is_held_until_given_back())
thing = Thing()
ref = weakref.ref(thing)
lib.take_here(thing, 1000)
if sys.argv[2].startswith("gives back"):
    # It is not given back: the count is as it was, and other counts go on as before.
    if sys.argv[2] == "gives back":
        print(lib.change_in_another_thread(thing, 1))
    else:
        # By what is destroyed with the thread, down to the last of it.
        print(lib.change_in_another_thread(thing, 2), lib.rounds_at_the_end())
    lib.give_back_here(thing, 999)
    del thing
    gc.collect()
    print(ref() is not None)
    lib.give_back_here(ref(), 1)
    gc.collect()
    print(ref())
    print(is_held_until_given_back())
else:
    # It is not taken, and nobody can tell which Py_DECREF will give it back. From then on no count falls.
    print(lib.change_in_another_thread(thing, 0))
    lib.give_back_here(thing, 1000)
    del thing
    gc.collect()
    print(ref() is not None)
    print(is_held_until_given_back())
