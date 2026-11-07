# Types that C makes (PyType_FromSpec), what their instances hold, and how they end: tp_traverse, tp_finalize, tp_clear, tp_dealloc.
# Through a library loaded with ctypes.PyDLL. An object dies when a collection finds that nothing refers to it: the script collects before it looks.
import copy, ctypes, gc, pickle, sys, weakref
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
get_id = declare("get_id", c_long, py_object)
set_first = declare("set_first", None, py_object, py_object)
set_second = declare("set_second", None, py_object, py_object)
get_first = declare("get_first", py_object, py_object)
set_held = declare("set_held", None, py_object, py_object)
set_held_carelessly = declare("set_held_carelessly", None, py_object, py_object)
set_on_finalize = declare("set_on_finalize", None, py_object, c_long)
take_kept = declare("take_kept", py_object)
tell = declare("tell", None, py_object)
tell_of_children = declare("tell_of_children", None, c_long)
new_node = declare("new_node", py_object, c_long)
new_node_untracked = declare("new_node_untracked", py_object, c_long)
track = declare("track", None, py_object)
is_tracked = declare("is_tracked", c_long, py_object)
is_finalized = declare("is_finalized", c_long, py_object)
new_chain = declare("new_chain", py_object, c_long, c_long)
drop_ring = declare("drop_ring", c_long, c_long, c_long)
size_of_data = declare("size_of_data", c_long, py_object)
alignment_of_data = declare("alignment_of_data", c_long, py_object, py_object)
distance_of_parts = declare("distance_of_parts", c_long, py_object)
try_width = declare("try_width", c_long, py_object, c_long)
check_width = declare("check_width", c_long, py_object, c_long)
try_memory = declare("try_memory", c_long)

KINDS = {1: "dealloc", 2: "clear", 3: "finalize"}


# What has been finalized and destroyed. Which objects of a cycle are asked to let go (tp_clear), and how many, is the collector's business: CPython asks them one
# after the other until reference counts have done the rest.
def happened(in_order=True):
    global cleared
    gc.collect()
    events = [f"{KINDS[event // 1000000]} {event % 1000000}" for event in take_events()]
    cleared = sum(event.startswith("clear") for event in events)
    events = [event for event in events if not event.startswith("clear")]
    return events if in_order else sorted(events)


def make(cls, id, first=None, second=None):
    object = cls()
    set_id(object, id)
    if first is not None:
        set_first(object, first)
    if second is not None:
        set_second(object, second)
    return object


def churn():
    return [[i, str(i)] for i in range(2000)][-1]


gc.collect()
Node, Wide, Watched, Chatty, Leaf, Bare, Prober, Careless, Guarded = make_types()

print("== the types")
for cls in (Node, Wide, Watched, Chatty, Leaf, Bare):
    print(cls.__name__, cls.__qualname__, cls.__module__, cls.__bases__, cls.__mro__, type(cls), repr(cls))
print(Node.__doc__, Wide.__doc__)
print([name for name in ("__dict__", "__weakref__", "__slots__", "__module__", "__doc__") if name in vars(Node)])
print(issubclass(Wide, Node), issubclass(Node, Wide), isinstance(Wide(), Node), isinstance(Node(), Wide))
for cls in (Node, Wide, Watched, Chatty, Leaf, Bare):
    print(cls.__name__, size_of_data(cls))
for attempt in (lambda: type("Derived", (Leaf,), {}), lambda: type("Derived", (Chatty,), {}), lambda: type("Both", (Wide, Watched), {})):
    try:
        print(attempt())
    except TypeError as error:
        print("TypeError:", error)
print(type("Derived", (Wide,), {}).__mro__)

print("== an instance")
node = make(Node, 1)
print(type(node) is Node, get_id(node), get_first(node), repr(node).startswith("<lifecycle.Node object at 0x"))
for attempt in (lambda: setattr(node, "x", 1), lambda: node.__dict__, lambda: weakref.ref(node), lambda: Node(1), lambda: Node(a=1)):
    try:
        print(attempt())
    except (AttributeError, TypeError) as error:
        print(type(error).__name__ + ":", error)
