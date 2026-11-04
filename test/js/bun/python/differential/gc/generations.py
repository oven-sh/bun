# gc.collect(generation): what is young is found by a collection of any generation, what has come through a collection is not
# found by one of the youngest.
import gc, weakref

class Node:
    def __init__(self): self.me = self

class Fin:
    log = []
    def __init__(self, name): self.name = name; self.me = self
    def __del__(self): Fin.log.append(self.name)

gc.collect()
for generation in (0, 1, 2):
    Node(); Node(); [].append([]); x = []; x.append(x); del x
    print("young garbage, generation", generation, "->", gc.collect(generation))

a = Node()
print("nothing to find ->", gc.collect(0))
del a
print("what has come through a collection, generation 0 ->", gc.collect(0))
print("generation 2 ->", gc.collect(2))

# (How many it has found is not printed: what has a finalizer may be counted when it is found or when it is freed.)
for generation in (0, 1, 2):
    Fin("cycle %d" % generation)
    gc.collect(generation)
    print("finalizer, generation", generation, "->", Fin.log)

for generation in (0, 1, 2):
    n = Node(); r = weakref.ref(n); called = []; c = weakref.ref(n, lambda r: called.append("callback")); del n
    gc.collect(generation)
    print("weak references, generation", generation, "->", r() is None, c() is None, called)

told = []
def callback(phase, info): told.append((phase, info["generation"], info["collected"]))
gc.callbacks.append(callback)
before = [s["collections"] for s in gc.get_stats()]
for generation in (0, 1, 2):
    Node()
    gc.collect(generation)
gc.callbacks.remove(callback)
print(told)
print([s["collections"] - b for s, b in zip(gc.get_stats(), before)])

for bad in (-1, 3):
    try: gc.collect(bad)
    except ValueError as e: print("ValueError", e)
print(gc.collect(generation=0), gc.collect(generation=1))
