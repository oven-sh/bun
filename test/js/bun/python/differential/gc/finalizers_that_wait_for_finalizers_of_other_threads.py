# A finalizer may wait for what the finalizer of another thread's object does. With reference counts each thread finalizes what it drops, on the spot, so that ends. Where a collector finds
# the garbage, and gc.collect() or the end of the program makes the calls that are owed, no call must lie behind one that waits, when nothing else can move, while the thread that made its object sits idle.
# And what has to happen in one order (a parent before its child) is not shared out among those that make the calls, while the callback of a weak reference is not held up by such an order.
# But as long as anything can move, the other threads keep out of what gc.collect() has found: one of them may have a lock in its hand that a finalizer wants.
# Each scene is a process of its own, eight at a time; one that has not ended when the time of the whole test is up is killed and said so, and each has an end of its own besides. No scene tests the passing of time.
import atexit, faulthandler, gc, os, subprocess, sys, threading, time, weakref

def out(*words): os.write(1, (' '.join(str(w) for w in words) + '\n').encode())
never = threading.Event()
def start(work, *args): threading.Thread(target=work, args=args, daemon=True).start()
def report(): out('atexit callback')

def two_that_owe(order, hands_out, beside=None, how='waits', says=True):
    # Two threads have each dropped an object, and wait. F waits for what G does.
    ev = threading.Event(); go = threading.Event(); made = [threading.Event(), threading.Event()]; dropped = [threading.Event(), threading.Event()]; done = []
    class F:
        def __del__(self):
            if how == 'waits': ev.wait()
            elif how == 'polls':
                while not done: time.sleep(0.001)
            else:
                while not done: pass
            if says: out('F finalized')
            over.append(1)
    class G:
        def __del__(self): out('G finalized'); done.append(1); ev.set()
    def work(i, cls):
        x = cls(); made[i].set(); go.wait()
        del x
        dropped[i].set(); never.wait()
    for i, name in enumerate(order): start(work, i, {'F': F, 'G': G}[name])
    for e in made: e.wait()
    if beside == 'a deep chain':        # It has nothing to do with the two, dies in the same collection, and is finalized in one round, parents first.
        class Node:
            def __init__(self, next): self.next = next
            def __del__(self): pass
        x = None
        for i in range(6): x = Node(x)
        del x
    if beside == 'a thread that works for a while and ends':     # As long as it works something can move. Nobody goes to sleep when it ends.
        works = threading.Event()
        def work_for_a_while():
            works.set(); e = time.thread_time() + 0.05
            while time.thread_time() < e: pass
        go.set()
        for e in dropped: e.wait()
        start(work_for_a_while); works.wait()
        return
    go.set()
    for e in dropped: e.wait()
    if hands_out: gc.get_objects()      # A collection that only hands out what it finds.
over = []
def collect():
    gc.collect()
    while not over: pass        # (Another thread may have begun it.)
    out('gc.collect() has returned')
def end(): atexit.register(report)      # (With reference counts all is over by now: nothing is said here that would tell.)
# (At exit F says nothing: its thread looks for garbage by itself when it has waited for a while, and if that comes first, it has begun F itself and nobody waits for it.)

def collect_beside_two_that_owe(): two_that_owe('FG', True); collect()
def collect_beside_two_that_owe_the_other_way_round(): two_that_owe('GF', True); collect()
def collect_finds_what_two_have_dropped(): two_that_owe('FG', False); collect()
def collect_finds_what_two_have_dropped_the_other_way_round(): two_that_owe('GF', False); collect()
def collect_beside_two_that_owe_and_a_deep_chain(): two_that_owe('FG', True, 'a deep chain'); collect()
def collect_finds_what_two_have_dropped_and_a_deep_chain(): two_that_owe('FG', False, 'a deep chain'); collect()
def collect_finds_what_two_have_dropped_beside_a_thread_that_ends(): two_that_owe('FG', False, 'a thread that works for a while and ends'); collect()
def collect_beside_two_that_owe_the_first_polls(): two_that_owe('FG', True, how='polls'); collect()       # What has been handed out before is its maker's as ever, who has been told.
def collect_beside_two_that_owe_the_first_spins(): two_that_owe('FG', True, how='spins'); collect()
def exit_finds_what_two_have_dropped_and_a_deep_chain(): sys.setswitchinterval(5); two_that_owe('FG', False, 'a deep chain', says=False); end()
def exit_beside_two_that_owe(): sys.setswitchinterval(5); two_that_owe('FG', True, says=False); end()
def exit_finds_what_two_have_dropped(): sys.setswitchinterval(5); two_that_owe('FG', False, says=False); end()
def exit_finds_what_two_have_dropped_the_other_way_round(): sys.setswitchinterval(5); two_that_owe('GF', False, says=False); end()

