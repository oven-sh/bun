# Two kinds of memory that a dict or a set leaves behind. What it leaves for other memory, because it grew, lets go of nothing: the items are in the new memory. What clear() leaves is how the
# container let go of its items: at that point of the program, neither before everything else that was dropped nor after it. Where a collector finds both kinds dead, still holding what they held,
# it has to tell them apart.
import gc

log = []


class A:
    def __init__(self, n):
        self.n = n

    def __del__(self):
        log.append(self.n)


def both_cleared():
    shared = A('shared')
    a = {0: shared, 1: A('p')}
    b = {0: shared, 1: A('q')}
    del shared
    a.clear()
    b.clear()
    return a, b


def both_cleared_and_the_shared_one_made_last():
    a = {1: A('p')}
    b = {1: A('q')}
    shared = A('shared')
    a[0] = shared
    b[0] = shared
    del shared
    a.clear()
    b.clear()
    return a, b


def both_dropped():
    shared = A('shared')
    a = {0: shared, 1: A('p')}
    b = {0: shared, 1: A('q')}
    del shared
    del a
    del b


def one_dropped_and_one_cleared():
    shared = A('shared')
    a = {0: shared, 1: A('p')}
    b = {0: shared, 1: A('q')}
    del shared
    del a
    b.clear()
    return b


def two_namespaces():
    shared = A('shared')
    a = {'file': shared, 'own': A('own1')}
    b = {'file': shared, 'own': A('own2')}
    del shared
    a.clear()
    b.clear()
    return a, b


def filled_in_another_order_grown_and_cleared():
    values = [A(i) for i in range(12)]
    d = {}
    for i in reversed(range(12)):
        d[i] = values[i]
    del values
    d.clear()
    return d


def a_set_that_has_grown_is_dropped():
    x = A('x')
    s = set()
    for i in range(40):
        s.add(i)
    s.add(A('in the set'))
    for i in range(40, 200):
        s.add(i)
    y = A('y')
    del x
    del s
    del y


for scene in (both_cleared, both_cleared_and_the_shared_one_made_last, both_dropped, one_dropped_and_one_cleared, two_namespaces,
              filled_in_another_order_grown_and_cleared, a_set_that_has_grown_is_dropped):
    gc.collect()
    del log[:]
    kept = scene()
    gc.collect()
    gc.collect()
    print('%s: %s' % (scene.__name__, ' '.join(map(str, log))))
    del kept
