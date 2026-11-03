# Weak references, their callbacks and finalizers: what comes first.
import gc, weakref
log = []
class A:
    def __init__(self, n): self.n = n
    def __del__(self): log.append("del %s" % self.n)
def show(name):
    gc.collect()
    print(name, log); log.clear()
def callback(name):
    return lambda r: log.append("callback %s, dead: %s" % (name, r() is None))

a = A(1); r = weakref.ref(a, callback(1)); del a; show("no cycle:")
a = A(2); a.me = a; r = weakref.ref(a, callback(2)); del a; show("cycle:")
a = A(3); r1 = weakref.ref(a, callback("3a")); r2 = weakref.ref(a, callback("3b")); r3 = weakref.ref(a, callback("3c")); del a; show("several:")
a = A(4); a.me = a; r1 = weakref.ref(a, callback("4a")); r2 = weakref.ref(a, callback("4b")); del a; show("several, cycle:")
a = A(5); r = weakref.ref(a, callback(5)); del r; del a; show("the reference goes first:")
a = A(7); a.me = a; a.r = weakref.ref(a, callback(7)); del a; show("the reference goes with it, cycle:")
# What the finalizer sees of weak references.
class B:
    def __del__(self): log.append("in del: without callback %s, with callback %s" % (plain() is self, with_callback() is self))
b = B(); plain = weakref.ref(b); with_callback = weakref.ref(b, callback("b")); del b; show("seen from __del__:")
b = B(); b.me = b; plain = weakref.ref(b); with_callback = weakref.ref(b, callback("b")); del b; show("seen from __del__, cycle:")
# An object that comes back.
kept = []
class C:
    def __del__(self): kept.append(self); log.append("del C")
c = C(); plain = weakref.ref(c); with_callback = weakref.ref(c, callback("c")); del c; show("back:")
print(plain() is kept[0], with_callback() is kept[0]); kept.clear(); show("gone again:"); print(plain(), with_callback())
c = C(); c.me = c; plain = weakref.ref(c); with_callback = weakref.ref(c, callback("c")); del c; show("back, cycle:")
print(plain() is kept[0], with_callback()); kept.clear(); show("gone again:"); print(plain(), with_callback())
# Containers
d = weakref.WeakValueDictionary(); a = A(8); d["k"] = a; print(len(d)); del a; gc.collect(); print(len(d), list(d)); log.clear()
k = weakref.WeakKeyDictionary(); a = A(9); k[a] = 1; print(len(k)); del a; gc.collect(); print(len(k)); log.clear()
s = weakref.WeakSet(); a = A(10); s.add(a); print(len(s)); del a; gc.collect(); print(len(s)); log.clear()
f = weakref.finalize(A(11), log.append, "finalize"); show("finalize:"); print(f.alive)
a = A(12); p = weakref.proxy(a, lambda r: log.append("callback")); print(p.n); del a; gc.collect()
try: p.n
except ReferenceError as e: print("ReferenceError", e)
print(log); log.clear()
# The callback of a reference to an object that a dead cycle holds
a = A(13); holder = [a]; holder.append(holder); r = weakref.ref(a, callback(13)); del a, holder; show("below a cycle:")
