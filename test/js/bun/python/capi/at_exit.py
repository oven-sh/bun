# What reference counts would have freed by the time the program ends is finalized and destroyed before the program is told of the end (atexit). Cyclic garbage is not: that is for
# the collector, which has not been asked. (Here a collection that comes for its own reasons may find it earlier. So this runs in one way only, and collects right before.)
# without_finalizers: nothing of Python's has a finalizer, and what C has made is destroyed all the same.
import atexit, ctypes, gc, sys, weakref
from ctypes import c_long, py_object

lib = ctypes.PyDLL(sys.argv[1])


def declare(name, restype, *argtypes):
    function = getattr(lib, name)
    function.restype = restype
    function.argtypes = argtypes
    return function


make_types = declare("make_types", py_object)
take_events = declare("take_events", py_object)
set_id = declare("set_id", None, py_object, c_long)
set_first = declare("set_first", None, py_object, py_object)
note_aloud = declare("note_aloud", None, c_long)
Node, _, Watched, *_ = make_types()


class Finalized:
    if "without_finalizers" not in sys.argv:

        def __del__(self):
            print("__del__")


def make(id, first):
    node = Node()
    set_id(node, id)
    if first is not None:
        set_first(node, first)
    return node


class Derived(Node):
    def method(self):
        pass


gc.disable()
atexit.register(lambda: print("the program is told of the end:", take_events(), below() is not None, flush=True) or note_aloud(1))
gc.collect()
finalized, plain, in_a_cycle, ring = Finalized(), make(1, []), make(2, None), make(3, None)
set_first(in_a_cycle, [in_a_cycle])
set_first(ring, make(4, ring))
# A cycle that hangs below what reference counts free is a cycle: it is there, with its weak references, when the program is told.
in_a_cycle_below = Derived()
set_id(in_a_cycle_below, 11)
set_first(in_a_cycle_below, make(13, in_a_cycle_below))
below = weakref.ref(in_a_cycle_below)
parent = make(10, in_a_cycle_below)
del finalized, plain, in_a_cycle, ring, in_a_cycle_below, parent

# And afterwards all that goes with the modules. (In which order is another matter: capi.test.ts sorts what follows.)
held_by_a_module = make(5, make(6, [make(7, None)]))
in_a_cycle_and_held = make(8, None)
set_first(in_a_cycle_and_held, [in_a_cycle_and_held])
# Its class leads to it: class -> method -> the globals of this module.
of_a_class_of_this_module = Derived()
set_id(of_a_class_of_this_module, 12)
if "without_finalizers" not in sys.argv:
    with_a_finalizer = Watched()
    set_id(with_a_finalizer, 9)