def run_out_of_descriptors():
    # A system call that fails for want of descriptors collects, finalizes and is tried again. That collection hands out: the threads that owe are told, and make their calls beside the caller.
    import resource
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, resource.getrlimit(resource.RLIMIT_NOFILE)[1])); files = []
    try:
        while True: files.append(os.open(os.devnull, os.O_RDONLY))
    except OSError as e: error = e
    while not over: pass        # (Another thread may have begun it.)
    out('os.open() raises', type(error).__name__, error.errno)
def out_of_descriptors_beside_two_that_owe_the_first_waits(): two_that_owe('FG', False); run_out_of_descriptors()
def out_of_descriptors_beside_two_that_owe_the_first_polls(): two_that_owe('FG', False, how='polls'); run_out_of_descriptors()
def out_of_descriptors_beside_two_that_owe_the_first_spins(): two_that_owe('FG', False, how='spins'); run_out_of_descriptors()

def waits_for_what_is_dropped_meanwhile():
    # The main thread's own finalizer waits for that of an object that another thread made before, and drops meanwhile.
    go = threading.Event(); began = threading.Event(); ready = threading.Event()
    class Blocks:
        def __del__(self): began.set(); go.wait(); out('Blocks finalized'); over.append(1)
    class Y:
        def __del__(self): out('Y finalized'); go.set()
    def work():
        y = Y(); ready.set(); began.wait()
        del y
        never.wait()
    start(work); ready.wait()
    b = Blocks(); del b
def collect_waits_for_what_is_dropped_meanwhile(): waits_for_what_is_dropped_meanwhile(); collect()
def exit_waits_for_what_is_dropped_meanwhile(): waits_for_what_is_dropped_meanwhile(); end()

def waits_in_a_way_that_nobody_sees_for_what_falls_due_later(then, how):
    # As above, but the finalizer polls, spins, or reads a pipe: it can move, for all that anybody can tell. What it waits for falls due only when it has begun: that is its maker's as ever.
    began = threading.Event(); ready = threading.Event(); done = []; r, w = os.pipe()
    class Slow:
        def __del__(self):
            began.set()
            if how == 'polls':
                while not done: time.sleep(0.01)
            elif how == 'spins':
                while not done: pass
            else: os.read(r, 1)
            out('Slow finalized'); over.append(1)
    class Y:
        def __del__(self): out('Y finalized'); done.append(1); os.write(w, b'x')
    def work():
        y = Y(); ready.set(); began.wait()
        del y
        never.wait()
    start(work); ready.wait()
    b = Slow(); del b
    then()
def collect_polls_for_what_falls_due_later(): waits_in_a_way_that_nobody_sees_for_what_falls_due_later(collect, 'polls')
def collect_spins_for_what_falls_due_later(): waits_in_a_way_that_nobody_sees_for_what_falls_due_later(collect, 'spins')
def collect_reads_a_pipe_for_what_falls_due_later(): waits_in_a_way_that_nobody_sees_for_what_falls_due_later(collect, 'reads')
def exit_polls_for_what_falls_due_later(): waits_in_a_way_that_nobody_sees_for_what_falls_due_later(end, 'polls')
def exit_spins_for_what_falls_due_later(): waits_in_a_way_that_nobody_sees_for_what_falls_due_later(end, 'spins')
def exit_reads_a_pipe_for_what_falls_due_later(): waits_in_a_way_that_nobody_sees_for_what_falls_due_later(end, 'reads')

def exit_beside_a_daemon_inside_collect():
    # What the main thread made and dropped is finalized before the callbacks of atexit, whatever another thread's gc.collect() is stuck in.
    inside = threading.Event()
    class Blocks:
        def __del__(self): inside.set(); never.wait()
    class X:
        def __del__(self): out('X finalized')
    def work():
        b = Blocks(); del b
        gc.collect()
    x = X(); start(work); inside.wait()
    del x
    end()

