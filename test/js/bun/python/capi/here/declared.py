# What is not as in CPython, and is declared in DEFERRED.md: pinned as it is. argv: the library of lifecycle.c.
import ctypes, gc, sys
from ctypes import c_long, py_object

import js

lib = ctypes.PyDLL(sys.argv[1])


def declare(name, restype, *argtypes):
    function = getattr(lib, name)
    function.restype = restype
    function.argtypes = argtypes
    return function


take_events = declare("take_events", py_object)
set_id = declare("set_id", None, py_object, c_long)
set_first = declare("set_first", None, py_object, py_object)
tell = declare("tell", None, py_object)
types = declare("make_types", py_object)()
Node, Chatty = types[0], types[3]
told = []


class Sub(Node):
    pass


def nothing():
    pass


print("== a parent without a finalizer holds a child with one: the finalizer comes before the parent's tp_dealloc (CPython: after it has begun)")
tell_of_children = declare("tell_of_children", None, c_long)
log = []


class WithDel(Node):
    finalized = False

    def __del__(self):
        self.finalized = True
        log.append("__del__")


def family():
    child = WithDel()
    set_id(child, 41)
    parent = Chatty()
    set_id(parent, 40)
    set_first(parent, child)
    # (To a collection of the young what C owns a reference to is held: it may find the parent dead alone, and then all is as in CPython. Now they are old.)
    gc.collect()


tell(told)
tell_of_children(1)
family()
gc.collect()
print(log, take_events(), "handed on, finalized:", told[0].finalized)
tell_of_children(0)
tell(None)
told.clear()
gc.collect()
print("at its real end:", log, take_events())

print("== two instances of a class that only they lead to. A dead parent holds the one, which keeps the class. The other ends as a Node beside it (CPython: as what it is)")
look_at_type = declare("look_at_type", None, c_long)


def family():
    class Short(Node):
        pass

    held, free, parent = Short(), Short(), Node()
    for number, node in enumerate((parent, held, free), 42):
        set_id(node, number)
    set_first(parent, held)
    # (To a collection of the young what C owns a reference to is held, and the class with it. Now they are old.)
    gc.collect()


look_at_type(1)
family()
gc.collect()
look_at_type(0)
events = take_events()
print("Py_TYPE(self) was Node itself in the tp_dealloc of the one that nobody holds:", events[events.index(1000044) - 1] // 1000 % 10 == 1)
print(sorted(event for event in events if event // 1000000 == 1))

print("== a tp_traverse asks about what it holds. Nothing is made in the middle of a collection, so Py_TYPE() is NULL where the type might have to be (CPython: never)")
be_curious_about = declare("be_curious_about", None, c_long)
what_was_heard = declare("what_was_heard", c_long)


class List(list):
    pass


for name, held in (
    ("a str", "a"),
    ("an int", 5),
    ("a list", []),
    ("a tuple of numbers", (1, 2)),
    ("an instance", Sub()),
    ("a class", Sub),
    ("a function", nothing),
    ("a built-in function", len),
    ("an instance of a class that derives from list", List()),
    ("a typed array of JS's", js.Uint8Array(1)),
    ("a tuple with one in it", (js.Uint8Array(1),)),
):
    node = Node()
    set_id(node, 50)
    set_first(node, held)
    be_curious_about(50)
    gc.collect()
    be_curious_about(-1)
    heard = what_was_heard()
    print(f"{name}: Py_TYPE() is NULL: {bool(heard // 1000)}; Py_IS_TYPE(it, that): {heard // 100 % 10}; PyType_IsSubtype(that, that): {heard // 10 % 10}; it is tracked: {heard % 10}, and gc says {int(gc.is_tracked(held))}")
del node, held
gc.collect()
take_events()