print(node == node, node != node, hash(node) == hash(node), node in {node}, bool(node))
print(is_tracked(node), is_finalized(node), is_tracked(Leaf()), is_tracked(1), is_tracked([]))
del node
print(happened(False), cleared)

print("== where the data lies")
wide = make(Wide, 2)
print(alignment_of_data(wide, Node), alignment_of_data(wide, Wide), distance_of_parts(wide), alignment_of_data(Bare(), Bare))
print(try_width(wide, 5), get_id(wide), get_first(wide))
many = [make(Wide, 100 + i) for i in range(20)]
print([try_width(each, i) for i, each in enumerate(many)])
churn()
gc.collect()
print(check_width(wide, 5), [check_width(each, i) for i, each in enumerate(many)], [get_id(each) for each in many])
print([alignment_of_data(each, Wide) for each in many])
del wide, many
print(happened(False))
print(try_memory())

print("== what an instance holds lives, and goes with it")


class Thing:
    def __init__(self, name):
        self.name = name


thing = Thing("held")
ref = weakref.ref(thing)
node = make(Node, 3, thing)
del thing
churn()
print(happened(), ref() is not None, get_first(node).name, get_first(node) is ref())
del node
print(happened(), ref())

print("== a chain: each before what it refers to")
chain = make(Node, 10, make(Node, 11, make(Node, 12, make(Node, 13))))
print(happened())
del chain
print(happened())
chain = new_chain(20, 6)
print(happened(), get_id(chain), get_id(get_first(get_first(chain))))
del chain
print(happened())
chain = new_chain(1000, 3000)
del chain
events = happened()
print(len(events), events[:2], events[-2:], events == [f"dealloc {1000 + i}" for i in range(3000)])

print("== a long way from what the program holds")


def way(object):
    ids = []
    while object is not None:
        if isinstance(object, list):
            object = object[0]
        else:
            ids.append(get_id(object))
            object = get_first(object)
    return len(ids), ids[0], ids[-1]


# Of all but the first, only C knows.
chain = new_chain(200000, 5000)
print(happened(), way(chain))
churn()
print(happened(), way(chain))
del chain
events = happened()
print(len(events), events[:2], events[-2:])
# An object of Python between each and the next.
chain = None
for i in range(300):
    chain = make(Node, 210000 + i, [chain])
print(happened(), way(chain))
churn()
print(happened(), way(chain))
del chain
events = happened()
print(len(events), events[:2], events[-2:])

print("== two that share a third")
shared = make(Node, 32)
a, b = make(Node, 30, shared), make(Node, 31, shared)
del shared, a
print(happened())
del b
print(happened())

print("== cycles")
a = make(Node, 40)
set_first(a, a)
del a
print(happened(), cleared > 0)
a, b = make(Node, 41), make(Node, 42)
set_first(a, b)
set_first(b, a)
print(happened(), cleared)
del a, b
print(happened(), cleared > 0)
a, b, c = make(Node, 43), make(Node, 44), make(Node, 45)
set_first(a, b)
set_first(b, c)
set_first(c, a)
del a, b, c
print(happened(), cleared > 0)
print(drop_ring(50, 5), happened(False), cleared > 0)
print(drop_ring(2000, 500), len(happened()), cleared > 0)

print("== objects that hold on to themselves while they let go")
a = make(Guarded, 55, make(Guarded, 56))
del a
print(happened())
a, b, c = make(Guarded, 57), make(Guarded, 58), make(Guarded, 59)
set_first(a, b)
set_first(b, c)
set_first(c, a)
del a, b, c
print(happened(False), cleared > 0)

print("== a cycle through objects of Python")
a = make(Node, 60)
holder = [a, {"a": a}]
set_first(a, holder)
ref = weakref.ref(thing := Thing("in the cycle"))
holder.append(thing)
del a, holder, thing
print(happened(), ref())