def the_maker_has_a_lock_in_its_hand(then, how):
    # A thread makes X, hands it on, takes a plain lock, and goes on with it until X's finalizer has begun. The main thread drops X, whose finalizer wants the lock, and before that other objects, whose
    # finalizers let go of the GIL, or really wait: to start a thread is to wait for an event. With reference counts the main thread runs X's finalizer, and has the lock when the thread lets go of it.
    # In the thread itself it would never get it.
    lock = threading.Lock(); box = []; holds = []; begun = []; log = []; null = os.open(os.devnull, os.O_WRONLY)
    class X:
        def __del__(self):
            log.append('X begins in ' + threading.current_thread().name); begun.append(1)
            with lock: log.append('X has the lock')
            over.append(1)
    class P:
        def __del__(self):
            if how == 'write': os.write(null, b'x')
            elif how == 'read a file':
                with open('/proc/self/stat', 'rb', buffering=0) as f: f.read(64)
            elif how == 'sleep': time.sleep(0.001)
            else: threading.Thread(target=int).start()
    def work():
        box.append(X())
        with lock:
            holds.append(1)
            while not begun: pass
            log.append('the thread lets go of the lock')
        never.wait()
    ps = [P() for _ in range(20)]
    start(work)
    while not holds: pass
    del ps; box.clear()
    if then == 'exit': atexit.register(lambda: out(log))
    else: gc.collect(); out(log)
def collect_beside_a_maker_with_a_lock_others_write(): the_maker_has_a_lock_in_its_hand('collect', 'write')
def collect_beside_a_maker_with_a_lock_others_read_a_file(): the_maker_has_a_lock_in_its_hand('collect', 'read a file')
def collect_beside_a_maker_with_a_lock_others_sleep(): the_maker_has_a_lock_in_its_hand('collect', 'sleep')
def collect_beside_a_maker_with_a_lock_others_start_a_thread(): the_maker_has_a_lock_in_its_hand('collect', 'start a thread')
def exit_beside_a_maker_with_a_lock_others_write(): the_maker_has_a_lock_in_its_hand('exit', 'write')
def exit_beside_a_maker_with_a_lock_others_read_a_file(): the_maker_has_a_lock_in_its_hand('exit', 'read a file')
def exit_beside_a_maker_with_a_lock_others_sleep(): the_maker_has_a_lock_in_its_hand('exit', 'sleep')
def exit_beside_a_maker_with_a_lock_others_start_a_thread(): the_maker_has_a_lock_in_its_hand('exit', 'start a thread')

def all_are_over(then):
    # A thread has dropped fifty objects and sits idle. Each finalizer starts a thread. All of them are over when gc.collect() returns, and before the callbacks of atexit.
    import socket
    count = []; ready = []; a, b = socket.socketpair()
    class S:
        def __del__(self): threading.Thread(target=int).start(); count.append(1)
    def work():
        l = [S() for _ in range(50)]; del l
        ready.append(1); a.recv(1)       # (It does not look for garbage by itself there.)
    start(work)
    while not ready: pass
    if then == 'exit': atexit.register(lambda: out(len(count), 'of 50'))
    else: gc.collect(); out(len(count), 'of 50')
def collect_beside_an_idle_maker_of_finalizers_that_start_a_thread(): all_are_over('collect')
def exit_beside_an_idle_maker_of_finalizers_that_start_a_thread(): all_are_over('exit')

def in_order(shape, how, hands_out):
    # A chain of six, which is finalized in one round, parents first, or a cycle of six. Each finalizer takes a while. A thread has made and dropped them, and waits.
    log = []; running = [0]; overlaps = [0]; ready = threading.Event()
    class Node:
        def __init__(self, i, next): self.i = i; self.next = next
        def __del__(self):
            overlaps[0] += running[0]; running[0] += 1; log.append(self.i)
            if how == 'sleeps': time.sleep(0.02)
            else:
                e = time.thread_time() + 0.02
                while time.thread_time() < e: pass
            running[0] -= 1; over.append(1)
    def work():
        x = last = None
        for i in reversed(range(6)):
            x = Node(i, x); last = last or x
        if shape == 'cycle': last.next = x
        del x, last
        ready.set(); never.wait()
    start(work); ready.wait()
    if hands_out: gc.get_objects()
    gc.collect()
    while len(over) < 6: pass
    out('begun while another was running:', overlaps[0], '| order:', log)
def chain_each_sleeps(): in_order('chain', 'sleeps', False)
def chain_each_works(): in_order('chain', 'works', False)
def chain_each_sleeps_handed_out_before(): in_order('chain', 'sleeps', True)
def chain_each_works_handed_out_before(): in_order('chain', 'works', True)
def cycle_each_sleeps(): in_order('cycle', 'sleeps', False)
def cycle_each_works(): in_order('cycle', 'works', False)

