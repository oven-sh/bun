# The GIL changes hands at any safe point: a very short switch interval, and code that would notice state leaking between threads.
import threading, sys, time, gc, contextvars, weakref, traceback
sys.setswitchinterval(1e-6)
N = 6
errors = []
def check(cond, what):
    if not cond: errors.append(what)

# exceptions
def exceptions(k):
    for i in range(300):
        try:
            try:
                raise ValueError((k, i))
            except ValueError as e:
                check(sys.exception() is e and e.args[0] == (k, i), "handled exception")
                try:
                    raise KeyError(k) from e
                finally:
                    check(type(sys.exception()) is KeyError or sys.exception() is e, "finally")
        except KeyError as e2:
            check(e2.args[0] == k and e2.__cause__.args[0] == (k, i) and e2.__context__ is e2.__cause__, "chain")
            tb = e2.__traceback__
            check(tb.tb_frame.f_code.co_name == "exceptions", "traceback")
        check(sys.exception() is None, "after")

# recursion depth is each thread's own
def rec(n): return 0 if n == 0 else 1 + rec(n - 1)
def recursion(k):
    for i in range(10):
        check(rec(300 + k) == 300 + k, "recursion")
    try: rec(10 ** 6); check(False, "no RecursionError")
    except RecursionError: pass
    check(rec(100) == 100, "after RecursionError")

# generators shared between threads, under a lock
glock = threading.Lock()
def counter():
    i = 0
    while True:
        i += 1; yield i
shared = counter(); taken = []
def generators(k):
    def own():
        for i in range(50): yield (k, i)
    for j, v in enumerate(own()):
        check(v == (k, j), "own generator")
        with glock: taken.append(next(shared))

# context variables, thread locals
var = contextvars.ContextVar("v"); loc = threading.local()
def state(k):
    for i in range(300):
        var.set((k, i)); loc.v = (k, i)
        check(var.get() == (k, i) and loc.v == (k, i), "thread state")

# keyword arguments, star arguments, comprehensions, closures: what the runtime keeps between instructions
def kw(a, b=1, *args, c, **rest): return (a, b, args, c, rest)
def calls(k):
    for i in range(300):
        check(kw(k, i, 1, 2, c=k, d=i) == (k, i, (1, 2), k, {"d": i}), "keywords")
        check(kw(*[k], **{"c": i}) == (k, 1, (), i, {}), "star")
        check(sorted({j: k for j in range(3)}.items()) == [(0, k), (1, k), (2, k)], "comprehension")
        check("%s-%s" % (k, i) == f"{k}-{i}" == "-".join([str(k), str(i)]), "strings")
        check(repr([k, [i]]) == f"[{k}, [{i}]]", "repr")

# finalizers and weak references while everything else goes on
fin = []
class F:
    def __init__(self, k): self.k = k
    def __del__(self): fin.append(self.k)
def finalizers(k):
    for i in range(50):
        f = F(k); w = weakref.ref(f); check(w() is f, "weakref"); del f
        if i % 25 == 0: gc.collect()

for job in (exceptions, recursion, generators, state, calls, finalizers):
    ts = [threading.Thread(target=job, args=(k,)) for k in range(N)]
    [t.start() for t in ts]; [t.join() for t in ts]
    print(job.__name__, sorted(set(errors)))
print(sorted(taken) == list(range(1, 50 * N + 1)))
# all at once
ts = [threading.Thread(target=job, args=(k,)) for k in range(3) for job in (exceptions, recursion, generators, state, calls, finalizers)]
[t.start() for t in ts]; [t.join() for t in ts]
print("together", sorted(set(errors)))
gc.collect(); gc.collect()
print(len(fin) == 50 * N + 50 * 3)

# many short threads
count = 0; clock = threading.Lock()
def tiny():
    global count
    with clock: count += 1
for _ in range(20):
    ts = [threading.Thread(target=tiny) for _ in range(25)]
    [t.start() for t in ts]; [t.join() for t in ts]
print(count, threading.active_count())
