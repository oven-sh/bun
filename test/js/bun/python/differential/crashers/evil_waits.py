# What waits for other threads (locks, joins, queues, sleeps), called with odd arguments and from odd places: finalizers, trace functions,
# signal handlers, comparisons inside sort(), at the recursion limit, with exceptions pending, with signals arriving meanwhile.
# Each case must end in a result or an exception, never in a crash, and none may hang.
import sys, gc, threading, _thread, time, signal, functools, operator, queue, _queue, itertools, collections, weakref, select, os

GROUP = sys.argv[1] if len(sys.argv) > 1 else None
def outcome(f):
    try:
        r = f()
        return "ok " + repr(r)[:100]
    except (RecursionError, MemoryError) as e:
        return type(e).__name__
    except BaseException as e:
        return type(e).__name__ + ": " + str(e)[:100]
CASES = []
def case(name):
    def register(f):
        CASES.append((name, f))
        return f
    return register
def collect():
    for _ in range(3): gc.collect()
def later(seconds, f, *args):
    t = threading.Timer(seconds, f, args); t.daemon = True; t.start()
    return t
def held(kind=_thread.allocate_lock):
    lock = kind(); lock.acquire()
    return lock
def held_by_thread(kind=threading.RLock):
    lock = kind(); ready = threading.Event(); done = threading.Event()
    def hold():
        with lock:
            ready.set(); done.wait(20)
    t = threading.Thread(target=hold, daemon=True); t.start(); ready.wait(10)
    return lock, done, t

class Evil:
    def __init__(self, action, value): self.action, self.value = action, value
    def __index__(self): self.action(); return int(self.value)
    def __float__(self): self.action(); return float(self.value)
    def __bool__(self): self.action(); return bool(self.value)
    __int__ = __index__

ODD = [None, -1, 0, 1e-9, -0.5, -2, 1e100, float("inf"), float("-inf"), float("nan"), 2 ** 31, 2 ** 63, 2 ** 64, -2 ** 63, 10 ** 30, "1", b"1", [], (), 1j, True, False, object(), 9223372036.0, 9223372037, threading.TIMEOUT_MAX, threading.TIMEOUT_MAX * 2]

@case("free lock, odd arguments")
def _():
    rs = []
    for a in ODD:
        for b in ODD:
            lock = _thread.allocate_lock()
            rs.append(outcome(lambda: lock.acquire(a, b))[:24])
    return collections.Counter(rs).most_common(8)

@case("held lock, odd arguments that do not wait long")
def _():
    rs = []
    for args in [(False,), (0,), (False, -1), (True, 0), (True, 0.001), (1, 1e-9), (True, 0.0), ("", ), ([],), (None,), (True, -0.0)] + [(False, b) for b in ODD] + [(True, b) for b in ODD if not isinstance(b, (int, float)) or b != b or (b < 0 and b != -1)]:
        for lock in (held(), held_by_thread()[0]):
            rs.append(outcome(lambda: lock.acquire(*args))[:30])
    return collections.Counter(rs).most_common(8)

@case("keywords")
def _():
    lock = held()
    return [outcome(lambda kw=kw: lock.acquire(**kw))[:50] for kw in ({"blocking": False}, {"timeout": 0.001}, {"blocking": True, "timeout": 0.001}, {"timeout": 0.001, "blocking": 1}, {"x": 1}, {"blocking": False, "timeout": 1}, {"timeout": None}, {"timeout": "a"})]

for name, action in (("releases", lambda lock: lock.release()), ("collects", lambda lock: collect()), ("raises", lambda lock: 1 / 0), ("acquires without waiting", lambda lock: lock.acquire(False)), ("waits itself", lambda lock: lock.acquire(True, 0.01)),
                     ("starts a thread that releases", lambda lock: threading.Thread(target=lock.release).start()), ("sleeps", lambda lock: time.sleep(0.01))):
    @case("argument that " + name)
    def _(action=action):
        rs = []
        for make in (lambda a: (Evil(a, 1), 0.05), lambda a: (True, Evil(a, 0.05)), lambda a: (Evil(a, 1), Evil(a, 0.05)), lambda a: (Evil(a, 0),)):
            lock = held()
            rs.append(outcome(lambda: lock.acquire(*make(lambda: action(lock))))[:40])
        return rs