def callback_in_the_middle(shape):
    # No other thread. The first finalizer of a cycle of three, or of a chain of six, drops an object to which there is a weak reference with a callback, and a collection comes before it returns.
    log = []; keep = []
    class Plain: pass
    class N:
        def __init__(self, i, next=None): self.i = i; self.next = next
        def __del__(self):
            log.append('del %d' % self.i)
            if not self.i:
                p = Plain(); keep.append(weakref.ref(p, lambda r: log.append('callback'))); del p
                gc.get_objects()
    if shape == 'cycle':
        a = N(0); b = N(1, a); c = N(2, b); a.next = c
        del a, b, c
    else:
        x = None
        for i in reversed(range(6)): x = N(i, x)
        del x
    gc.collect(); out(log)
def callback_in_the_middle_of_a_cycle(): callback_in_the_middle('cycle')
def callback_in_the_middle_of_a_chain(): callback_in_the_middle('chain')

def callbacks_for_two_objects(hands_out):
    # One thread has made a weak reference to each of two objects that have nothing to do with each other. Two other threads drop them. The callback for the one waits for what the callback for the other does.
    class O: pass
    ev = threading.Event(); go = threading.Event(); made = threading.Event(); dropped = [threading.Event(), threading.Event()]; begun = []; refs = []; box = [[O()], [O()]]
    def sets(r): ev.set()
    def waits(r): begun.append(1); ev.wait(); over.append(1)
    def make(): refs.append(weakref.ref(box[0][0], sets)); refs.append(weakref.ref(box[1][0], waits)); made.set(); never.wait()
    def drop(i): go.wait(); box[i].clear(); dropped[i].set(); never.wait()
    start(make); made.wait()
    for i in (0, 1): start(drop, i)
    go.set()
    for e in dropped: e.wait()
    if hands_out:
        gc.get_objects()
        while not begun: pass
    collect()
def callbacks_for_two_objects_handed_out_before(): callbacks_for_two_objects(True)
def callbacks_for_two_objects_found(): callbacks_for_two_objects(False)

def callbacks_for_one_object():
    # No other thread. The references to one object are told of its death latest first, whatever else has been made in between.
    class O: pass
    log = []; a = O(); b = O()
    refs = [weakref.ref(a, lambda r: log.append('a1')), weakref.ref(b, lambda r: log.append('b1')), weakref.ref(a, lambda r: log.append('a2')), weakref.ref(b, lambda r: log.append('b2')), weakref.ref(a, lambda r: log.append('a3'))]
    del a
    gc.collect(); out(log)
    del b
    gc.collect(); out(log)

def callbacks_for_several_objects():
    # No other thread. One collection finds all of them dead. The references are told latest first (which is the order in which the objects are dropped here, and the references to each were made in a row).
    class O: pass
    for made, dropped in ('b1 a1 a2', 'ab'), ('b1 b2 a1 a2 a3', 'ab'), ('c1 c2 b1 b2 a1 a2', 'abc'):
        objects = {name: O() for name in dropped}; log = []
        refs = [weakref.ref(objects[what[0]], lambda r, what=what: log.append(what)) for what in made.split()]
        for name in dropped: del objects[name]
        gc.collect(); out(made, '|', ' '.join(log))

def falls_due_in_the_middle(program, first, waits={}, maker='the thread that drops'):
    # One thread makes all the calls. `program`: what the callback of a name drops: objects, each with so many weak references; a collection comes before the callback returns. With reference counts all
    # that is dealt with inside the callback. (The references to what is dropped first are made last: so they are told in the order of the dropping.)
    class O: pass
    log = []; keep = []; told = {}; alive = {}
    def make(lot):
        for name, count in reversed(lot):
            alive[name] = O()
            for i in range(1, count + 1): keep.append(weakref.ref(alive[name], lambda r, what='%s%d' % (name, i): call(what)))
    def drop(lot):
        if maker == 'the thread that drops': make(lot)
        for name, count in lot: del alive[name]
    def call(what):
        log.append(what); told.setdefault(what, threading.Event()).set()
        for other in waits.get(what, ()): told.setdefault(other, threading.Event()).wait()
        if what in program: drop(program[what]); gc.get_objects()
    if maker == 'another thread':       # It has made all the references beforehand, and sits idle: the callbacks are its own to make, and gc.collect() makes them.
        made = threading.Event()
        def make_all():
            for lot in [first] + list(program.values()): make(lot)
            made.set(); never.wait()
        start(make_all); made.wait(); sys.setswitchinterval(5)
    drop(first)
    gc.collect(); out(' '.join(log))
