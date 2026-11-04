# Who finalizes what another thread made: the cases in which reference counts and owners agree.
import gc, threading, weakref

said = []


def here(what):
    said.append((what, threading.current_thread().name))


class A:
    def __init__(self, name, *refers_to):
        self.name = name
        self.refers_to = refers_to

    def __del__(self):
        here(self.name)


def gen(name):
    try:
        yield
        yield
    finally:
        here(name)


def in_thread(function, name="other"):
    result = []
    t = threading.Thread(target=lambda: result.append(function()), name=name)
    t.start()
    t.join()
    return result.pop()


def show(title):
    print(title, said, flush=True)
    said.clear()


# Its maker has ended.
a = in_thread(lambda: A("made by a thread that has ended"))
del a
gc.collect()
show("ended:")

# Its maker is alive and waits. The main thread drops it and asks for a collection.
box, ready, go = [], threading.Event(), threading.Event()


def maker():
    box.append(A("made by a thread that waits"))
    box.append(gen("generator suspended by a thread that waits"))
    next(box[-1])
    o = type("Plain", (), {})()
    box.append(o)
    refs.append(weakref.ref(o, lambda r: here("callback of a weak reference made by a thread that waits")))
    del o
    ready.set()
    go.wait()


refs = []
t = threading.Thread(target=maker, name="other")
t.start()
ready.wait()
while box:
    box.pop()
    gc.collect()
show("asked for:")
go.set()
t.join()

# A generator goes from thread to thread. The one that suspended it last drops it.
g = gen("generator begun by the main thread")
next(g)


box.append(g)
del g


def takes():
    g = box.pop()
    next(g)
    del g
    gc.collect()


in_thread(takes, "taker")
show("moved:")

# What dies of something's death is finalized by the same thread, after it.
child = in_thread(lambda: A("child, made by another thread"))
grandchild_holder = A("parent, made by the main thread", child)
del child
del grandchild_holder
gc.collect()
show("tree:")

chain = None
for i in range(8):
    chain = in_thread(lambda: A("link %d" % i, chain)) if i % 2 else A("link %d" % i, chain)
del chain
gc.collect()
show("chain:")

# A cycle with members of two threads, and something hanging off it.
x = A("x of the cycle, made by the main thread", in_thread(lambda: A("hangs off the cycle")))
y = in_thread(lambda: A("y of the cycle, made by another thread", x))
x.y = y
del x, y
gc.collect()
show("mixed cycle:")
