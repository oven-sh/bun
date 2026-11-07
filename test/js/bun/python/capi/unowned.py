# A type to which C keeps no reference of its own dies with its instances, and with the classes that derive from it. The instances come to their end all the same.
import ctypes, gc, sys, weakref
from ctypes import c_int, py_object

lib = ctypes.PyDLL(sys.argv[1])


def declare(name, restype, *argtypes):
    function = getattr(lib, name)
    function.restype = restype
    function.argtypes = argtypes
    return function


make_type = declare("make_type", py_object)
number_ended = declare("number_ended", c_int)
hold = declare("hold", None, py_object, py_object)
make_plain_type = declare("make_plain_type", py_object)


def alone():
    Holder = make_type()
    Holder()
    return weakref.ref(Holder)


def in_a_cycle():
    Holder = make_type()
    holder = Holder()
    hold(holder, [holder])
    return weakref.ref(Holder)


def of_a_class_that_leads_to_it():
    Holder = make_type()

    class Sub(Holder):
        def method(self):
            return one, other

    one, other = Sub(), Sub()
    hold(one, other)
    return weakref.ref(Holder)


def of_a_class_that_lives():
    global Kept
    Holder = make_type()

    class Kept(Holder):
        pass

    Kept()
    return weakref.ref(Holder)


def of_a_class_over_a_type_that_tells_the_collector_nothing():
    Plain = make_plain_type()

    class Sub(Plain):
        def method(self):
            return one

    one = Sub()
    return weakref.ref(Plain)


for way in (alone, in_a_cycle, of_a_class_that_leads_to_it, of_a_class_that_lives, of_a_class_over_a_type_that_tells_the_collector_nothing):
    before = number_ended()
    ref = way()
    gc.collect()
    print(way.__name__, number_ended() - before, ref() is None)
