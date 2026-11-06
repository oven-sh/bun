# What a thread without the GIL does to a count: nothing. In CPython it spoils a count now and then. argv: the library, and what to try.
import ctypes, gc, os, sys, weakref

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
    elif sys.argv[2].startswith("gives back to "):
        # To a function that takes it over.
        print(lib.change_in_another_thread(thing, 3 + ["the indicator", "a tuple", "a list"].index(sys.argv[2][14:])))
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
    # It is not taken, and nobody can tell which Py_DECREF will give it back. From then on nothing is let go of.
    print(lib.change_in_another_thread(thing, 0))
    lib.give_back_here(thing, 1000)
    del thing
    gc.collect()
    print(ref() is not None)
    print(is_held_until_given_back())
    # The counts fall as ever: they are asked about.
    own = ctypes.PyDLL(os.path.join(os.path.dirname(sys.argv[1]), "libownership.so"))
    own.count.argtypes = [ctypes.py_object]
    own.count.restype = ctypes.c_long
    thing = Thing()
    counts = [own.count(thing)]
    lib.take_here(thing, 3)
    counts.append(own.count(thing))
    lib.give_back_here(thing, 3)
    counts.append(own.count(thing))
    lib.give_back_here(thing, 1)
    counts.append(own.count(thing))
    print([count - counts[0] for count in counts])
    own.fill_tuples_that_a_list_has_taken_over.argtypes = [ctypes.c_long]
    own.fill_tuple_that_was_appended.argtypes = [ctypes.py_object, ctypes.c_int]
    own.fill_tuples_that_a_list_has_taken_over.restype = own.fill_tuple_that_was_appended.restype = ctypes.py_object
    print(own.fill_tuples_that_a_list_has_taken_over(2), own.fill_tuple_that_was_appended(7, True))
