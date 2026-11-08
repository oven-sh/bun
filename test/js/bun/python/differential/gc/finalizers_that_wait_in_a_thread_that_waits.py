# A thread that waits looks for garbage by itself after a while, and runs the finalizers of what it has dropped on top of its wait. Such a finalizer may wait in turn, for any length of time: here for the
# finalizer of what another thread drops LATER, and that thread waits as well. With reference counts each thread finalizes what it drops, on the spot, so that ends. Where a collector finds the garbage,
# the threads that wait have to go on looking while one of them sits in a finalizer that it has found.
# Whoever is not to look yet spins, and makes nothing while it does: so each F is found by the thread that has dropped it, and by no other. Before anything is dropped all threads of a scene are up and the
# main thread is back from starting them (it waits for each to come up, which on a busy machine is long enough for it to look, and it may still be at that when the thread runs). And all that will be
# dropped has come through a collection by then, so that no collection of the young generation finds it, which allocation brings about at any time.
# No finalizer touches an Event that its own thread waits for. (An Event has a lock inside, which a thread holds for a moment when it begins to wait. A finalizer that came on top of just that would never
# get it.)
# Each scene is a process of its own; one that has not ended when the time of the whole test is up says where its threads are and ends itself, or is killed and said so. No scene tests the passing of time.
import faulthandler, gc, os, subprocess, sys, threading, time

def out(*words): os.write(1, (' '.join(str(w) for w in words) + '\n').encode())
def name(): return threading.current_thread().name
never = threading.Event()
def start(work, name, *args): threading.Thread(target=work, args=args, daemon=True, name=name).start()

def one_finalizer_waits(how, other='waits', in_main_thread=True):
    # A thread drops F and waits, for a lock that F lets go of at its end. F waits for what G does. When F has begun, and not before, T1 drops G, and waits.
    log = []; up = []; begun = []; done = []; over = []; event = threading.Event(); ended = threading.Lock(); ended.acquire(); r, w = os.pipe()
    class F:
        def __del__(self):
            log.append('F begins in ' + name()); begun.append(1)
            if how == 'waits': event.wait()
            elif how == 'polls':
                while not done: time.sleep(0.001)
            elif how == 'spins':
                while not done: pass
            else: os.read(r, 1)
            log.append('F ends'); over.append(1); ended.release()
    class G:
        def __del__(self): log.append('G in ' + name()); done.append(1); os.write(w, b'x'); event.set()
    def drops_g():
        mine = [G()]; up.append(1)
        while not begun: pass
        del mine[0]
        while other == 'naps': time.sleep(0.01)
        never.wait()
    def drops_f():
        mine = [F()]; up.append(1)
        while len(up) < 3: pass
        gc.collect()
        del mine[0]
        ended.acquire()
    start(drops_g, 'T1')
    if not in_main_thread: start(drops_f, 'T0')
    up.append(1)
    if in_main_thread: drops_f()
    while not over: pass
    out(log)

def it_waits(): one_finalizer_waits('waits')
def it_waits_and_the_other_thread_naps(): one_finalizer_waits('waits', 'naps')
def it_polls(): one_finalizer_waits('polls')
def it_spins(): one_finalizer_waits('spins')
def it_waits_beside_a_thread_that_works(): one_finalizer_waits('waits', in_main_thread=False)
def it_reads_a_pipe_beside_a_thread_that_works(): one_finalizer_waits('reads', in_main_thread=False)

def two_finalizers_wait():
    # Two threads sit each in the finalizer of what it has dropped, the second since the first has begun, when a third drops what the two wait for.
    log = []; up = []; begun = []; over = []; done = [threading.Event(), threading.Event()]
    class F:
        def __init__(self, i): self.i = i
        def __del__(self): log.append('F%d begins in %s' % (self.i, name())); begun.append(1); done[self.i].wait(); log.append('F%d ends' % self.i); over.append(1)
    class G:
        def __init__(self, i): self.i = i
        def __del__(self): log.append('G%d in %s' % (self.i, name())); done[self.i].set()
    def drops_f(i):
        mine = [F(i)]; up.append(1)
        while len(up) < 4 or len(begun) < i: pass
        if not i: gc.collect()
        del mine[0]
        never.wait()
    def drops_g():
        mine = [G(0), G(1)]; up.append(1)
        while len(begun) < 2: pass
        mine.clear()
        never.wait()
    start(drops_g, 'T3')
    for i in range(2): start(drops_f, 'T%d' % (i + 1), i)
    up.append(1)
    while len(over) < 2: pass
    out(sorted(log))

def a_chain_of_finalizers_that_wait():
    # Each of three threads drops, when the finalizer of the one before it has begun, an object whose finalizer waits for that of the next. The last waits for nothing.
    n = 3; log = []; up = []; begun = []; ended = [threading.Event() for _ in range(n)]; over = []
    class F:
        def __init__(self, i): self.i = i
        def __del__(self):
            log.append('F%d begins in %s' % (self.i, name())); begun.append(1)
            if self.i + 1 < n: ended[self.i + 1].wait()
            log.append('F%d ends' % self.i); ended[self.i].set(); over.append(1)
    def work(i):
        mine = [F(i)]; up.append(1)
        while len(up) < n + 1 or len(begun) < i: pass
        if not i: gc.collect()
        del mine[0]
        never.wait()
    for i in range(n): start(work, 'T%d' % i, i)
    up.append(1)
    while len(over) < n: pass
    out(log)

scenes = [it_waits, it_waits_and_the_other_thread_naps, it_polls, it_spins, it_waits_beside_a_thread_that_works, it_reads_a_pipe_beside_a_thread_that_works, two_finalizers_wait,
          a_chain_of_finalizers_that_wait]
if len(sys.argv) > 1:
    faulthandler.dump_traceback_later(max(1, float(sys.argv[2]) - time.monotonic()), exit=True)    # A little before the parent would kill it, and whatever becomes of the parent.
    {f.__name__: f for f in scenes}[sys.argv[1]]()
else:
    # One limit for the whole test, below that of whoever runs it (60 s; 300 s for a build with assertions, which takes seconds to start): it goes by how long this build takes to start.
    a = time.monotonic(); subprocess.run([sys.executable, '-c', 'import faulthandler, gc, subprocess, threading']); limit = time.monotonic() + min(25 + 100 * (time.monotonic() - a), 240)
    children = [(f.__name__, subprocess.Popen([sys.executable, __file__, f.__name__, str(limit - 5)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)) for f in scenes]
    for name, child in children:
        try: text = child.communicate(timeout=max(0.2, limit - time.monotonic()))[0].decode(); status = child.returncode
        except subprocess.TimeoutExpired: child.kill(); text = child.communicate()[0].decode(); status = 'KILLED: it did not end'
        print('%s: status %s' % (name, status))
        for line in text.splitlines(): print('   ', line)
