# A tp_traverse that calls what makes objects and runs code, in the middle of a collection. In CPython that is undefined. Here the functions fail.
import ctypes, gc, sys
from ctypes import c_long, py_object

lib = ctypes.PyDLL(sys.argv[1])
lib.make_types.restype = py_object
lib.count_rude_calls.restype = lib.count_rude_calls_refused.restype = c_long
lib.drop_ring.argtypes = [c_long, c_long]
lib.take_events.restype = py_object


# How many of a ring of three, which only C has seen and has let go of, have come to their end, and whether a tp_clear has been called.
def ended_of_a_ring(first_id):
    lib.drop_ring(first_id, 3)
    gc.collect()
    gc.collect()
    kinds = [event // 1000000 for event in lib.take_events()]
    return kinds.count(1), 2 in kinds


Node = lib.make_types()[0]
nodes = [Node() for i in range(10)]
api = ctypes.PyDLL(None)
api.Py_REFCNT.argtypes = [py_object]
before = api.Py_REFCNT(nodes[0])
print(*ended_of_a_ring(100))
lib.be_rude(1)
gc.collect()
junk = [[i] for i in range(100000)]
gc.collect()
print(gc.get_referents(nodes[0]))
lib.be_rude(0)
# Two for each node. (Once: see the end.)
print(lib.count_rude_calls() >= 20, lib.count_rude_calls() == lib.count_rude_calls_refused())
print(len(nodes), type(nodes[0]).__name__, api.Py_REFCNT(nodes[0]) - before)
# One of those calls was Py_INCREF. It was refused, so C has a reference that is not in the books, and what the instances account for says nothing any more: nothing that C owns ends,
# or is cleared.
print(*ended_of_a_ring(200))


# Nor does what C takes and gives back from now on: the entry stays when the count has come to 0. An instance that a collection has found dead waits for its turn. Before that, C takes a reference
# by a pointer that it has kept, and gives it back.
class Witness:
    def __del__(self):
        lib.keep_borrowed()
        lib.drop_what_c_kept()
        print("before its turn", lib.take_events())


class Sub(Node):
    pass


lib.set_id.argtypes = [py_object, c_long]
lib.remember_borrowed.argtypes = [py_object]
lib.set_id.restype = lib.remember_borrowed.restype = lib.keep_borrowed.restype = lib.drop_what_c_kept.restype = None
node = Sub()
node.witness = Witness()
lib.set_id(node, 300)
lib.remember_borrowed(node)
del node
gc.collect()
gc.collect()
print(lib.take_events())