@case("through odd call paths")
def _():
    rs = []
    def paths(lock):
        yield lambda: functools.partial(lock.acquire, True, 0.01)()
        yield lambda: list(map(lock.acquire, [True], [0.01]))
        yield lambda: lock.acquire.__call__(True, 0.01)
        yield lambda: type(lock).acquire(lock, True, 0.01)
        yield lambda: operator.methodcaller("acquire", True, 0.01)(lock)
        yield lambda: operator.call(lock.acquire, True, 0.01)
        yield lambda: lock.acquire(*[True, 0.01])
        yield lambda: lock.acquire(*(True,), **{"timeout": 0.01})
        yield lambda: sorted([2, 1], key=lambda x: lock.acquire(True, 0.01))
        yield lambda: max([2, 1], key=lambda x: lock.acquire(True, 0.01))
        yield lambda: [lock.acquire(True, 0.01) for _ in range(2)]
        yield lambda: list(lock.acquire(True, 0.01) for _ in range(2))
        yield lambda: functools.reduce(lambda a, b: lock.acquire(True, 0.01), [1, 2, 3])
        yield lambda: eval("a(True, 0.01)", {"a": lock.acquire})
        yield lambda: type("T", (), {"__getattr__": lambda s, n: lock.acquire(True, 0.01)})().x
        yield lambda: type("T", (), {"__eq__": lambda s, o: lock.acquire(True, 0.01)})() == 1
        yield lambda: {type("T", (), {"__hash__": lambda s: int(lock.acquire(True, 0.01))})(): 1} and 1
        yield lambda: str(type("T", (), {"__str__": lambda s: str(lock.acquire(True, 0.01))})())
        yield lambda: getattr(lock, "acquire_lock", lock.acquire)(True, 0.01)
    for kind in (held, lambda: held_by_thread()[0]):
        for f in paths(kind()): rs.append(outcome(f)[:20])
    return collections.Counter(rs).most_common(6)

@case("with statement on a lock that a finalizer releases")
def _():
    lock = held()
    class D:
        def __del__(self): lock.release()
    def drop(): D()
    drop()
    with lock: return "entered"

@case("acquire waits for a finalizer in a cycle")
def _():
    lock = held()
    class D:
        def __init__(self): self.me = self
        def __del__(self): lock.release()
    D()
    return lock.acquire(True, 20)

@case("SimpleQueue.get waits for a finalizer")
def _():
    q = _queue.SimpleQueue()
    class D:
        def __init__(self): self.me = self
        def __del__(self): q.put("from finalizer")
    D()
    return q.get(True, 20)

@case("finalizer waits for a lock that the main thread holds")
def _():
    lock = held(); log = []
    class D:
        def __del__(self): log.append(outcome(lambda: lock.acquire(True, 0.05)))
    D(); collect()
    return log

@case("finalizer waits for ever for what nobody will release")
def _():
    lock = held(); log = []
    class D:
        def __init__(self): self.me = self
        def __del__(self): log.append(outcome(lambda: lock.acquire(True, 0.2))[:30])
    D()
    other = held()
    r = outcome(lambda: other.acquire(True, 0.5))
    collect()
    return r, log

@case("nobody can release: lock, RLock of another thread that ended, join of itself")
def _():
    rs = [outcome(lambda: threading.current_thread().join(0.01))[:40], outcome(lambda: threading.current_thread().join())[:40]]
    t = threading.Thread(target=lambda: None)
    rs.append(outcome(lambda: t.join(0.01))[:40])
    box = []
    t = threading.Thread(target=lambda: box.append(held(threading.RLock))); t.start(); t.join()
    rs.append(outcome(lambda: box[0].acquire(True, 0.05)))
    rs.append(outcome(lambda: box[0].release())[:40])
    return rs

@case("thread handles")
def _():
    rs = []
    done = threading.Event()
    h = _thread.start_joinable_thread(lambda: done.wait(10))
    for a in ODD:
        if a is None or (isinstance(a, (int, float)) and not isinstance(a, bool) and (a > 1 or a < 0)): continue
        rs.append(outcome(lambda: h.join(a))[:30])
    done.set()
    rs += [outcome(h.join), outcome(h.join), outcome(lambda: h.join(0)), outcome(h.is_done), outcome(lambda: type(h)())[:30], outcome(lambda: type(h).__new__(type(h)).join(0))[:40], outcome(lambda: h._set_done())[:30], outcome(h.join)]
    return collections.Counter(rs).most_common(8)

@case("join from the finalizer of the thread's own target")
def _():
    log = []
    class D:
        def __del__(self): log.append(outcome(lambda: box[0].join(0.05))[:40])
    def target(d=D()): pass
    box = [threading.Thread(target=target)]
    del target
    box[0].start(); box[0].join()
    box[0]._target = None
    collect()
    return log

# ---- Trace functions ----

@case("trace function waits at every event")
def _():
    lock = held(); n = [0]
    def trace(frame, event, arg):
        n[0] += 1
        lock.acquire(True, 0.0005)
        return trace
    def work():
        other = held()
        return other.acquire(True, 0.01), sum(i for i in range(5))
    sys.settrace(trace)
    try: r = work()
    finally: sys.settrace(None)
    return r, n[0] > 5