programs = [({'a2': [('p', 1)]}, [('a', 2)]), ({'a2': [('p', 1)]}, [('a', 2), ('b', 2)]), ({'a2': [('p', 1), ('q', 1)]}, [('a', 2)]), ({'a2': [('p', 2), ('q', 1)]}, [('a', 2)]),
            ({'a2': [('p', 2), ('q', 1)], 'p2': [('r', 1)]}, [('a', 2)]), ({'a3': [('p', 2)], 'p2': [('r', 2), ('s', 1)], 'a2': [('t', 1)]}, [('a', 3), ('b', 1)]),
            ({'a1': [('p', 1)]}, [('a', 1), ('c', 1)]), ({'a1': [('p', 1)], 'p1': [('r', 1)]}, [('a', 1), ('c', 2)])]
def callbacks_that_fall_due_in_the_middle():
    for program, first in programs: falls_due_in_the_middle(program, first)
    # Cyclic garbage with finalizers, and a weak reference to each of the two. (Which of the two is told first differs: they have one name here.)
    log = []; keep = []
    class Plain: pass
    class C:
        def __init__(self, n): self.n = n
        def __del__(self): log.append('del %d' % self.n)
    def told(r):
        log.append('callback')
        if len(log) == 1:
            x = Plain(); keep.append(weakref.ref(x, lambda r: log.append('x'))); del x
            gc.get_objects()
    c1 = C(1); c2 = C(2); c1.other = c2; c2.other = c1; keep += [weakref.ref(c1, told), weakref.ref(c2, told)]
    del c1, c2
    gc.collect(); out(' '.join(log))
def callbacks_of_an_idle_thread_that_fall_due_in_the_middle():
    for program, first in programs: falls_due_in_the_middle(program, first, maker='another thread')
def a_callback_waits_for_what_has_fallen_due_before_it():
    start(never.wait)       # (So that a wait is a wait.)
    falls_due_in_the_middle({'a2': [('p', 1), ('q', 1)]}, [('a', 2), ('b', 1)], {'a1': ('p1', 'q1')})
    falls_due_in_the_middle({'a2': [('p', 2), ('q', 1)], 'p2': [('r', 1)]}, [('a', 2)], {'p1': ('r1',), 'a1': ('q1',)})
    falls_due_in_the_middle({'a1': [('p', 1)]}, [('a', 1), ('c', 1)], {'c1': ('p1',)})

def an_older_finalizer_and_a_younger_callback():
    # An idle thread has made x. The main thread drops it, and a collection hands it out. Then the main thread drops something of its own to which there is a weak reference with a callback, and calls gc.collect().
    # What was found earlier comes first.
    log = []; box = {}; made = threading.Event()
    class X:
        def __del__(self): log.append('x')
    class Plain: pass
    def make(): box['x'] = X()
    def work(): make(); made.set(); never.wait()
    start(work); made.wait(); sys.setswitchinterval(5)
    own = Plain(); r = weakref.ref(own, lambda r: log.append('callback'))
    del box['x']; gc.get_objects()
    del own
    gc.collect(); out(' '.join(log))

def the_order_of_the_other_threads():
    # Two idle threads have made objects with finalizers: the first x, the second f0 and y. The main thread drops f0 and calls gc.collect(); drops x, and a collection hands it out; drops y, and a collection hands it
    # out; and calls gc.collect(), which takes what others owe thread by thread: in the order in which they came to owe, not in that in which something of theirs was first found.
    log = []; alive = {}
    class F:
        def __init__(self, name): self.name = name
        def __del__(self): log.append(self.name)
    def make(names):
        for name in names: alive[name] = F(name)
    def idle(names, up): make(names); up.set(); never.wait()
    for names in ('x',), ('f0', 'y'): up = threading.Event(); start(idle, names, up); up.wait()
    gc.collect(); sys.setswitchinterval(5)
    del alive['f0']; gc.collect()
    del alive['x']; gc.get_objects()
    del alive['y']; gc.get_objects()
    gc.collect(); out(' '.join(log))

