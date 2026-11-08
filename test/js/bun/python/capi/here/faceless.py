# An instance of the type of an extension is two cells here: a face, which is what Python sees, and a body, which is what C sees. tp_dealloc is called when the face has died and C
# owns no reference to the body. This is about the time between the two, and after. Under CPython there is no such time.
import ctypes, gc, sys, weakref
from ctypes import c_long, py_object

lib = ctypes.PyDLL(sys.argv[1])


def declare(name, restype, *argtypes):
    function = getattr(lib, name)
    function.restype = restype
    function.argtypes = argtypes
    return function


make_types = declare("make_types", py_object)
count_of = declare("count_of", c_long, py_object)
take_events = declare("take_events", py_object)
set_id = declare("set_id", None, py_object, c_long)
set_first = declare("set_first", None, py_object, py_object)
set_second = declare("set_second", None, py_object, py_object)
has_first = declare("has_first", c_long, py_object)
get_first = declare("get_first", py_object, py_object)
remember_borrowed = declare("remember_borrowed", None, py_object)
probe_borrowed = declare("probe_borrowed", None)
recall_borrowed = declare("recall_borrowed", py_object)
append_borrowed = declare("append_borrowed", ctypes.c_int, py_object)
keep_borrowed = declare("keep_borrowed", None)
drop_what_c_kept = declare("drop_what_c_kept", None)
id_if_it_has_data = declare("id_if_it_has_data", c_long, py_object)
id_or_exception = declare("id_or_exception", c_long, py_object)
tell = declare("tell", None, py_object)
tell_of_itself = declare("tell_of_itself", None, c_long)
types = make_types()
Node, Chatty, Prober = types[0], types[3], types[6]


class Sub(Node):
    pass


class Companion:
    pass


def count(objects):
    return sum(isinstance(each, (Node, Companion)) for each in objects)


# Its __del__ is code of the program that runs after the collection which found the instance dead, and before the turn of the instance. The instance holds it, and nothing else does: so
# whichever collection finds the one dead finds the other. (Dropped beside it, a collection that is under way may have marked the one and not the other.) It does not lead to the instance.
class Witness:
    def __init__(self, act):
        self.act = act

    def __del__(self):
        print("before its turn: events so far", take_events())
        self.act()


def look():
    # (Nor what only it holds: reference counts would have freed that, and gc.get_objects() gives nothing of the kind.)
    print("  in gc.get_objects()", count(gc.get_objects()))
    print("  among the referrers of what it holds", count(gc.get_referrers(target)))
    print("  weak references to it and to what it holds", ref(), ref_to_companion() is not None)


def make(number, act, in_a_cycle=False):
    global ref, ref_to_companion, address
    node, companion = Sub(), Companion()
    node.attribute = "of the face"
    node.witness = Witness(act)
    set_id(node, number)
    set_first(node, target)
    set_second(node, companion)
    if in_a_cycle:
        companion.node = node
    ref, ref_to_companion, address = weakref.ref(node), weakref.ref(companion), id(node)
    remember_borrowed(node)
    return node


def attributes(node):
    return {name: value for name, value in vars(node).items() if name != "witness"}


def describe(node):
    return f"{type(node).__name__}, data of {id_if_it_has_data(node)}, the same id(): {id(node) == address}, attributes {attributes(node)}, the old weak reference {ref()}"


def drop(node):
    del node
    gc.collect()


# What is owed is done where the program can be interrupted.
def go_on():
    for _ in range(3):
        pass


def nothing():
    pass


taken = []
target = ["held by the instance and by the program"]

print("== the face has died: nothing of Python's leads to the instance, and what it holds is there")
drop(make(1, look))
print(take_events(), count(gc.get_objects()))

print("== its address is read as an object before its turn: it comes back, with another face")
drop(make(2, lambda: taken.append(ctypes.cast(address, py_object).value)))
print(take_events(), describe(taken[0]))
print(count(gc.get_objects()), count(gc.get_referrers(target)))
taken.clear()
gc.collect()
print(take_events(), count(gc.get_objects()))

print("== C hands it to the program before its turn, by a pointer that it does not own: the same")
drop(make(3, lambda: taken.append(recall_borrowed())))
print(take_events(), describe(taken[0]))
taken.clear()
gc.collect()
print(take_events(), count(gc.get_objects()))

print("== C takes a reference to it before its turn, and tells nobody: it lives on without a face, until C gives the reference back")
drop(make(4, keep_borrowed))
print(take_events(), count(gc.get_objects()))
gc.collect()
print(take_events())
drop_what_c_kept()
go_on()
print("given back, and no collection since:", take_events())

print("== C asks for its data by a pointer that it does not own: before its turn")
drop(make(5, probe_borrowed))
print(take_events())

print("== in the tp_dealloc of its holder")
node, prober = Node(), Prober()
set_id(node, 5)
set_id(prober, 6)
remember_borrowed(node)
set_first(prober, node)
del node, prober
gc.collect()
print(take_events())
remember_borrowed(None)

print("== a tp_dealloc hands the object to the program: a face for the occasion, which leads to nothing")
told = []
tell(told)
tell_of_itself(1)
chatty = Chatty()
set_id(chatty, 7)
del chatty
gc.collect()
tell(None)
tell_of_itself(0)
print(take_events(), type(told[0]).__name__, id_if_it_has_data(told[0]))
try:
    id_or_exception(told[0])
except SystemError as error:
    print("SystemError:", error)



told.clear()
gc.collect()
print(take_events())

print("== and the program gives it another class: it has given back its reference to its type, so no reference moves")


class One(Node):
    __slots__ = ()


class Other(Node):
    __slots__ = ()


