# What the main thread makes and drops is finalized by the main thread, whatever other threads do meanwhile.
import collections, gc, threading, weakref

where = collections.Counter()


def here(kind):
    where[kind, threading.current_thread().name] += 1


class A:
    def __init__(self, kind):
        self.kind = kind

    def __del__(self):
        here(self.kind)


class Plain:
    pass


def gen(kind):
    try:
        yield
    finally:
        here(kind)


async def coroutine(kind):
    try:
        await Suspend()
    finally:
        here(kind)


class Suspend:
    def __await__(self):
        yield


stop = False


def idle():   # as a worker of a pool that has nothing to do: it wakes up now and then
    lock = threading.Lock()
    lock.acquire()
    while not stop:
        lock.acquire(timeout=0.001)


def asleep():
    sleeping.wait()


def busy():
    while not stop:
        sum(len(str(i)) for i in range(1000))


def allocating():
    while not stop:
        [[i] for i in range(1000)]


sleeping = threading.Event()
for name, target in (("idle", idle), ("asleep", asleep), ("busy", busy), ("allocating", allocating)):
    stop = False
    where.clear(); refs = []
    threads = [threading.Thread(target=target, name="worker") for _ in range(2)]
    for t in threads:
        t.start()
    for i in range(2000):
        a = A("plain"); del a
        b = A("cycle"); b.me = b; del b
        g = gen("generator"); next(g); del g
        c = coroutine("coroutine"); c.send(None); del c
        p = Plain(); refs.append(weakref.ref(p, lambda r: here("weakref"))); del p
        p = Plain(); weakref.finalize(p, here, "finalize"); del p
        if i % 50 == 49:
            gc.collect()
    gc.collect()
    stop = True
    sleeping.set()
    for t in threads:
        t.join()
    sleeping.clear()
    print(name, sorted(where.items()))
