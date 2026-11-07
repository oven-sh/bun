# A tp_dealloc gives back the last references to two instances that another thread has made. The tp_dealloc of the first runs code of the program's, which lets the other thread
# collect, three times. The second instance is still there when its turn comes, and it comes once, in the thread that has begun.
import ctypes, gc, sys, threading
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


def make(id):
    node = Node()
    set_id(node, id)
    return node


def other():
    make_member(1)
    make_member(2)
    has_made.set()
    is_in_dealloc.wait()
    for _ in range(3):
        gc.collect()
        # What has been freed is written over.
        [make(3) for _ in range(100)]
    has_collected.set()


@ctypes.CFUNCTYPE(None, c_long)
def at_dealloc(id):
    if id < 3:
        ended_by.append((id, threading.current_thread().name))
    if id == 1:
        is_in_dealloc.set()
        has_collected.wait()


thread = threading.Thread(target=other, name="the other")
thread.start()
has_made.wait()
make_member(0)
make_family()
# A collection of the young takes whatever C owns a reference to for held: it would find the first dead alone. Now they are old, and a full one finds the three dead together.
gc.collect()
call_at_dealloc(ctypes.cast(at_dealloc, c_void_p))
# No gc.collect() is under way when they go: the other thread's would do nothing.
drop_family()
thread.join()
gc.collect()
call_at_dealloc(None)
print(ended_by)
print([event for event in take_events() if event % 1000000 < 3])
