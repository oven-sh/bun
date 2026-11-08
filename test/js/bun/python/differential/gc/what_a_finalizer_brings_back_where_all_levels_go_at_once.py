# NOT AS IN CPYTHON, AND DECLARED (DEFERRED.md, "When the weak references to an object die"): the expectation is written by hand.
# Where a collector calls the finalizers of a parent and of its children one behind the other, without looking in between, it takes it for granted that no finalizer brings its object back. One that does
# finds what its object held finalized, and the weak references among them that nothing else held dead, for good: a child no longer finds its parent. With reference counts nothing of that happens.
# What has to hold all the same: the object can be referred to weakly again. (weakref.ref(x) gives the same reference each time while somebody holds it. Not one that has died before its referent.)
# And what the program itself still holds is not touched: that is in weak_references_die_behind_the_finalizer.py, as in CPython.
import gc, weakref

log = []; kept = []
class N:
    def __init__(self, name, ask=None): self.name = name; self.ask = ask
    def __del__(self):
        log.append(self.name if self.ask is None else '%s(%s)' % (self.name, self.ask()))
        if self.name == 'top': kept.append(self)
def says(reference): return lambda: 'gone' if reference() is None else 'ALIVE'

top = x = N('top')
for i in range(1, 5): x.below = N('n%d' % i, says(weakref.ref(x))); x = x.below
del top, x, i
gc.collect()
print(' '.join(log))
top = kept.pop(); child = top.below
print('the child asks again:', child.ask(), '| the grandchild:', child.below.ask())
old = child.ask.__closure__[0].cell_contents
print('the reference that the child holds:', type(old).__name__, old(), '| __weakref__:', top.__weakref__, weakref.getweakrefcount(top))
new = weakref.ref(top)
print('a new one:', says(new)(), new is not old, new() is top, weakref.ref(top) is new, top.__weakref__ is new, weakref.getweakrefcount(top))
gc.collect()
print('behind another collection:', child.ask(), says(new)(), ' '.join(log[5:]) or 'nothing more')

# The same with callbacks: whoever holds a reference that has died hears of it, though the referent lives.
del top, child, old, new; log.clear(); gc.collect(); log.clear()
told = []
top = x = N('top')
for i in range(1, 5): x.below = N('n%d' % i); x.below.up = weakref.ref(x, lambda reference, i=i: told.append('the reference of n%d' % i)); x = x.below
members = weakref.WeakSet([top]); top.below.members = members
del top, x, i, members
gc.collect()
top = kept.pop()
print(' '.join(log), '|', sorted(told), '|', top.below.up(), top.below.below.up(), len(top.below.members))
