# Daemon threads that keep making garbage with finalizers, and a main thread that wants to exit. With reference counts each thread finalizes what it drops on the spot. Where a
# collector finds the garbage and the main thread, as it ends, finalizes what has been dropped by then, it must not take upon itself what the others go on making.
# Each scene is a process of its own; all run at once; one that has not ended within the limit is killed and said so. No scene sleeps.
import atexit, gc, os, subprocess, sys, threading, time, weakref

def out(*words): os.write(1, (' '.join(str(w) for w in words) + '\n').encode())
made = [0]
class Leaf:
    def __del__(self): pass
class M:
    def __del__(self): made[0] += 1
class Grows(M):
    def __del__(self):
        M.__del__(self); [Leaf() for _ in range(5)]
def start(work, n=2):
    for i in range(n): threading.Thread(target=work, daemon=True).start()
def make():
    while True: [M() for _ in range(100)]
def until(count):
    while made[0] < count: pass
def report(): out('atexit callback')

def makers_that_collect():
    rounds = []
    def work():
        while True:
            [Grows() for _ in range(20)]; gc.collect(); rounds.append(1)
    start(work)
    while len(rounds) < 4: pass
    atexit.register(report); out('main ends')
def makers():
    start(make, 3); until(1000); atexit.register(report); out('main ends')
def sys_exit_beside_makers():
    start(make); until(1000); out('main ends'); sys.exit(5)
def atexit_callback_makes_garbage():
    class Tells:
        def __del__(self): out('finalizer of what the callback made')
    start(make); until(1000); atexit.register(lambda: (Tells(), out('atexit callback'))[0] and None); out('main ends')
def makers_of_weak_references():
    class O: pass
    def called(r): made[0] += 1
    def work():
        while True: [weakref.ref(O(), called) for _ in range(100)]
    start(work); until(1000); atexit.register(report); out('main ends')
def finalizers_that_write():
    r, w = os.pipe()
    class W:
        def __del__(self):
            made[0] += 1
            if made[0] % 500 == 0: os.write(w, b'.'); os.read(r, 1)
    def work():
        while True: [W() for _ in range(100)]
    start(work, 3); until(2000); atexit.register(report); out('main ends')
def thread_that_waits_has_dropped():
    # Nobody else runs while the main thread ends: all that has come of what the thread dropped is finalized before the callbacks of atexit.
    seen = []; box = []; ready = threading.Event(); never = threading.Event()
    class Tells:
        def __init__(self, name, holds=None): self.name = name; self.holds = holds
        def __del__(self): seen.append(self.name)
    class Empties(Tells):
        def __del__(self): Tells.__del__(self); box.clear()
    def work():
        box.append(Tells('in the box', Tells('held by what was in the box')))
        x = Empties('empties the box', Tells('held by it')); del x
        ready.set(); never.wait()
    start(work, 1); ready.wait()
    atexit.register(lambda: out('atexit callback; finalized by then:', sorted(seen))); out('main ends')
def collect_pays_for_a_thread_that_waits():
    seen = []; box = []; ready = threading.Event(); never = threading.Event()
    class Tells:
        def __init__(self, name, holds=None): self.name = name; self.holds = holds
        def __del__(self): seen.append(self.name)
    class Empties(Tells):
        def __del__(self): Tells.__del__(self); box.clear()
    def work():
        box.append(Tells('in the box', Tells('held by what was in the box')))
        x = Empties('empties the box', Tells('held by it')); del x
        ready.set(); never.wait()
    start(work, 1); ready.wait(); gc.collect(); out('after gc.collect():', sorted(seen))

scenes = [makers_that_collect, makers, sys_exit_beside_makers, atexit_callback_makes_garbage, makers_of_weak_references, finalizers_that_write, thread_that_waits_has_dropped,
          collect_pays_for_a_thread_that_waits]
if len(sys.argv) > 1:
    {f.__name__: f for f in scenes}[sys.argv[1]]()
else:
    children = [(f.__name__, subprocess.Popen([sys.executable, __file__, f.__name__], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)) for f in scenes]
    limit = time.monotonic() + 90     # for all of them together
    for name, child in children:
        try: text = child.communicate(timeout=max(1, limit - time.monotonic()))[0].decode(); status = child.returncode
        except subprocess.TimeoutExpired: child.kill(); text = child.communicate()[0].decode(); status = 'KILLED: it did not end'
        print('%s: status %s' % (name, status))
        for line in text.splitlines(): print('   ', line)