def cyclic_garbage_of_several_makers():
    # Threads have made objects by turns, each a cycle of its own with a finalizer, and sit idle. The main thread drops them all and calls gc.collect(): in the order in which they were made, whoever made them.
    gc.disable()        # (A collection of CPython's own that sees them alive may turn its lists round.)
    for makers in (1, 2, 1, 2), (1, 2, 0, 1, 2, 0), (1, 1, 2, 0, 2, 1, 0, 2):
        log = []; alive = []; turn = [0]
        class C:
            def __init__(self, name): self.name = name; self.me = self
            def __del__(self): log.append(self.name)
        def make(i): alive.append(C('c%d' % (i + 1)))
        def work(me):
            for i, maker in enumerate(makers):
                if maker == me:
                    while turn[0] < i: pass
                    make(i); turn[0] += 1
            if me: never.wait()
        sys.setswitchinterval(0.0001); start(work, 1); start(work, 2); work(0)
        while turn[0] < len(makers): pass
        gc.collect(); sys.setswitchinterval(5)
        alive.clear(); gc.collect(); out(' '.join(log))

def exit_makes_a_call_that_drops_what_an_idle_thread_has_a_later_reference_to():
    # The main thread has made two references to a; then an idle thread one to x. The main thread drops a, and ends. The callback that comes first drops x, and a collection comes then and there.
    # (The sockets have finalizers: with nothing to finalize the exit looks for nothing.)
    import socket
    log = []; alive = {}; refs = []; made = threading.Event(); s = socket.socketpair()
    class O: pass
    alive['a'] = O(); alive['x'] = O()
    def a2(r): log.append('a2'); del alive['x']; gc.get_objects()
    refs.append(weakref.ref(alive['a'], lambda r: log.append('a1'))); refs.append(weakref.ref(alive['a'], a2))
    def idle(): refs.append(weakref.ref(alive['x'], lambda r: log.append('x'))); made.set(); s[0].recv(1)
    start(idle); made.wait()
    gc.collect(); sys.setswitchinterval(5)
    del alive['a']
    atexit.register(lambda: out(' '.join(log)))

def exit_gives_back_much():
    # Two threads have each dropped an object, and wait; F waits for what G does; and the maker of G has dropped 200 more, each with a finalizer that works for a while. The main thread ends, and finds them all. When
    # nothing can move any more the makers get their calls back, and share them with the main thread. (Nobody waits for the last, if it is the maker's.)
    ev = threading.Event(); go = threading.Event(); made = [threading.Event(), threading.Event()]; dropped = [threading.Event(), threading.Event()]; are_over = []
    class F:
        def __del__(self): ev.wait()
    class G:
        def __del__(self): ev.set()
    class One:
        def __del__(self):
            e = time.thread_time() + 0.001
            while time.thread_time() < e: pass
            are_over.append(1)
    def work(i, cls):
        x = cls(); more = [One() for _ in range(200)] if i else None
        made[i].set(); go.wait()
        del x, more
        dropped[i].set(); never.wait()
    for i, cls in enumerate((F, G)): start(work, i, cls); made[i].wait()
    go.set()
    for e in dropped: e.wait()
    atexit.register(lambda: out('all but one at the most are over:', len(are_over) >= 199))

def after_a_give_back_at_exit(how):
    # The main thread has made F and P, another G and Y (or, in place of Y, a chain of six). All are dropped, and the main thread ends. F waits for what G does: nothing can move: what has not been begun is given back.
    # G lets F go on and does not end before P has begun: so the main thread goes on while nobody has begun Y. P waits for what Y does, in a way that nobody sees, or that everybody sees. Y is its maker's still.
    sys.setswitchinterval(5)        # Whoever has the GIL keeps it until it lets go of it by itself.
    log = []; g_done = threading.Event(); y_done = threading.Event(); go = threading.Event(); made = threading.Event(); dropped = threading.Event(); p_begun = threading.Event(); about_to_drop = threading.Event()
    class F:
        def __del__(self): log.append('F begins'); g_done.wait(); log.append('F ends')
    class P:
        def __del__(self):
            log.append('P begins'); p_begun.set()
            # (Only where F has waited for G: then what G's maker owes has been given back. If a collection finds F later than P, or G earlier than the rest, nothing has been: Y is the main thread's to make, behind
            # this call, and a call that polls for it never ends.)
            if 'F begins' not in log or 'G begins' not in log or log.index('G begins') < log.index('F begins'): pass
            elif how == 'polls':
                while not y_done.is_set(): time.sleep(0.005)
            elif how == 'waits': y_done.wait()
            log.append('P ends')
    class G:
        def __del__(self):
            log.append('G begins'); g_done.set()
            # (At exit the main thread may come to make this call itself: then P, which is its own, cannot begin before this has ended.)
            if threading.current_thread() is maker[0]: p_begun.wait()
            log.append('G ends')
    class Y:
        def __del__(self): log.append('Y'); y_done.set()
    class Link:
        def __init__(self, i, next): self.i, self.next = i, next
        def __del__(self):
            if not self.i: time.sleep(0.05)
            chain.append(self.i)
    chain = []
    def links():
        x = None
        for i in range(5, -1, -1): x = Link(i, x)
        return x
    mine = [F(), P()]
    maker = []
    def work():
        maker.append(threading.current_thread())
        l = [G(), links() if how == 'chain' else Y()]
        made.set(); go.wait()
        about_to_drop.set(); del l[0]; del l[0]     # (It keeps the GIL from here until it waits.)
        dropped.set(); never.wait()
    start(work); made.wait()
    # (In which order what two threads do at once is noted is a matter of chance. And nobody waits for G, which its maker has begun: not even he who waits for Y, which the main thread makes itself if P is found a
    # collection later than the rest.)
    atexit.register(lambda: out(sorted(l for l in log if l != 'G ends'), chain))
    # Not before the other thread is about to drop its own: if that is slow to wake, the main thread, waiting, looks for garbage by itself, finds F and makes it on top of its wait; and while it is
    # stuck in there no thread that waits looks for garbage, so nobody ever finds G.
    go.set(); about_to_drop.wait()
    del mine[0]; del mine[0]
    dropped.wait()
