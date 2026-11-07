# For two_realms.mjs. Each realm has an interpreter of its own, and so a module of its own.
import ctypes, gc
from ctypes import c_long, py_object


# In the realm whose interpreter has the API: an instance of a class over a type of C's, which holds another in C's data. What is returned leads to it, and nothing else does.
def make(libraries):
    global lib
    lib = ctypes.PyDLL(f"{libraries}/liblifecycle.so")
    lib.make_types.restype = lib.take_events.restype = py_object
    lib.set_id.argtypes = [py_object, c_long]
    lib.set_first.argtypes = [py_object, py_object]
    lib.get_id.argtypes = [py_object]

    class Sub(lib.make_types()[0]):
        pass

    node, child = Sub(), Sub()
    lib.set_id(node, 7)
    lib.set_id(child, 8)
    lib.set_first(node, child)
    node.name = "whole"
    del child
    return lambda: f"{type(node).__name__} {node.name} {lib.get_id(node)}"


def events():
    return str(lib.take_events())


def collect():
    gc.collect()


# In the other realm: cyclic garbage with a finalizer, which holds what it was given.
said = []


class Holder:
    def __init__(self, look):
        self.look = look
        self.me = self

    def __del__(self):
        said.append(self.look())


def hold(look):
    Holder(look)
    return "held"


def what_was_said():
    return str(said)
