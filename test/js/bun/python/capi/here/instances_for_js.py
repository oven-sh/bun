# For weak_in_js.mjs.
import ctypes, gc
from ctypes import c_long, py_object


def load(path):
    global lib, Sub
    lib = ctypes.PyDLL(path)
    for name, restype, *argtypes in (
        ("make_types", py_object),
        ("take_events", py_object),
        ("set_id", None, py_object, c_long),
        ("set_first", None, py_object, py_object),
        ("has_first", c_long, py_object),
        ("get_first", py_object, py_object),
        ("id_if_it_has_data", c_long, py_object),
    ):
        function = getattr(lib, name)
        function.restype, function.argtypes = restype, argtypes
    Sub = type("Sub", (lib.make_types()[0],), {})


# Its __del__ runs after the collection that has found it dead, and before the turn of an instance that was found dead with it. The instance holds it, and nothing else does.
class Witness:
    def __init__(self, act):
        self.act = act

    def __del__(self):
        self.act()


held = []


# C holds a list in the instance, and if it is to be a cycle the list holds the instance.
def make(number, in_a_cycle, act):
    node = Sub()
    node.attribute = "of the face"
    lib.set_id(node, number)
    node.witness = Witness(act)
    lib.set_first(node, [node] if in_a_cycle else [])
    held.append(node)
    return node


def drop_and_collect():
    held.clear()
    gc.collect()


def events():
    return str(lib.take_events())


def attributes(node):
    return {name: value for name, value in vars(node).items() if name != "witness"}


def describe(node):
    return f"{type(node).__name__}, data of {lib.id_if_it_has_data(node)}, attributes {attributes(node)}, holds something: {bool(lib.has_first(node))}"


# It is an object like any other that holds nothing.
def use(node):
    before = gc.get_referents(node)
    lib.set_first(node, ["held anew"])
    return f"it referred to {[each for each in before if isinstance(each, list)]}, and now holds {lib.get_first(node)}, of which the collector knows: {lib.get_first(node) in gc.get_referents(node)}"