print("== a cycle that something hangs off, and one that is held")
a, b = make(Node, 61), make(Node, 62)
set_first(a, b)
set_first(b, a)
set_second(b, make(Node, 63, make(Node, 64)))
del a, b
print(happened(False))
a, b = make(Node, 65), make(Node, 66)
set_first(a, b)
set_first(b, a)
del b
print(happened(), get_id(get_first(a)), get_first(get_first(a)) is a)
del a
print(happened())

print("== what the collector is not told of")
leaf = Leaf()
set_id(leaf, 70)
set_held(leaf, make(Node, 71))
print(happened())
del leaf
print(happened())
# A cycle through such a reference is never found.
leaf = Leaf()
set_id(leaf, 72)
node = make(Node, 73, leaf)
set_held(leaf, node)
del leaf, node
print(happened())

print("== much data, of which the collector is not told either, and a tp_clear that nobody calls")
Big = declare("make_big_type", py_object)()
set_big = declare("set_big", None, py_object, c_long, c_long)
for i in range(3):
    big = Big()
    set_big(big, 75, i)
    print(gc.is_tracked(big), is_tracked(big))
    del big
    print(happened())

print("== what is never given back stays")
refs = []
for i in range(50):
    careless, thing = Careless(), Thing(i)
    thing.more = [Thing(-i), make(Node, 74)]
    set_held_carelessly(careless, thing)
    refs.append(weakref.ref(thing))
del careless, thing
for round in range(3):
    churn()
    print(happened(), [ref().name + ref().more[0].name for ref in refs] == [0] * 50, {get_id(ref().more[1]) for ref in refs})

print("== not tracked: not asked")
a = new_node_untracked(80)
print(is_tracked(a))
set_first(a, a)
del a
print(happened())
a = new_node_untracked(81)
set_first(a, a)
track(a)
print(is_tracked(a))
del a
print(happened())

print("== tp_finalize")
watched = make(Watched, 90)
print(is_finalized(watched))
del watched
print(happened())
a, b = make(Watched, 91), make(Watched, 92)
set_first(a, b)
set_first(b, a)
del a, b
print(happened(False))

print("== a finalizer that keeps the object")
watched = make(Watched, 93, make(Node, 94))
set_on_finalize(watched, 1)
del watched
print(happened())
back = take_kept()
print(type(back).__name__, get_id(back), get_id(get_first(back)), is_finalized(back))
del back
print(happened())

print("== a finalizer that keeps what the object refers to")
watched = make(Watched, 95, make(Node, 96, make(Node, 97)))
set_on_finalize(watched, 2)
del watched
print(happened())
back = take_kept()
print(get_id(back), get_id(get_first(back)))
del back
print(happened())

print("== classes that derive from the types")


class Sub(Node):
    pass


class WithDel(Node):
    log = []

    def __del__(self):
        WithDel.log.append(("__del__", get_id(self), get_first(self) is not None))


class WatchedWithDel(Watched):
    def __del__(self):
        WithDel.log.append(("__del__ in place of tp_finalize", get_id(self)))


class Slotted(Node):
    __slots__ = ("a", "b")


sub = make(Sub, 110, Thing("x"))
sub.attribute = [sub]
print(type(sub).__mro__, sub.__dict__.keys(), get_id(sub), get_first(sub).name, isinstance(sub, Node))
ref = weakref.ref(sub)
print(ref() is sub)
del sub
print(happened(), ref())
slotted = make(Slotted, 111)
slotted.a = 1
print(slotted.a, hasattr(slotted, "b"), hasattr(slotted, "__dict__"))
del slotted
print(happened())
with_del = make(WithDel, 112, make(Node, 113))
del with_del
print(happened(), WithDel.log)
WithDel.log.clear()
with_del = make(WatchedWithDel, 114)
del with_del
print(happened(), WithDel.log)
WithDel.log.clear()

print("== __del__ that brings the object back")
saved = []


class Lazarus(Node):
    def __del__(self):
        saved.append(self)


lazarus = make(Lazarus, 120, make(Node, 121))
ref = weakref.ref(lazarus)
del lazarus
print(happened(), len(saved), get_id(saved[0]), get_id(get_first(saved[0])), ref() is saved[0])
saved.clear()
print(happened(), ref())

