# Two threads have each dropped objects with finalizers, and wait. One collection finds what both have dropped, and it is none that makes the calls itself: gc.get_objects() only looks.
# Each thread finalizes what is its own, as with reference counts, a holder before what it holds; a weak reference's callback is called too.
import faulthandler, gc, os, threading, weakref

faulthandler.dump_traceback_later(60, exit=True)    # An end of its own, which decides nothing.
def out(*words): os.write(1, (' '.join(str(w) for w in words) + '\n').encode())
seen = {'T0': [], 'T1': []}
go = threading.Event(); never = threading.Event()
made = [threading.Event(), threading.Event()]; dropped = [threading.Event(), threading.Event()]; done = [threading.Event(), threading.Event()]
class Tells:
    def __init__(self, name, holds=None): self.name = name; self.holds = holds
    def __del__(self): seen[threading.current_thread().name].append(self.name)
class Last(Tells):
    def __del__(self): Tells.__del__(self); done[int(self.name[1])].set()
class Plain: pass
def work(i):
    t = 't%d ' % i
    x = Tells(t + 'holder', Tells(t + 'child', Last(t + 'grandchild')))
    p = Plain(); r = weakref.ref(p, lambda r: seen[threading.current_thread().name].append(t + 'callback'))
    made[i].set(); go.wait()
    del p
    del x
    dropped[i].set(); never.wait()
for i in range(2): threading.Thread(target=work, args=(i,), daemon=True, name='T%d' % i).start()
for e in made: e.wait()
go.set()
for e in dropped: e.wait()
gc.get_objects()
for e in done: e.wait()
for name in sorted(seen): out(name, seen[name])
os._exit(0)