@case("profile function raises while a wait is about to begin again")
def _():
    lock = held(); n = [0]
    def profile(frame, event, arg):
        n[0] += 1
        if event in ("c_call", "c_return", "c_exception") and n[0] % 2: raise KeyError(event)
    rs = []
    sys.setprofile(profile)
    try:
        for _ in range(6): rs.append(outcome(lambda: lock.acquire(True, 0.01))[:24])
    finally: sys.setprofile(None)
    return sorted(set(rs))

@case("sys.monitoring CALL and C_RETURN around waits")
def _():
    M = sys.monitoring; E = M.events; lock = held(); seen = collections.Counter()
    M.use_tool_id(3, "t")
    for e in (E.CALL, E.C_RETURN, E.C_RAISE): M.register_callback(3, e, lambda *a, e=e: seen.update([e]))
    M.set_events(3, E.CALL | E.C_RETURN | E.C_RAISE)
    try:
        r = lock.acquire(True, 0.02), outcome(lambda: lock.acquire(True, "x"))[:10]
    finally:
        M.set_events(3, 0); M.free_tool_id(3)
    return r, seen[E.CALL] >= 2, seen[E.C_RETURN] >= 1

# ---- Signals ----

def with_handler(handler, f, delay=0.05, signum=signal.SIGALRM):
    old = signal.signal(signum, handler)
    signal.setitimer(signal.ITIMER_REAL, delay)
    try: return outcome(f)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0); signal.signal(signum, old)

def raiser(*a): raise KeyError("from handler")

WAITS = [("lock", lambda: held().acquire()), ("lock timeout", lambda: held().acquire(True, 5)), ("with", lambda: held().__enter__()), ("rlock", lambda: held_by_thread()[0].acquire()), ("rlock timeout", lambda: held_by_thread()[0].acquire(True, 5)),
         ("queue", lambda: _queue.SimpleQueue().get()), ("queue timeout", lambda: _queue.SimpleQueue().get(True, 5)), ("sleep", lambda: time.sleep(5)), ("event", lambda: threading.Event().wait(5)), ("condition", lambda: (lambda c: c.__enter__() and c.wait(5))(threading.Condition())),
         ("join", lambda: held_by_thread()[2].join(5)), ("select", lambda: select.select([], [], [], 5)), ("Queue", lambda: queue.Queue().get(True, 5)), ("semaphore", lambda: threading.Semaphore(0).acquire(True, 5)), ("barrier", lambda: threading.Barrier(2).wait(5)),
         ("pipe read", lambda: os.read(os.pipe()[0], 1)), ("sigwait other", lambda: signal.sigtimedwait([signal.SIGUSR2], 5)), ("pause", signal.pause)]
for name, wait in WAITS:
    @case("handler raises during " + name)
    def _(wait=wait):
        t = time.monotonic(); r = with_handler(raiser, wait)
        return r[:40], time.monotonic() - t < 3

@case("KeyboardInterrupt during lock.acquire")
def _():
    old = signal.signal(signal.SIGINT, signal.default_int_handler)
    later(0.05, signal.raise_signal, signal.SIGINT) if False else later(0.05, os.kill, os.getpid(), signal.SIGINT)
    try: return outcome(lambda: held().acquire(True, 5))
    finally: signal.signal(signal.SIGINT, old)

@case("handler releases the lock that is waited for")
def _():
    lock = held()
    return with_handler(lambda *a: lock.release(), lambda: lock.acquire(True, 5))

@case("handler waits for the same lock")
def _():
    lock = held(); log = []
    r = with_handler(lambda *a: log.append(outcome(lambda: lock.acquire(True, 0.05))), lambda: lock.acquire(True, 0.3))
    return r, log

@case("handler collects, makes threads, and returns")
def _():
    lock = held()
    def handler(*a):
        collect()
        t = threading.Thread(target=collect); t.start(); t.join()
    return with_handler(handler, lambda: lock.acquire(True, 0.3))

@case("storm of signals during waits")
def _():
    n = [0]
    def handler(*a): n[0] += 1
    old = signal.signal(signal.SIGALRM, handler)
    signal.setitimer(signal.ITIMER_REAL, 0.001, 0.001)
    try:
        lock = held(); rl = held_by_thread()[0]; q = _queue.SimpleQueue()
        rs = [lock.acquire(True, 0.2), rl.acquire(True, 0.2), outcome(lambda: q.get(True, 0.2))[:8], time.sleep(0.2)]
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0); signal.signal(signal.SIGALRM, old)
    return rs, n[0] > 10

