# To give an object a class with a __del__ takes the same time however many objects there are.
import gc, time

finalized = 0


class Plain:
    pass


class WithDel:
    def __del__(self):
        global finalized
        finalized += 1


class PlainDict(dict):
    pass


class DictWithDel(dict):
    def __del__(self):
        global finalized
        finalized += 1


def convert(n, before, after):
    objects = [before() for i in range(n)]
    # The time this thread has had, not the time that has passed: the machine has other things to do.
    start = time.thread_time()
    for o in objects:
        o.__class__ = after
    return time.thread_time() - start


def best(*args):
    return min(convert(*args) for i in range(3))


def ever(holds):
    # A collection may fall into any one measurement. If the time went with the square, four times the objects would take 16 times as long, every time.
    return any(holds() for attempt in range(5))


for before, after in ((Plain, WithDel), (PlainDict, DictWithDel)):
    convert(1000, before, after)
    print(after.__name__, ever(lambda: best(80000, before, after) < 8 * best(20000, before, after)))
gc.collect()
print(finalized % 1000, finalized >= 602000)

# While many objects with a __del__ are alive, and many have been finalized.
few = best(2000, Plain, WithDel)
alive = [WithDel() for i in range(200000)]
print(ever(lambda: best(2000, Plain, WithDel) < 8 * few + 0.001))
del alive
gc.collect()
print(finalized % 1000)

# Back and forth: it is in the list once.
o = Plain()
for i in range(1000):
    o.__class__ = WithDel
    o.__class__ = Plain
o.__class__ = WithDel
before = finalized
del o
gc.collect(); gc.collect()
print(finalized - before)