def exit_polls_after_a_give_back(): after_a_give_back_at_exit('polls')
def exit_waits_after_a_give_back(): after_a_give_back_at_exit('waits')
def exit_makes_a_chain_after_a_give_back(): after_a_give_back_at_exit('chain')

def the_thread_whose_group_is_in_another_hand_ends():
    # T has made a chain of six, U a single object; T came to owe before U did. A third thread, not the main one, drops both, a collection hands them out, and it calls gc.collect(): it begins the chain, and has the rest
    # of it in its hand, which stands at T's queue. The first finalizer lets T run to its end, and waits for that. The rest of the chain still comes before what U owes.
    import socket
    log = []; alive = {}; threads = {}; t_go = threading.Event(); done = threading.Semaphore(0); pair = socket.socketpair()
    go = {t: threading.Semaphore(0) for t in ('T', 'U')}; tasks = {t: [] for t in go}
    class F:
        def __init__(self, name, next=None): self.name = name; self.next = next
        def __del__(self):
            log.append(self.name)
            if self.name == 'A0': t_go.set(); threads['T'].join(); log.append('(T has ended)')
    def make(name, n):
        x = None
        for i in range(n - 1, -1, -1): x = F('%s%d' % (name, i) if n > 1 else name, x)
        alive[name] = x
    def idle(t):
        while True:
            go[t].acquire()
            if not tasks[t]: break
            make(*tasks[t].pop(0)); done.release()
        done.release()
        if t == 'T': t_go.wait()
        else: pair[0].recv(1, socket.MSG_WAITALL)       # (It is not fetched out of that.)
    def by(t, *task): tasks[t].append(task); go[t].release(); done.acquire()
    for t in go: threads[t] = threading.Thread(target=idle, args=(t,), daemon=True); threads[t].start()
    for t in ('T', 'U'): by(t, 'first', 1); del alive['first']; gc.get_objects(); gc.collect(); gc.collect()
    by('T', 'A', 6); by('U', 'u', 1)
    for t in go: go[t].release(); done.acquire()
    gc.collect(); gc.collect(); sys.setswitchinterval(100)
    def serve():
        del alive['A']; del alive['u']
        gc.get_objects(); gc.collect()
        out(' '.join(l for l in log if l != 'first')); os._exit(0)       # (Its maker may have begun a 'first', and nobody waits for that.)
    start(serve); never.wait()

def references_of_two_threads_to_one_object():
    # Two threads have made weak references to one object by turns, and sit idle. The main thread drops the object. The references are told latest first, whoever made them.
    import socket
    class O: pass
    o = O(); log = []; refs = []; a, b = socket.socketpair()
    def make(mine):
        for i in mine:
            while len(refs) < i: pass
            refs.append(weakref.ref(o, lambda r, i=i: log.append(i)))
        a.recv(1)       # (It does not look for garbage by itself there.)
    start(make, (0, 2, 3, 5)); start(make, (1, 4))
    while len(refs) < 6: pass
    del o
    gc.collect(); out(log)

