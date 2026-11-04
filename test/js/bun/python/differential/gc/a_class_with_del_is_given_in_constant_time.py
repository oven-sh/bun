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
    start = time.perf_counter()
    for o in objects:
        o.__class__ = after
    return time.perf_counter() - start


def best(*args):
    return min(convert(*args) for i in range(3))


for before, after in ((Plain, WithDel), (PlainDict, DictWithDel)):
    convert(1000, before, after)
    print(after.__name__, best(80000, before, after) < 8 * best(20000, before, after))
gc.collect()
print(finalized)

# While many objects with a __del__ are alive, and many have been finalized.
few = best(2000, Plain, WithDel)
alive = [WithDel() for i in range(200000)]
print(best(2000, Plain, WithDel) < 8 * few + 0.001)
del alive
gc.collect()
print(finalized)

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