def counts():
    return count_of(One), count_of(Other), count_of(Node)


gc.collect()
before = counts()
tell(told)
tell_of_itself(1)
one = One()
set_id(one, 70)
del one
gc.collect()
tell(None)
tell_of_itself(0)
print(take_events(), type(told[0]).__name__, [now - then for now, then in zip(counts(), before)])
told[0].__class__ = Other
print(type(told[0]).__name__, id_if_it_has_data(told[0]), [now - then for now, then in zip(counts(), before)])
told.clear()
gc.collect()
print(take_events(), [now - then for now, then in zip(counts(), before)])

print("== in a cycle through an object of Python's: the face is there, and gc gives it to nobody, as it gives nothing that waits for its end; its weak references die, it is cleared, and a later collection finds the face dead")
drop(make(8, look, True))
print(take_events(), count(gc.get_objects()))

print("== the same, and the program takes what leads to it before its turn: it is cleared in the program's hands, and valid")
drop(make(9, lambda: taken.append(ref_to_companion()), True))
print(take_events(), describe(taken[0].node), "holds something:", bool(has_first(taken[0].node)))
print("   it gets into another cycle, and is cleared again")
set_second(taken[0].node, taken[0])
taken.clear()
gc.collect()
print(take_events(), count(gc.get_objects()))

print("== the same, and C hands it to the program before its turn: it is not cleared")
drop(make(10, lambda: taken.append(recall_borrowed()), True))
print(take_events(), describe(taken[0]), "holds something:", bool(has_first(taken[0])))
taken.clear()
remember_borrowed(None)
gc.collect()
print(take_events(), count(gc.get_objects()))

print("== the same, and C puts it into a list of the program's, and takes no reference itself: it is not cleared")
drop(make(40, lambda: append_borrowed(taken), True))
print(take_events(), describe(taken[0]), "holds something:", bool(has_first(taken[0])))
taken.clear()
remember_borrowed(None)
gc.collect()
print(take_events(), count(gc.get_objects()))

print("== the same, and the program hands it to C before its turn: it is seen to have it, and nothing is cleared")
drop(make(11, lambda: taken.append(ref_to_companion()) or has_first(taken[0].node), True))
print(take_events(), describe(taken[0].node), "holds something:", bool(has_first(taken[0].node)))
taken.clear()
gc.collect()
print(take_events(), count(gc.get_objects()))

print("== the same, and the program asks for its id(), or its hash()")
for number, ask in ((21, id), (22, hash)):
    drop(make(number, lambda: taken.append(ref_to_companion()) or ask(taken[0].node), True))
    print(take_events(), "holds something:", bool(has_first(taken[0].node)))
    taken.clear()
    gc.collect()
    print(take_events(), count(gc.get_objects()))

print("== the same, and C takes a reference to it, and tells nobody")
drop(make(23, keep_borrowed, True))
print(take_events(), count(gc.get_objects()))
drop_what_c_kept()
remember_borrowed(None)
gc.collect()
print(take_events(), count(gc.get_objects()))

print("== a cycle from C to C: the faces have died. C takes another reference to one, and tells nobody: neither is cleared")
one, other = Node(), Node()
set_id(one, 24)
set_id(other, 25)
set_first(one, other)
set_first(other, one)
set_second(one, Witness(keep_borrowed))
remember_borrowed(one)
del one, other
gc.collect()
print(take_events(), count(gc.get_objects()))
drop_what_c_kept()
remember_borrowed(None)
gc.collect()
print(sorted(take_events()), count(gc.get_objects()))

print("== two in a cycle, and C hands one of them to the program before their turn: the other can be reached from it, and is not cleared either")
other = make(12, nothing, True)
one = make(13, lambda: taken.append(recall_borrowed()), True)
set_first(one, [other])
set_first(other, [one])
del one, other
gc.collect()
print(take_events(), describe(taken[0]), "both hold something:", bool(has_first(taken[0])), bool(has_first(get_first(taken[0])[0])))
taken.clear()
remember_borrowed(None)
gc.collect()
print(sorted(take_events()), count(gc.get_objects()))

print("== no cycle, parent -> list -> child -> (C) grandchild, and the program takes the child before the parent's turn: what the child holds is whole")
parent, child, grandchild, companion = Sub(), Sub(), Sub(), Companion()
for number, node in enumerate((parent, child, grandchild), 14):
    set_id(node, number)
grandchild.attribute = "of the face"
ref_to_grandchild, address = weakref.ref(grandchild), id(grandchild)
companion.node = child
ref_to_companion = weakref.ref(companion)
set_first(parent, [companion])
set_first(child, grandchild)
# (Held by the face. What C holds is a root to a collection of the young, which may find the parent dead and not that.)
parent.witness = Witness(lambda: taken.append(ref_to_companion()))
del parent, child, grandchild, companion, node
gc.collect()
grandchild = get_first(taken[0].node)
print(take_events(), vars(grandchild), ref_to_grandchild() is grandchild, id(grandchild) == address)
del grandchild
taken.clear()
gc.collect()
print(take_events(), count(gc.get_objects()))

print("== a tp_clear that lets go of nothing is called once, and gc.collect() comes to an end")
Stubborn = declare("make_stubborn_type", py_object)()
# (C makes it, and nobody else has ever had it: what ctypes makes of an argument may lie about for a while.)
drop_one_that_holds_itself = declare("drop_one_that_holds_itself", c_long, py_object, c_long, c_long)
for through_a_list in (True, False):
    drop_one_that_holds_itself(Stubborn, 30, through_a_list)
    print(*(gc.collect() and None or take_events() for _ in range(3)))