@case("storm of signals whose handler raises, during waits in a loop")
def _():
    old = signal.signal(signal.SIGALRM, raiser)
    signal.setitimer(signal.ITIMER_REAL, 0.002, 0.002)
    counts = collections.Counter(); lock = held(); end = time.monotonic() + 1
    try:
        while time.monotonic() < end:
            try:
                try: lock.acquire(True, 0.01); counts["timeout"] += 1
                finally: counts["finally"] += 1
            except KeyError: counts["raised"] += 1
    except KeyError: counts["outside"] += 1
    finally:
        while True:
            try: signal.setitimer(signal.ITIMER_REAL, 0); signal.signal(signal.SIGALRM, old); break
            except KeyError: pass
    return counts["raised"] > 0, counts["finally"] >= counts["raised"]

# ---- Limits and pending exceptions ----

@case("waits at the recursion limit")
def _():
    lock = held(); rl = held_by_thread()[0]; q = _queue.SimpleQueue(); rs = set()
    def deep():
        try: deep()
        except RecursionError:
            for f in (lambda: lock.acquire(True, 0.001), lambda: rl.acquire(True, 0.001), lambda: q.get(True, 0.001), lambda: time.sleep(0.001), lambda: lock.__enter__ and 1):
                rs.add(outcome(f)[:14])
            raise
    return outcome(deep), sorted(rs)

@case("waits at the end of the stack")
def _():
    sys.setrecursionlimit(10 ** 8)
    lock = held(); rs = set()
    def deep():
        try: deep()
        finally: rs.add(outcome(lambda: lock.acquire(True, 0.0001))[:14]) if len(rs) < 3 else None
    return outcome(deep), len(rs) > 0

@case("waits while exceptions are handled and propagate")
def _():
    lock = held(); rs = []
    try:
        try: 1 / 0
        except ZeroDivisionError:
            rs.append(lock.acquire(True, 0.01)); rs.append(type(sys.exception()).__name__)
            raise KeyError
        finally:
            rs.append(lock.acquire(True, 0.01)); rs.append(type(sys.exception()).__name__)
    except KeyError as e:
        rs.append(lock.acquire(True, 0.01)); rs.append(type(e.__context__).__name__)
    class CM:
        def __enter__(self): return lock.acquire(True, 0.01)
        def __exit__(self, *a): rs.append(lock.acquire(True, 0.01)); return True
    with CM(): raise ValueError
    return rs

@case("waits in generators and coroutines")
def _():
    lock = held()
    def g():
        while True: yield lock.acquire(True, 0.005)
    async def c(): return lock.acquire(True, 0.005)
    x = g()
    return [next(x), next(x), outcome(lambda: c().send(None))]

# ---- Contention ----

@case("many threads, one lock, tiny switch interval")
def _():
    old = sys.getswitchinterval(); sys.setswitchinterval(1e-6)
    lock = _thread.allocate_lock(); total = [0]
    def work():
        for i in range(2000):
            if i % 3 == 0:
                if lock.acquire(True, 0.01): total[0] += 1; lock.release()
            elif i % 3 == 1:
                with lock: total[0] += 1
            else:
                if lock.acquire(False): total[0] += 1; lock.release()
    ts = [threading.Thread(target=work) for _ in range(8)]
    for t in ts: t.start()
    for t in ts: t.join()
    sys.setswitchinterval(old)
    return total[0] > 8000, lock.locked()

@case("lock released and dropped while others wait")
def _():
    rs = []
    for _ in range(30):
        lock = held(); box = []
        ts = [threading.Thread(target=lambda l=lock: box.append(l.acquire(True, 1))) for _ in range(4)]
        for t in ts: t.start()
        lock.release(); del lock
        collect()
        for t in ts: t.join()
        rs.append(sorted(box))
    return collections.Counter(map(tuple, rs)).most_common(2)

@case("queues among threads with collections")
def _():
    q = _queue.SimpleQueue(); out = _queue.SimpleQueue()
    def worker():
        while True:
            x = q.get()
            if x is None: return
            out.put([x] * 3)
    ts = [threading.Thread(target=worker) for _ in range(4)]
    for t in ts: t.start()
    for i in range(3000):
        q.put(i)
        if i % 500 == 0: gc.collect()
    n = sum(1 for _ in range(3000) if out.get(True, 10))
    for t in ts: q.put(None)
    for t in ts: t.join()
    return n

@case("daemon threads wait when the interpreter exits")
def _():
    for wait in (lambda: held().acquire(), lambda: _queue.SimpleQueue().get(), lambda: time.sleep(100), lambda: held_by_thread()[0].acquire(), lambda: threading.Event().wait()):
        threading.Thread(target=wait, daemon=True).start()
    time.sleep(0.05)
    return "leaving"

if GROUP == "--list":
    for name, f in CASES: print(name)
else:
    for name, f in CASES:
        if GROUP is None or GROUP == name:
            print(name, "->", outcome(f), flush=True)