print("== __del__ of an object of Python that gets at an instance")


class Owner:
    def __init__(self, node):
        self.node = node

    def __del__(self):
        saved.append(self.node)


owner = Owner(make(Node, 130, make(Node, 131)))
del owner
print(happened(), get_id(saved[0]), get_id(get_first(saved[0])))
saved.clear()
print(happened())

print("== what a finalizer brings back has its weak references, whoever else held it")


class Keeper:
    def __del__(self):
        saved.append(self.kept)


thing = Thing("shared")
keeper, node = Keeper(), make(Node, 126, thing)
keeper.kept = thing
ref = weakref.ref(thing)
del thing, keeper, node
print(happened(), ref() is saved[0], saved[0].name)
saved.clear()
print(happened(), ref())
keeper, sub = Keeper(), make(Sub, 127, make(Sub, 128))
keeper.kept = sub
refs = [weakref.ref(sub), weakref.ref(get_first(sub))]
del keeper, sub
print(happened(), refs[0]() is saved[0], refs[1]() is get_first(saved[0]), get_id(refs[1]()))
saved.clear()
print(happened(), [ref() for ref in refs])

print("== a cycle of an instance and an object with a __del__: the finalizer sees it whole")


class Partner:
    def __del__(self):
        saved.append(("__del__", get_id(self.node), get_first(self.node) is self))


for older_is_instance in (True, False):
    if older_is_instance:
        node, partner = make(Node, 132), Partner()
    else:
        partner, node = Partner(), make(Node, 133)
    partner.node = node
    set_first(node, partner)
    ref = weakref.ref(partner)
    del node, partner
    print(happened(), saved, ref())
    saved.clear()

print("== a cycle in which a tp_finalize keeps its object: nothing of it is touched")
for older_is_watched in (True, False):
    if older_is_watched:
        watched, node = make(Watched, 134), make(Node, 135)
    else:
        node, watched = make(Node, 135), make(Watched, 134)
    set_first(watched, node)
    set_first(node, watched)
    set_second(node, ["still here"])
    set_on_finalize(watched, 1)
    del watched, node
    print(happened(), cleared)
    back = take_kept()
    print(get_id(back), get_id(get_first(back)), get_first(get_first(back)) is back, is_finalized(back), is_finalized(get_first(back)))
    del back
    print(happened(False), cleared > 0)

print("== weak references and their callbacks")
sub = make(Sub, 140)
calls = []
ref = weakref.ref(sub, lambda r: calls.append(("callback", r() is None)))
del sub
print(happened(), ref(), calls)
a, b = make(Sub, 141), make(Sub, 142)
set_first(a, b)
set_first(b, a)
refs = [weakref.ref(a), weakref.ref(b)]
del a, b
print(happened(), [r() for r in refs])

print("== __class__")
sub = make(Sub, 150)


class Other(Node):
    pass


class Plain:
    pass


sub.__class__ = Other
print(type(sub).__name__, get_id(sub))
for cls in (Plain, Node, Wide, type("SubOfWide", (Wide,), {})):
    try:
        sub.__class__ = cls
        print("became", cls.__name__)
    except TypeError as error:
        print("TypeError:", error)
try:
    Plain().__class__ = Sub
except TypeError as error:
    print("TypeError:", error)
del sub
print(happened())

print("== a tp_dealloc that makes objects and tells the program")
heard = []
tell(heard)
chatty = make(Chatty, 160, make(Chatty, 161, make(Node, 162)))
del chatty
print(happened(), heard)
heard.clear()
a, b = make(Chatty, 163), make(Chatty, 164)
set_first(a, b)
set_first(b, a)
del a, b
print(happened(False), sorted(heard))
heard.clear()

