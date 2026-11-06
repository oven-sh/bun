# gc.get_objects() and gc.get_referrers() do not hand out what has been dropped, though its finalizer may not have been called yet. What is in a
# cycle is still there until a collection comes: it is handed out alive, and being held it is no garbage.
import gc, inspect, threading

log = []
def generator(name):
    try:
        yield name
    finally:
        log.append('closed ' + name)
class D:
    def __init__(self, name):
        self.name = name
    def __del__(self):
        log.append('del ' + self.name)

def generators():
    return [o for o in gc.get_objects() if inspect.isgenerator(o) and o.gi_code is generator.__code__]
def ds():
    return [o for o in gc.get_objects() if type(o) is D]
def a_moment():
    for i in range(1000):
        pass

gc.disable()    # So that CPython leaves the cycles alone.

x = generator('a'); next(x); del x
got = generators()
print('a generator that was dropped:', [inspect.getgeneratorstate(o) for o in got])
a_moment()
print('   a moment later:', [inspect.getgeneratorstate(o) for o in got], log)
del got; gc.collect(); del log[:]

D('b')
got = ds()
print('an object with __del__ that was dropped:', [o.name for o in got])
a_moment()
print('   a moment later:', [o.name for o in got], log)
del got; gc.collect(); del log[:]

d = D('c'); d.me = d; del d
got = ds()
print('the same in a cycle:', [o.name for o in got], log)
a_moment()
print('   a moment later:', [(o.name, gc.is_finalized(o)) for o in got], log)
gc.collect()
print('   after a collection, still held:', [(o.name, gc.is_finalized(o)) for o in got], log)
del got; gc.collect()
print('   dropped:', log)
del log[:]

d = D('d'); d.me = d; d.child = D('child of d'); del d
got = ds()
print('what hangs off a cycle:', sorted(o.name for o in got), log)
del got; gc.collect()
print('   dropped:', sorted(log))
del log[:]

held = [1]
d = D('e'); d.held = held; del d
got = [type(o).__name__ for o in gc.get_referrers(held) if type(o) is D or isinstance(o, dict) and 'held' in o and o is not globals()]
print('who refers to what a dropped object held:', got)
a_moment()
print('   a moment later:', log)
gc.collect(); del log[:]

d = D('f'); d.me = d; d.held = held; del d
got = [o for o in gc.get_referrers(held) if type(o) is D or isinstance(o, dict) and 'held' in o and o is not globals()]
print('who refers to what a cycle holds:', len(got), log)
del got; gc.collect()
print('   dropped:', log)
del log[:]

# From a finalizer: those that wait behind it.
class Looks:
    def __del__(self):
        log.append(('seen from a finalizer', sorted(o.name for o in ds())))
Looks(); D('g'); D('h')
gc.collect()
print([entry for entry in log if isinstance(entry, tuple)], sorted(entry for entry in log if isinstance(entry, str)))
del log[:]

# What another thread has dropped, and has had no time to finalize.
dropped, go_on = threading.Event(), threading.Event()
def other():
    x = generator('of another thread'); next(x); del x
    D('of another thread')
    dropped.set()
    go_on.wait()
thread = threading.Thread(target=other); thread.start()
dropped.wait()
got = generators() + ds()
print('dropped by another thread:', len(got))
go_on.set(); thread.join()
gc.collect()
print('   in the end:', sorted(log))
