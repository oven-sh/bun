# A tp_dealloc gives back the last references to instances that another thread has made, and so do theirs: a tree of 15. The tp_dealloc of the last that has children runs code of the program's, which lets
# the other thread collect, three times. By then more wait for their turn than the list of a turn holds in itself. They are still there when their turns come, and each comes once, in the thread that has begun.
import ctypes, gc, os, sys, threading
from ctypes import c_long, c_void_p, py_object

lib = ctypes.PyDLL(sys.argv[1])


def declare(name, restype, *argtypes):
    function = getattr(lib, name)
    function.restype = restype
    function.argtypes = argtypes
    return function


Node = declare("make_types", py_object)()[0]
take_events = declare("take_events", py_object)
set_id = declare("set_id", None, py_object, c_long)
call_at_dealloc = declare("call_at_dealloc", None, c_void_p)
make_member = declare("make_member", None, c_long)
make_family = declare("make_family", None)
drop_family = declare("drop_family", None)

ended_by = []
has_made, is_in_dealloc, has_collected = threading.Event(), threading.Event(), threading.Event()


# Nothing here waits for ever.
def give_up(what):
    print("IT HAS NOT HAPPENED:", what, flush=True)
    os._exit(1)


def wait_for(event, what):
    if not event.wait(300):
        give_up(what)


def wait_for_end_of(thread):
    thread.join(300)
    if thread.is_alive():
        give_up("the other thread has ended")


def make(id):
    node = Node()
    set_id(node, id)
    return node


def other():
    for id in range(1, 15):
        make_member(id)
    has_made.set()
    wait_for(is_in_dealloc, "a tp_dealloc has begun")
    for _ in range(3):
        gc.collect()
        # What has been freed is written over.
        [make(99) for _ in range(100)]
    has_collected.set()


@ctypes.CFUNCTYPE(None, c_long)
def at_dealloc(id):
    if id < 15:
        ended_by.append((id, threading.current_thread().name))
    if id == 6:
        is_in_dealloc.set()
        wait_for(has_collected, "the other thread has collected")


thread = threading.Thread(target=other, name="the other")
thread.start()
wait_for(has_made, "the other thread has made its share")
make_member(0)
make_family()
# A collection of the young takes whatever C owns a reference to for held: it would find the first dead alone. Now they are old, and a full one finds them dead together.
gc.collect()
call_at_dealloc(ctypes.cast(at_dealloc, c_void_p))
# No gc.collect() is under way when they go: the other thread's would do nothing.
drop_family()
wait_for_end_of(thread)
gc.collect()
call_at_dealloc(None)
# (CPython goes down before it goes across.)
print(sorted(ended_by))
order = [id for id, _ in ended_by]
print("each after its parent:", all(order.index((id - 1) // 2) < order.index(id) for id in range(1, 15)))
print(sorted(event for event in take_events() if event % 1000000 < 15))

# A collection that nobody has asked for finds a ring that C has made and dropped. The thread that made it begins the tp_clear of one node, which runs code of the program's; that lets the other thread call
# gc.collect(), three times, which collects, and makes the calls that any thread owes.
#  - A ring of two: the tp_clear of the second, which gives back a reference to the first. The first is not destroyed under its own tp_clear.
#  - A ring of one: it is still what it was, a node that holds itself. It is not found dead once more, and cleared a second time beside the first.
count_events = declare("count_events", ctypes.c_int)
drop_ring = declare("drop_ring", c_long, c_long, c_long)
call_at_clear = declare("call_at_clear", None, c_void_p)
# In CPython a full collection comes by itself as containers are made. Here that is up to the heap, which may content itself with the young for a long time. JavaScript asks for one: to Python that is a
# collection like any that nobody has asked for.
try:
    from js import Bun
except ImportError:
    Bun = None


@ctypes.CFUNCTYPE(None, c_long)
def at_clear(id):
    if not is_in_clear.is_set():
        being_cleared.add(id)
        is_in_clear.set()
        wait_for(has_collected, "the other thread has collected")
        being_cleared.discard(id)


@ctypes.CFUNCTYPE(None, c_long)
def at_dealloc(id):
    ended_by.append((id, threading.current_thread().name, "under its own tp_clear" if id in being_cleared else "when nothing of C's runs for it"))


def other():
    wait_for(is_in_clear, "a tp_clear has begun")
    for _ in range(3):
        gc.collect()
    has_collected.set()


for first_id, length in (11, 2), (21, 1):
    is_in_clear, has_collected = threading.Event(), threading.Event()
    being_cleared, ended_by = set(), []
    thread = threading.Thread(target=other, name="the other")
    thread.start()
    call_at_clear(ctypes.cast(at_clear, c_void_p))
    call_at_dealloc(ctypes.cast(at_dealloc, c_void_p))
    drop_ring(first_id, length)
    kept = []
    while not count_events() and len(kept) < 2000:
        kept.append([[] for _ in range(5000)])
        if Bun:
            Bun.gc(True)
    del kept
    wait_for_end_of(thread)
    gc.collect()
    call_at_clear(None)
    call_at_dealloc(None)
    print(ended_by)
    events = take_events()
    print([event for event in events if event // 1000000 == 1])
    print("cleared more than once:", sorted({event % 1000000 for event in events if event // 1000000 == 2 and events.count(event) > 1}))