scenes = [collect_beside_two_that_owe, collect_beside_two_that_owe_the_other_way_round, collect_finds_what_two_have_dropped, collect_finds_what_two_have_dropped_the_other_way_round,
          collect_beside_two_that_owe_and_a_deep_chain, collect_finds_what_two_have_dropped_and_a_deep_chain, collect_finds_what_two_have_dropped_beside_a_thread_that_ends,
          collect_beside_two_that_owe_the_first_polls, collect_beside_two_that_owe_the_first_spins, exit_finds_what_two_have_dropped_and_a_deep_chain,
          exit_beside_two_that_owe, exit_finds_what_two_have_dropped, exit_finds_what_two_have_dropped_the_other_way_round, collect_waits_for_what_is_dropped_meanwhile,
          exit_waits_for_what_is_dropped_meanwhile, exit_beside_a_daemon_inside_collect,
          collect_polls_for_what_falls_due_later, collect_spins_for_what_falls_due_later, collect_reads_a_pipe_for_what_falls_due_later,
          exit_polls_for_what_falls_due_later, exit_spins_for_what_falls_due_later, exit_reads_a_pipe_for_what_falls_due_later,
          collect_beside_a_maker_with_a_lock_others_write, collect_beside_a_maker_with_a_lock_others_read_a_file, collect_beside_a_maker_with_a_lock_others_sleep,
          collect_beside_a_maker_with_a_lock_others_start_a_thread,
          exit_beside_a_maker_with_a_lock_others_write, exit_beside_a_maker_with_a_lock_others_read_a_file, exit_beside_a_maker_with_a_lock_others_sleep,
          exit_beside_a_maker_with_a_lock_others_start_a_thread,
          collect_beside_an_idle_maker_of_finalizers_that_start_a_thread, exit_beside_an_idle_maker_of_finalizers_that_start_a_thread,
          chain_each_sleeps, chain_each_works, chain_each_sleeps_handed_out_before, chain_each_works_handed_out_before, cycle_each_sleeps, cycle_each_works,
          callback_in_the_middle_of_a_cycle, callback_in_the_middle_of_a_chain,
          out_of_descriptors_beside_two_that_owe_the_first_waits, out_of_descriptors_beside_two_that_owe_the_first_polls, out_of_descriptors_beside_two_that_owe_the_first_spins,
          callbacks_for_two_objects_handed_out_before, callbacks_for_two_objects_found, callbacks_for_one_object, callbacks_for_several_objects,
          references_of_two_threads_to_one_object, callbacks_that_fall_due_in_the_middle, callbacks_of_an_idle_thread_that_fall_due_in_the_middle,
          a_callback_waits_for_what_has_fallen_due_before_it, an_older_finalizer_and_a_younger_callback, the_order_of_the_other_threads, cyclic_garbage_of_several_makers,
          exit_makes_a_call_that_drops_what_an_idle_thread_has_a_later_reference_to, exit_gives_back_much, exit_polls_after_a_give_back, exit_waits_after_a_give_back, exit_makes_a_chain_after_a_give_back,
          the_thread_whose_group_is_in_another_hand_ends]
if len(sys.argv) > 1:
    faulthandler.dump_traceback_later(50, exit=True)    # Whatever becomes of the parent.
    {f.__name__: f for f in scenes}[sys.argv[1]]()
else:
    # One limit for the whole test, below that of whoever runs it (60 s; 300 s for a build with assertions, which takes seconds to start): it goes by how long this build takes to start.
    a = time.monotonic(); subprocess.run([sys.executable, '-c', 'import atexit, faulthandler, gc, subprocess, threading, weakref']); limit = time.monotonic() + min(25 + 100 * (time.monotonic() - a), 240)
    for first in range(0, len(scenes), 8):
        if time.monotonic() > limit:        # (Or what is wrong with one scene would look like something wrong with all that follow.)
            for f in scenes[first:first + 8]: print('%s: NOT RUN: the time of the whole test is up' % f.__name__)
            continue
        children = [(f.__name__, subprocess.Popen([sys.executable, __file__, f.__name__], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)) for f in scenes[first:first + 8]]
        for name, child in children:
            try: text = child.communicate(timeout=max(0.2, limit - time.monotonic()))[0].decode(); status = child.returncode
            except subprocess.TimeoutExpired: child.kill(); text = child.communicate()[0].decode(); status = 'KILLED: it did not end'
            print('%s: status %s' % (name, status))
            for line in text.splitlines(): print('   ', line)
