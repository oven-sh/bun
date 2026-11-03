import gc, weakref
gc.collect()
l = []; l.append(l); gc.collect(); del l; print("list", gc.collect())
d = {}; d[1] = d; gc.collect(); del d; print("dict", gc.collect())
l = []; t = (l,); l.append(t); gc.collect(); del t, l; print("tuple", gc.collect())
class A: pass
A.a = A; gc.collect(); del A; print("class", gc.collect() != 0)
class A: pass
a = A(); a.a = a; gc.collect(); del a; print("instance", gc.collect())
d = {}; exec("def f(): pass\n", d); gc.collect(); del d; print("function", gc.collect())
print("nothing", gc.collect())
x = [[1, 2], {3: 4}, (5, [6])]; del x; print("acyclic", gc.collect())
print(sorted(gc.get_referents([1, 3, 5])), sorted(gc.get_referents((1, 3, 5))), sorted(gc.get_referents({1: 3, 5: 7})), sorted(gc.get_referents([1, 2], {3: 4}, (0, 0, 0))), gc.get_referents(1, 'a', 4j))
def cb(phase, info): print(phase, sorted(info), info["generation"], info["collected"])
gc.callbacks.append(cb)
l = []; l.append(l); del l
print(gc.collect())
gc.callbacks.clear()
print(gc.get_stats()[2]["collections"] > 0, sorted(gc.get_stats()[0]))
gc.set_debug(gc.DEBUG_SAVEALL); L = []; L.append(L); i = id(L); del L; gc.collect(); gc.set_debug(0); print(len(gc.garbage), id(gc.garbage[0]) == i); gc.garbage.clear()
s = []
class Laz:
    def __del__(self): s.append(self)
z = Laz(); print(gc.is_finalized(z)); del z; gc.collect(); z = s.pop(); print(gc.is_finalized(z), gc.is_finalized(3))
print([gc.is_tracked(v) for v in (None, 1, 1.0, 1j, True, b"a", "a", bytearray(b"a"), type, int, object, object())])
print([gc.is_tracked(v) for v in (gc, Laz, z, [], set(), {}, (), (1, 2), ([],), (1, (2, [])))])
print(gc.get_threshold()); gc.set_threshold(5, 6); print(gc.get_threshold()); gc.set_threshold(2000, 10, 10)
# Who refers to what.
class Holder: pass
target = Holder(); h = Holder(); h.attribute = target; l = [target]; t = (target,); d = {"key": target}; s = {target}
referrers = gc.get_referrers(target)
print(sorted(type(r).__name__ for r in referrers if r is not globals()), any(r is globals() for r in referrers))
print(any(r is l for r in referrers), any(r is t for r in referrers), any(r is d for r in referrers), any(r is s for r in referrers))
print([type(x).__name__ for x in gc.get_referents(h)], gc.get_referents(l) == [target], gc.get_referents(d) == [target], gc.get_referents({1: target}) == [target, 1])
objects = gc.get_objects()
print(any(o is l for o in objects), any(o is h for o in objects), any(o is Holder for o in objects), any(o is target for o in objects), all(gc.is_tracked(o) for o in objects))
del objects, referrers
# Finalizers and callbacks within one collection.
order = []
class F:
    def __del__(self): order.append("del")
gc.callbacks.append(lambda phase, info: order.append((phase, info["collected"])))
f = F(); f.me = f; del f
print(gc.collect(), order)
gc.callbacks.clear()
# A collection from within a finalizer or a callback does nothing.
class G:
    def __del__(self): order.append(("collect in del", gc.collect()))
order.clear(); g = G(); g.me = g; del g; gc.collect(); print(order)
for name in ("DEBUG_STATS", "DEBUG_COLLECTABLE", "DEBUG_UNCOLLECTABLE", "DEBUG_SAVEALL", "DEBUG_LEAK"): print(name, getattr(gc, name))
for bad in (lambda: gc.collect(3), lambda: gc.collect(-1), lambda: gc.collect("x"), lambda: gc.get_objects(3), lambda: gc.get_objects(-2), lambda: gc.get_objects("x"), lambda: gc.set_threshold(), lambda: gc.is_tracked(), lambda: gc.set_debug("x")):
    try: print(bad())
    except Exception as e: print(type(e).__name__, e)
print(gc.isenabled()); gc.disable(); print(gc.isenabled()); gc.enable(); print(gc.isenabled())
print(type(gc.garbage).__name__, gc.garbage, type(gc.callbacks).__name__, gc.callbacks, gc.get_debug())