print("== a tp_dealloc that hands what the object refers to to the program")
tell_of_children(1)
chatty = make(Chatty, 165, make(Node, 166, make(Node, 167)))
del chatty
print(happened(), [get_id(each) for each in heard], get_id(get_first(heard[0])))
heard.clear()
print(happened())
# (A longer chain is taken in one go here.)
chatty = make(Chatty, 180, make(Node, 181, make(Node, 182, make(Node, 183, make(Node, 184, make(Node, 185, make(Node, 186)))))))
del chatty
print(happened(), [get_id(each) for each in heard], get_id(get_first(heard[0])))
heard.clear()
print(happened())
a, b = make(Chatty, 168), make(Node, 169)
set_first(a, b)
set_first(b, a)
set_second(b, ["still here"])
del a, b
print(happened(), [get_id(each) for each in heard])
heard.clear()
print(happened())
tell_of_children(0)
tell(None)

print("== the walks through the heap")
node = make(Node, 170, [1, 2])
print(any(each is node for each in gc.get_objects()), sorted(map(repr, gc.get_referents(node))), any(each is node for each in gc.get_referrers(get_first(node))))
print(gc.is_tracked(node), gc.is_finalized(node))
del node
print(happened())
print([type(each).__name__ for each in gc.get_objects() if isinstance(each, (Node, Leaf, Bare))])

print("== gc.DEBUG_SAVEALL: what hangs off garbage that is handed to the program")


class Holder:
    pass


for attempt in range(100):
    a, b = Holder(), Holder()
    a.other, b.other, a.node = b, a, make(Node, 190, make(Node, 191))
    gc.set_debug(gc.DEBUG_SAVEALL)
    del a, b
    events = happened()
    node = [each.node for each in gc.garbage if isinstance(each, Holder) and hasattr(each, "node")]
    if node:
        break
    # A collection that nobody asked for has come first and has freed the two: in Bun those save nothing.
    gc.set_debug(0)
    gc.garbage.clear()
    happened()
print(events)
print(len(node), get_id(node[0]), get_id(get_first(node[0])))
gc.set_debug(0)
gc.garbage.clear()
print(happened(), get_id(node[0]))
del node
print(happened())

print("== many, while the program goes on")
for round in range(5):
    keep = []
    for i in range(300):
        a, b = make(Node, 10000 + i), make(Sub, 20000 + i)
        set_first(a, b)
        set_first(b, a)
        set_second(a, [i, a])
        if i % 50 == 0:
            keep.append(a)
        churn() if i % 100 == 0 else None
    del a, b
    events = happened(False)
    print(round, len(events), [get_id(each) for each in keep], [get_id(get_first(each)) for each in keep])
    del keep
    print(len(happened()))

print("== an instance that only C holds, in another instance, keeps what Python knows of it")
parent, child = make(Node, 200), make(Sub, 201)
child.attribute = "kept"
reference, address = weakref.ref(child), id(child)
set_first(parent, child)
del child
print(happened())
churn()
child = get_first(parent)
print(child.attribute, reference() is child, id(child) == address, hash(child) == hash(reference()))
del parent, child
print(happened(), reference())

print("== a tree with its children in lists, without and with the way back")
for with_parents in (False, True):

    def tree(depth, parent=None):
        node = make(Node, 400 + depth)
        if with_parents and parent is not None:
            set_second(node, parent)
        set_first(node, [tree(depth - 1, node) for _ in range(2)] if depth else [])
        return node

    root = tree(8)
    del root
    events = happened(False)
    print(len(events), events[0], events[-1], "some are asked to let go" if with_parents else cleared)

print("== many cycles through lists: one gc.collect()")
for _ in range(3):
    for number in range(5000):
        node = make(Node, 500)
        set_first(node, [node, [number] * 3])
    del node
    print(len(happened()), cleared)

print("== weak references to cyclic garbage die before anything is called, and those that are garbage themselves call nothing")


def told(what):
    return lambda reference: calls.append((what, reference() is None, take_events()))


calls = []
node = make(Sub, 510)
alive = weakref.ref(node, told("of the program"))
set_first(node, [node, weakref.ref(node, told("in the cycle"))])
del node
print(happened(), alive(), calls)
print("   and what reference counts free")
calls = []
node = make(Sub, 511)
alive = weakref.ref(node, told("of the program"))
set_first(node, [weakref.ref(node, told("held by the object"))])
del node
print(happened(), alive(), sorted(calls))

