import threading, time, queue, _thread

# Lock
lock = threading.Lock()
print(lock.acquire(), lock.locked(), lock.acquire(False), lock.acquire(timeout=0.02))
lock.release(); print(lock.locked())
try: lock.release()
except RuntimeError as e: print("RuntimeError", e)
# released by another thread
lock.acquire()
threading.Thread(target=lock.release).start()
print(lock.acquire(timeout=5)); lock.release()

# mutual exclusion
n = 0
def add():
    global n
    for i in range(2000):
        with lock:
            v = n
            if i % 500 == 0: time.sleep(0)
            n = v + 1
ts = [threading.Thread(target=add) for _ in range(4)]
[t.start() for t in ts]; [t.join() for t in ts]
print(n)

# RLock
r = threading.RLock()
print(r.acquire(), r.acquire(), r._is_owned(), r._recursion_count())
res = []
def other():
    res.append(r.acquire(False)); res.append(r._is_owned()); res.append(r._recursion_count())
    try: r.release()
    except RuntimeError as e: res.append(str(e))
t = threading.Thread(target=other); t.start(); t.join(); print(res)
r.release(); r.release()
try: r.release()
except RuntimeError as e: print("RuntimeError", e)
print(r._is_owned(), r.locked() if hasattr(r, "locked") else None)

# Condition
cond = threading.Condition()
items = []
def consumer():
    with cond:
        while not items: cond.wait()
        print("consumed", items.pop())
t = threading.Thread(target=consumer); t.start()
time.sleep(0.02)
with cond:
    items.append(42); cond.notify()
t.join()
with cond: print(cond.wait(0.01), cond.wait_for(lambda: False, 0.01))

# Semaphore, BoundedSemaphore, Barrier, Event, Timer
sem = threading.Semaphore(2)
active = []; peak = []
def limited():
    with sem:
        active.append(1); peak.append(len(active)); time.sleep(0.01); active.pop()
ts = [threading.Thread(target=limited) for _ in range(6)]
[t.start() for t in ts]; [t.join() for t in ts]
print(max(peak) <= 2)
bar = threading.Barrier(3); order = []
def meet(i):
    bar.wait(); order.append(i)
ts = [threading.Thread(target=meet, args=(i,)) for i in range(3)]
[t.start() for t in ts]; [t.join() for t in ts]; print(sorted(order), bar.n_waiting, bar.broken)
fired = threading.Event()
tm = threading.Timer(0.02, fired.set); tm.start(); print(fired.wait(5))
tm = threading.Timer(5, print, ("never",)); tm.start(); tm.cancel(); tm.join(); print("cancelled")

# queue.Queue and SimpleQueue
q = queue.Queue(maxsize=2); out = []
def producer():
    for i in range(6): q.put(i)
    q.put(None)
t = threading.Thread(target=producer); t.start()
while (x := q.get()) is not None: out.append(x); q.task_done()
t.join(); print(out)
sq = queue.SimpleQueue()
threading.Timer(0.02, sq.put, ("late",)).start()
print(sq.get(), sq.empty())
try: sq.get(timeout=0.01)
except queue.Empty: print("Empty")
try: q.get(timeout=0.01)
except queue.Empty: print("Empty")

# threading.local
loc = threading.local(); loc.x = "main"
vals = []
def use(i):
    had = hasattr(loc, "x"); loc.x = i; time.sleep(0.01); vals.append((had, loc.x == i))
ts = [threading.Thread(target=use, args=(i,)) for i in range(3)]
[t.start() for t in ts]; [t.join() for t in ts]
print(vals, loc.x, loc.__dict__)
class L(threading.local):
    inits = 0
    def __init__(self, v): L.inits += 1; self.v = v
l = L(7); got = []
t = threading.Thread(target=lambda: got.append((l.v, l.__dict__))); t.start(); t.join()
print(got, L.inits, l.v)
