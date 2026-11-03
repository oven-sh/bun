import threading, sys, time, _thread, contextvars, traceback

# deep recursion in a thread
def depth(n): return 1 if n == 0 else 1 + depth(n - 1)
res = []
def recurse():
    res.append(depth(900))
    try: depth(100000)
    except RecursionError: res.append("RecursionError")
    res.append(depth(500))
t = threading.Thread(target=recurse); t.start(); t.join(); print(res)
# the limit counts each thread's own frames
def nested(n):
    if n: return nested(n - 1)
    t = threading.Thread(target=lambda: res.append(depth(800))); t.start(); t.join()
res.clear(); nested(600); print(res)

# a generator made in one thread and resumed in others
def gen():
    for i in range(6): yield (i, threading.current_thread().name)
g = gen(); got = []
for i in range(3):
    t = threading.Thread(target=lambda: got.append(next(g)), name=f"T{i}"); t.start(); t.join()
got.append(next(g)); print(got)

# a generator that is running in another thread
ev1 = threading.Event(); ev2 = threading.Event()
def slow():
    ev1.set(); ev2.wait(); yield 1
g = slow()
t = threading.Thread(target=lambda: next(g)); t.start(); ev1.wait()
try: next(g)
except ValueError as e: print("ValueError", e)
ev2.set(); t.join()

# exceptions being handled are per thread
res = []
def handler():
    res.append(sys.exception())
    try: 1 / 0
    except ZeroDivisionError:
        ev1.set(); ev2.wait(); res.append(type(sys.exception()).__name__)
ev1.clear(); ev2.clear()
try:
    raise KeyError("main")
except KeyError:
    t = threading.Thread(target=handler); t.start(); ev1.wait()
    print(type(sys.exception()).__name__)
    cur = sys._current_exceptions()
    print(sorted(type(v).__name__ for v in cur.values()))
    ev2.set(); t.join()
print(res, sys.exception())

# contextvars are per thread
var = contextvars.ContextVar("var", default="default"); var.set("main")
res = []
def ctx(): res.append(var.get()); var.set("thread"); res.append(var.get())
t = threading.Thread(target=ctx); t.start(); t.join(); print(res, var.get())

# sys._current_frames
ev1.clear(); ev2.clear()
def parked_here():
    ev1.set(); ev2.wait()
t = threading.Thread(target=parked_here); t.start(); ev1.wait(); time.sleep(0.01)
frames = sys._current_frames()
print(len(frames), threading.get_ident() in frames, t.ident in frames)
names = []
f = frames[t.ident]
while f: names.append(f.f_code.co_name); f = f.f_back
print(names[-4:])
print(frames[threading.get_ident()].f_code.co_name)
ev2.set(); t.join()

# switch interval
print(sys.getswitchinterval()); sys.setswitchinterval(0.001); print(sys.getswitchinterval()); sys.setswitchinterval(0.005)
try: sys.setswitchinterval(0)
except ValueError as e: print("ValueError", e)

# repr of a self-containing list in two threads at once
l = []; l.append(l)
class Slow:
    def __repr__(self): time.sleep(0.01); return "slow"
a = [Slow(), l]; res = []
ts = [threading.Thread(target=lambda: res.append(repr(a))) for _ in range(3)]
[t.start() for t in ts]; [t.join() for t in ts]; print(res)

# stack_size
print(threading.stack_size()); threading.stack_size(1024 * 1024); print(threading.stack_size())
t = threading.Thread(target=lambda: print("small stack", depth(100))); t.start(); t.join(); threading.stack_size(0)
try: threading.stack_size(100)
except ValueError as e: print("ValueError", e)

# _thread odds and ends
print(_thread._count(), _thread.daemon_threads_allowed(), _thread._get_main_thread_ident() == threading.main_thread().ident, _thread.TIMEOUT_MAX)
h = _thread.start_joinable_thread(lambda: time.sleep(0.01))
print(type(h).__name__, h.is_done(), h.ident != 0); h.join(); print(h.is_done()); h.join()
h = _thread._ThreadHandle()
try: h.join()
except RuntimeError as e: print("RuntimeError", e)
try: _thread.start_joinable_thread(1)
except TypeError as e: print("TypeError", e)
try: _thread.start_joinable_thread(print, handle=1)
except TypeError as e: print("TypeError", e)