print("== __class__ takes the reference to the type along")
count_of = declare("count_of", c_long, py_object)


class A(Node):
    pass


class B(Node):
    pass


gc.collect()
a0, b0 = count_of(A), count_of(B)
x = A()
print(count_of(A) - a0, count_of(B) - b0)
x.__class__ = B
print(count_of(A) - a0, count_of(B) - b0, type(x).__name__)
del x
happened()
print(count_of(A) - a0, count_of(B) - b0)
gone = weakref.ref(A)
del A
gc.collect()
print(gone() is None)


def attempt(what, function, *args):
    try:
        print(what, function(*args))
    except BaseException as error:
        print(what, type(error).__name__ + ":", error)


print("== a metaclass with a __new__ of its own")
make_with_bases = declare("make_with_bases", py_object, py_object)
make_with_metaclass = declare("make_with_metaclass", py_object, py_object)


class Polite(type):
    def __new__(meta, name, bases, namespace, **keywords):
        print("Polite.__new__", name)
        return super().__new__(meta, name, bases, namespace)


class Rude(type):
    def __new__(meta, name, bases, namespace, **keywords):
        return super().__new__(meta, name, bases, namespace) if name == "OfRude" else 42


class Plain(type):
    pass


class OfPolite(metaclass=Polite):
    def __init_subclass__(cls, **keywords):
        print("__init_subclass__", cls.__name__)


class OfRude(metaclass=Rude):
    pass


class OfPlain(metaclass=Plain):
    pass


attempt("of a base:", make_with_bases, (OfPolite,))
attempt("of a base, which returns 42:", make_with_bases, (OfRude,))
attempt("as an argument:", make_with_metaclass, Polite)
attempt("without one, of a base:", lambda: type(make_with_bases((OfPlain,))).__name__)
attempt("without one, as an argument:", lambda: type(make_with_metaclass(Plain)).__name__)

print("== a metaclass whose mro() calls the class that is being made")


class Early(type):
    def mro(cls):
        try:
            cls()
        except TypeError as error:
            # (Here the message has the short name of a class that C is making.)
            print(f"in mro() of {cls.__name__}: TypeError:", str(error).replace("lifecycle.", ""))
        return super().mro()


class OfEarly(Node, metaclass=Early):
    pass


attempt("of a base:", lambda: is_tracked(make_with_bases((OfEarly,))()))

print("== immutable types")
Immutable = declare("make_immutable", py_object)()
attempt("from a mutable base:", declare("make_immutable_from_mutable", py_object))
print("and nothing of it is left:", [cls.__name__ for cls in Node.__subclasses__() if cls.__name__ == "ImmutableNode"])


class OfImmutable(Immutable):
    __slots__ = ()


attempt("__class__ from it:", setattr, Immutable(), "__class__", OfImmutable)
attempt("__class__ to it:", setattr, OfImmutable(), "__class__", Immutable)

print("== Py_tp_base and Py_tp_bases in one spec")
make_with_both_slots = declare("make_with_both_slots", py_object, py_object, py_object, c_long)
for base_first in (1, 0):
    print([base.__name__ for base in make_with_both_slots(Node, (Wide,), base_first).__bases__])

print("== PyObject_GC_IsTracked(), PyObject_GC_IsFinalized() of whatever object")


class BroughtBack:
    def __del__(self):
        keep.append(self)


keep = []
BroughtBack()
gc.collect()
print(is_tracked([]), is_tracked({}), is_tracked(1), is_tracked("s"), is_tracked((1, 2)), is_tracked(([],)), is_finalized(keep[0]), is_finalized([]))

print(gc.is_tracked(make(Leaf, 210)), is_tracked(make(Leaf, 211)), gc.is_tracked(make(Sub, 212)), is_tracked(make(Sub, 213)))
keep.clear()
happened()

print("== a type that tells the collector of what its instances hold, and has no tp_dealloc")
make_told_type = declare("make_told_type", c_long, c_long)
told_type_of = declare("told_type_of", py_object, c_long)
new_told = declare("new_told", py_object, c_long, py_object)


