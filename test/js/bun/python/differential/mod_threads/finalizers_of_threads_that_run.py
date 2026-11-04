# Several threads, and nobody asks for a collection. Each finalizes what it has made and dropped, and what dies of that.
import collections, queue, threading, time, weakref

# For each maker: (kind, the thread that finalized). No lock: a finalizer may come on top of whatever its thread is doing.
said = collections.defaultdict(list)
expected = {}   # For each maker: how many, and the event that tells that they have all come.


def here(kind, maker):
    said[maker].append((kind, threading.current_thread().name))
    if maker in expected and len(said[maker]) == expected[maker][0]:
        expected[maker][1].set()


class A:
    def __init__(self, kind, *refers_to):
        self.kind, self.maker, self.refers_to = kind, threading.current_thread().name, refers_to

    def __del__(self):
        here(self.kind, self.maker)


class Plain:
    pass


def gen(maker):
    try:
        yield
    finally:
        here("generator", maker)


def show():
    print(sorted(collections.Counter((kind, "its maker" if maker == thread else thread) for maker in said for kind, thread in said[maker]).items()), flush=True)
    said.clear()
    expected.clear()


def run(target, names):
    for name in names:
        said[name]
    threads = [threading.Thread(target=target, name=name) for name in names]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    show()


# ---- At work. With reference counts there is nothing to wait for; a collector comes when enough has been allocated.
ROUNDS = 100


def busy():
    me = threading.current_thread().name
    refs = []
    for i in range(ROUNDS):
        a = A("plain"); del a
        g = gen(me); next(g); del g
        p = Plain(); refs.append(weakref.ref(p, lambda r: here("weakref", me))); del p
    deadline = time.monotonic() + 60
    while len(said[me]) < 3 * ROUNDS and time.monotonic() < deadline:
        [[i] for i in range(1000)]


run(busy, ["busy %d" % i for i in range(3)])


# ---- Waiting, each for its own finalizers. Children come after their parents, in the same thread.
def waiting():
    me = threading.current_thread().name
    expected[me] = 30, threading.Event()
    for i in range(10):
        tree = A("parent", A("child", A("grandchild"))); del tree
    results.append(expected[me][1].wait(60))


results = []
run(waiting, ["waiting %d" % i for i in range(3)])
print(results)

# ---- The child was made by a thread that is alive, and waits. The parent is dropped by the thread that made it, which frees the child.
children, go = queue.SimpleQueue(), threading.Event()
expected["maker of children"] = 10, threading.Event()


def makes_children():
    for i in range(10):
        children.put(A("child of another thread's"))
    go.wait()


def makes_parents():
    for i in range(10):
        parent = A("parent", children.get())
        del parent
    print(expected["maker of children"][1].wait(60))
    go.set()


one, other = threading.Thread(target=makes_children, name="maker of children"), threading.Thread(target=makes_parents, name="maker of parents")
one.start(); other.start()
one.join(); other.join()
show()
