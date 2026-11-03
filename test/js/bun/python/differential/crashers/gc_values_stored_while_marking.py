# The collector marks while the program runs. Whatever it reads from a cell that the program is storing to at that moment has to be
# either the old value or the new one. (The values of a dict used to be at addresses that are not multiples of 8. One in eight
# crossed a cache line, a store to it arrived in two halves, and half an int, or half an int and half an address, was taken for the
# address of a cell.)
#
# Every kind of container has ints and objects stored to it by turns, in a process of its own in which one full collection follows
# the other. Prints a line for each: the point is that the processes survive. Usage: gc_values_stored_while_marking.py [seconds]
import collections, os, subprocess, sys, time

OPTIONS = {"BUN_JSC_collectContinuously": "1", "BUN_JSC_useGenerationalGC": "0"}
N = 800  # Enough for the table of a dict to be an allocation of its own, and few enough for it to be marked often.


def dict_values(residue):
    d = {i: i for i in range(N)}
    keys = list(range(residue, N, 4))
    o = object()

    def step():
        for k in keys:
            d[k] = o
        for k in keys:
            d[k] = k
    return step


def dict_keys():
    d = {i: i for i in range(N)}

    def step():
        for k in range(N):
            del d[k]
        for k in range(N):
            d[k] = k
        for k in range(N):
            del d[k]
        for k in range(N):
            d[str(k)] = k
        d.clear()
        for k in range(N):
            d[k] = k
    return step


def set_items():
    s = set()
    objects = [object() for i in range(N)]

    def step():
        for i in range(N):
            s.add(i)
        for i in range(N):
            s.discard(i)
        for o in objects:
            s.add(o)
        for o in objects:
            s.discard(o)
    return step


def list_items():
    items = list(range(N))
    o = object()

    def step():
        for i in range(N):
            items[i] = o
        for i in range(N):
            items[i] = i
    return step


def list_moves():
    o = object()
    items = [o if i & 1 else i for i in range(N)]

    def step():
        for i in range(N):
            items.insert(0, items.pop())
        for i in range(N):
            items.append(items.pop(0))
        items.reverse()
        items[10:20], items[30:35] = items[30:35], items[10:20]
    return step


def deque_items():
    o = object()
    items = collections.deque(o if i & 1 else i for i in range(N))

    def step():
        for i in range(N):
            items.rotate(1)
        for i in range(N):
            items.appendleft(items.pop())
        for i in range(N):
            items[i] = i if items[i] is o else o
    return step


def generator_variables():
    o = object()

    def body():
        a = b = c = d = e = f = g = h = 0
        while True:
            a, b, c, d, e, f, g, h = 1, o, 3, o, 5, o, 7, o
            yield a
            a, b, c, d, e, f, g, h = o, 2, o, 4, o, 6, o, 8
            yield b
    generators = [body() for i in range(100)]

    def step():
        for generator in generators:
            next(generator)
    return step


def attributes():
    class Plain:
        pass

    class Slots:
        __slots__ = ("a", "b", "c", "d", "e")
    o = object()
    objects = [Plain() for i in range(50)] + [Slots() for i in range(50)]

    def step():
        for x in objects:
            x.a, x.b, x.c, x.d, x.e = 1, o, 3, o, 5
        for x in objects:
            x.a, x.b, x.c, x.d, x.e = o, 2, o, 4, o
    return step


def new_containers():
    # What is filled as it is made, and stored where the collector may be looking.
    o = object()
    source = [o if i & 1 else i for i in range(N)]
    holder = [None] * 8

    def step():
        holder[0] = tuple(source)
        holder[1] = source[::2]
        holder[2] = source + source
        holder[3] = source * 2
        holder[4] = dict.fromkeys(source)
        holder[5] = set(source)
        holder[6] = {i: x for i, x in enumerate(source)}
        holder[7] = (*source, 1)
    return step


KINDS = {
    "dict_values_0": lambda: dict_values(0),
    "dict_values_1": lambda: dict_values(1),
    "dict_values_2": lambda: dict_values(2),
    "dict_values_3": lambda: dict_values(3),
    "dict_keys": dict_keys,
    "set_items": set_items,
    "list_items": list_items,
    "list_moves": list_moves,
    "deque_items": deque_items,
    "generator_variables": generator_variables,
    "attributes": attributes,
    "new_containers": new_containers,
}


def child(kind, seconds):
    ballast = [(i,) for i in range(100000)]  # So that marking takes a while.
    step = KINDS[kind]()
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        for i in range(20):
            step()
    assert len(ballast) == 100000


def main():
    seconds = sys.argv[1] if len(sys.argv) > 1 else "2"
    environment = dict(os.environ, **OPTIONS)
    waiting = list(KINDS)
    running = []
    status = {}
    while waiting or running:
        while waiting and len(running) < max(1, (os.cpu_count() or 2) // 2):
            kind = waiting.pop(0)
            running.append((kind, subprocess.Popen([sys.executable, __file__, "--child", kind, seconds], env=environment, stdin=subprocess.DEVNULL)))
        kind, process = running.pop(0)
        status[kind] = process.wait()
    for kind in KINDS:
        print(kind, "survived" if not status[kind] else "DIED: status %d" % status[kind])


if sys.argv[1:2] == ["--child"]:
    child(sys.argv[2], float(sys.argv[3]))
else:
    main()