class Loud:
    def __del__(self):
        print("what only the type refers to is finalized")


for with_clear in (0, 1):
    make_told_type(with_clear)
    reference = weakref.ref(told_type_of(with_clear))
    reference().attribute = Loud()
    target = ["target"]
    one = new_told(with_clear, target)
    print(any(each is one for each in gc.get_referrers(target)), any(each is target for each in gc.get_referents(one)))
    del one
    gc.collect()
    gc.collect()
    # C holds the type, and an instance named it. It has been alive all the time, and so has what it refers to.
    print(reference() is not None, reference().__name__, type(reference().attribute).__name__)
    del reference().attribute
    gc.collect()

print("== a constructor that gives up and frees the memory itself")
constructors_that_give_up = declare("constructors_that_give_up", c_long, c_long, c_long)
print(constructors_that_give_up(1000, 1), happened())
# C has the only reference to that type.
print(constructors_that_give_up(1000, 0), happened(), constructors_that_give_up(1, 0))

print("== a tp_traverse that leaves the rest to that of its base")
Delegating = declare("make_delegating_type", py_object)()
set_third = declare("set_third", None, py_object, py_object)
a, b, c = (make(Delegating, 214 + i) for i in range(3))
set_first(a, b)
set_third(b, c)
set_second(c, [a])
del a, b, c
print(happened(False), cleared > 0)

print("== only C makes instances")
Closed = declare("make_closed_type", py_object)()


class OfClosed(Closed):
    pass


class OfClosedWithNew(Closed):
    def __new__(cls):
        return super().__new__(cls)


for cls in (Closed, OfClosed, OfClosedWithNew):
    attempt(f"{cls.__name__}()", cls)
    attempt(f"object.__new__({cls.__name__})", object.__new__, cls)

print("== no copy is made of what C keeps")


class WithAttribute(Node):
    pass


with_attribute = make(WithAttribute, 217)
with_attribute.attribute = [1]
for name, object in (("a Node", make(Node, 218)), ("of a class that derives", with_attribute), ("a Leaf", Leaf()), ("a Bare", Bare())):
    attempt(f"copy.copy({name}):", lambda: type(copy.copy(object)).__name__)
    attempt(f"copy.deepcopy({name}):", lambda: type(copy.deepcopy(object)).__name__)
    for protocol in (0, 2, 5):
        attempt(f"__reduce_ex__({protocol}) of {name}:", lambda: object.__reduce_ex__(protocol)[0].__name__)
    attempt(f"__getstate__() of {name}:", object.__getstate__)
del with_attribute, object
print(happened(False))

print("== what a type says of its instances")
print(Node.__basicsize__ - object.__basicsize__, Wide.__basicsize__ - Node.__basicsize__, WithAttribute.__basicsize__ - Node.__basicsize__, Node.__itemsize__)
print(Node().__sizeof__() == Node.__basicsize__, Wide().__sizeof__() == Wide.__basicsize__, sys.getsizeof(Wide()) > 40000)
for cls in (Node, Wide, Leaf, Bare, WithAttribute, Closed):
    print(cls.__name__, "a heap type, a base type, collected, immutable, not to be instantiated:", [bool(cls.__flags__ & 1 << bit) for bit in (9, 10, 14, 8, 7)])


class OfBig(Node):
    __slots__ = ()


attempt("__class__ from what the collector is told of to what it is not:", setattr, Node(), "__class__", Leaf)
attempt("and the other way round:", setattr, Leaf(), "__class__", OfBig)
happened()

print("== what a dead parent holds is whole in the parent's tp_dealloc, which still owns it")
call_at_dealloc = declare("call_at_dealloc", None, ctypes.c_void_p)
seen = []


@ctypes.CFUNCTYPE(None, c_long)
def at_dealloc(id):
    if id == 220:
        child = ref()
        seen.append(f"in the tp_dealloc of the parent: {type(child).__name__} {getattr(child, 'name', None)}")


