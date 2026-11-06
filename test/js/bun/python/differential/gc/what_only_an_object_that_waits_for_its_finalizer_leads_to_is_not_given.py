# A chain of objects with a __del__, each of which holds the next in a list, is dropped. With reference counts all of it is gone. gc.get_objects() and gc.get_referrers() give none of it: not the objects, and
# not the lists either, which lead straight to objects whose finalizers are about to be called.
import gc

log = []
class N:
    def __init__(self, name, next=None): self.name = name; self.kids = [next]
    def __del__(self): log.append(self.name)
def chain(n):
    x = None
    for i in range(n): x = N(i, x)
    return x

for depth in 2, 3, 6, 40:
    gc.collect(); log.clear()
    x = chain(depth); del x
    objects = gc.get_objects()
    given = sorted(o.name for o in objects if type(o) is N)
    reached = [o[0] for o in objects if type(o) is list and len(o) == 1 and type(o[0]) is N]
    o = objects = None
    print('a chain of', depth, '| given:', given, '| reached through lists that were given:', sorted(x.name for x in reached), '| of those finalized while they were held:',
          sorted(x.name for x in reached if gc.is_finalized(x)))
    x = reached = None
    gc.collect(); gc.collect()
    print('    finalized in the end:', len(log), 'each once:', len(set(log)) == len(log))

    x = chain(depth); del x
    referrers = [r for r in gc.get_referrers(N) if type(r) is N]
    print('    instances among the referrers of the class:', sorted(r.name for r in referrers))
    r = referrers = None
    gc.collect(); gc.collect()

# Scene by scene. All in straight lines where it matters: where finalizers come late they are called at the entries of functions and in loops, not by gc's functions.
import ctypes, sys, threading, types, weakref
class P:                                   # It has no finalizer.
    def __init__(self, name, *holds): self.name = name; self.holds = list(holds)
class F(P):
    def __del__(self): log.append(self.name)
def names(objects): return sorted(o.name for o in objects if type(o) in (F, P))
def settle():
    for i in range(4): gc.collect()
    del log[:]

settle()
x = F('t', P('p1', P('p2'))); del x
got = names(gc.get_objects())
print('a tree below an object with a finalizer:', got); settle()

# What reference counts would not have freed is still there in CPython, wherever it hangs.
a = F('a'); b = F('b', a); a.holds.append(b); x = F('t', a); del a, b, x
got = names(gc.get_objects())
print('a cycle with finalizers below an object with a finalizer:', got)
for i in range(3): pass
got = names(gc.get_objects())
print('    after a safe point:', got, '| finalized so far:', log); settle()

a = P('a'); b = P('b', a); a.holds.append(b); x = F('t', a); del a, b, x
got = names(gc.get_objects())
print('a cycle without finalizers below an object with a finalizer:', got); settle()

a = P('a'); b = P('b', a); a.holds.append(b); a.holds.append(F('below the cycle', P('below that'))); x = F('t', a); del a, b, x
got = names(gc.get_objects())
print('and what hangs off such a cycle:', got); settle()

def make_local():
    class Local:
        def __del__(self): log.append('instance of Local')
    return Local()
x = make_local(); del x
got = [o.__name__ for o in gc.get_objects() if isinstance(o, type) and o.__name__ == 'Local']
print('the class of an instance with a finalizer, both dropped:', got); settle()

held = P('held by the program'); x = F('t', P('p', held)); del x
got = sorted(getattr(r, 'name', type(r).__name__) if type(r) is not list else 'a list of %d' % len(r) for r in gc.get_referrers(held) if not (type(r) is dict and 'log' in r))
print('the referrers of an object that the program holds and a dropped tree refers to:', got); del held; settle()

shared = P('shared'); x = F('t1', shared); y = F('t2', shared); del shared, x, y
got = names(gc.get_objects())
print('what two objects with finalizers share:', got); settle()

shared = P('shared'); x = F('t', shared); kept = P('kept', shared); del shared, x
got = names(gc.get_objects())
print('what an object with a finalizer shares with the program:', got); del kept; settle()

ready = threading.Event(); go = threading.Event(); box = []
def maker():
    box.append(F('made by a thread that waits', P('below it'))); ready.set(); go.wait(30)
t = threading.Thread(target=maker); t.start(); ready.wait(30)
box.clear()
# (The first call wakes the thread for its finalizer. It does not get its turn between the two.)
interval = sys.getswitchinterval(); sys.setswitchinterval(1000)
got1 = names(gc.get_objects()); got2 = names(gc.get_objects())
sys.setswitchinterval(interval)
print('what a thread that waits has made, dropped by this one, twice in a row:', got1, got2)
go.set(); t.join(); settle()

# It waits for its finalizer, and a weak reference, which lives until that has been called, gives it back to the program. (With reference counts the reference is dead by then.)
x = F('given back by a weak reference'); r = weakref.ref(x); del x
gc.get_objects(); y = r(); got = names(gc.get_objects())
print('what waits for its finalizer and is held again:', got); del y; settle()

def suspended(x):
    try: yield
    finally: log.append('generator closed')
g = suspended(P('variable of a suspended generator')); next(g); del g
got = names(gc.get_objects())
print('the variables of a suspended generator with something to close:', got); settle()

# The code of a callback of ctypes outlives the function pointer for as long as there are finalizers to call.
def callback():
    o = F('in the closure of a callback')
    return ctypes.CFUNCTYPE(None)(lambda: o.name)
c = callback(); del c
objects = gc.get_objects()
functions = [o for o in objects if type(o) is types.FunctionType and o.__name__ == '<lambda>' and o.__closure__]
reached = [f.__closure__[0].cell_contents for f in functions if type(f.__closure__[0].cell_contents) is F]
got = names(objects); del objects
print('a callback of ctypes that has been dropped: given:', got, '| functions given that lead to the object:', len(reached)); del functions, reached; settle()