def family():
    global ref
    child = make(WithAttribute, 221, make(WithAttribute, 222))
    child.name = "the child"
    ref = weakref.ref(child, lambda _: seen.append("the callback of the weak reference to the child"))
    make(Node, 220, child)


call_at_dealloc(ctypes.cast(at_dealloc, ctypes.c_void_p))
family()
print(happened(), seen)

print("== also if it is in a cycle of its own: reference counts free the parent, and the collector comes later")
seen.clear()


def family():
    global ref
    child = make(WithAttribute, 221, make(WithAttribute, 222))
    child.name = "the child"
    child.me = child
    ref = weakref.ref(child, lambda _: seen.append("the callback of the weak reference to the child"))
    make(Node, 220, child)


family()
# (Whether the child is cleared first, and so what it holds goes before it, is the collector's business.)
print(happened(False), seen)
call_at_dealloc(None)

print("== and if the tp_dealloc hands it on, it lives on as it was")
tell(heard := [])
tell_of_children(1)
seen.clear()


def family():
    global ref
    child = make(WithAttribute, 224, make(WithAttribute, 225))
    child.name = "the child"
    ref = weakref.ref(child, lambda _: seen.append("the callback of the weak reference to the child"))
    make(Chatty, 223, child)


family()
print(happened(), type(heard[0]).__name__, heard[0].name, ref() is heard[0], seen)
tell_of_children(0)
tell(None)
heard.clear()
print(happened(), seen)

print("== what it leads to, an instance of a class that would have died with it, is of that class, for C too")
type_by_c = declare("type_by_c", py_object, py_object)
tell(heard)
tell_of_children(1)


def family():
    class Other(Node):
        pass

    child = make(WithAttribute, 227)
    child.other = make(Other, 228)
    make(Chatty, 226, child)


family()
print(happened())
other = heard[0].other
print(type(other).__name__, type_by_c(other) is type(other))
tell_of_children(0)
tell(None)
del other
heard.clear()
# (CPython: the attributes go before the data.)
print(happened(False))

print("== a class that dies with its instance, and leads to it")


def by_an_attribute_of_the_class(id):
    class Local(Node):
        pass

    Local.instance = make(Local, id)


def by_a_method_that_closes_over_it(id):
    class Local(Node):
        def method(self):
            return one

    one = make(Local, id)


def by_the_globals_of_a_method(id):
    exec(f"class Local(Node):\n    def method(self): pass\none = make(Local, {id})", {"Node": Node, "make": make})


def by_a_class_between(id):
    class Between(Node):
        pass

    class Local(Between):
        pass

    Between.instance = make(Local, id)


# What the tp_dealloc is told by the type of its object: Py_IS_TYPE(self, Py_TYPE(self)), it is a subtype of C's own, and it has a tp_free. And the books of C's own type are as they were.
look_at_type = declare("look_at_type", None, c_long)
look_at_type(1)
gc.collect()
n0 = count_of(Node)
for number, way in enumerate((by_an_attribute_of_the_class, by_a_method_that_closes_over_it, by_the_globals_of_a_method, by_a_class_between)):
    way(190 + number)
    gc.collect()
    print(way.__name__, [(event // 1000000, event % 1000) for event in take_events() if event // 1000000 != 2], count_of(Node) - n0)

print("== the same, below a parent: the child waits for the parent, and meanwhile another of its classes goes")


class Witness:
    def __del__(self):
        global Outer
        print("before the parent's end", [event for event in take_events() if event // 1000000 != 2])
        del Outer


class Parent(Node):
    pass


class Outer(Node):
    pass


def below_a_parent(id):
    class Local(Outer):
        def method(self):
            return child

    child = make(Local, id + 1)
    parent = make(Parent, id, [child])
    parent.witness = Witness()


outer = weakref.ref(Outer)
below_a_parent(200)
gc.collect()
print([(event // 1000000, event % 1000) for event in take_events() if event // 1000000 != 2], outer() is None)
look_at_type(0)
del Parent
gc.collect()
print(count_of(Node) - n0)

print("== at the end")
left = make(Watched, 180, make(Node, 181))
