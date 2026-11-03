import _thread, threading, time, sys

# start_new_thread, locks
done = _thread.allocate_lock()
done.acquire()
seen = []
def work(a, b=0):
    seen.append((a, b, _thread.get_ident() != main_ident))
    done.release()
main_ident = _thread.get_ident()
ident = _thread.start_new_thread(work, (1,), {"b": 2})
print(type(ident).__name__, ident != main_ident)
done.acquire()
print(seen)

# threading.Thread, join, results in order
results = []
def square(n):
    time.sleep(0.01 * (5 - n))
    results.append(n * n)
threads = [threading.Thread(target=square, args=(i,)) for i in range(5)]
for t in threads: t.start()
for t in threads: t.join()
print(sorted(results), [t.is_alive() for t in threads])

# the GIL is handed over between threads that never block
counts = [0, 0]
stop = False
def spin(i):
    while not stop:
        counts[i] += 1
a = threading.Thread(target=spin, args=(0,)); b = threading.Thread(target=spin, args=(1,))
a.start(); b.start()
time.sleep(0.3)
stop = True
a.join(); b.join()
print(counts[0] > 0, counts[1] > 0)

# names, idents, main thread
print(threading.current_thread().name, threading.main_thread() is threading.current_thread(), threading.active_count())
def who():
    t = threading.current_thread()
    print(t.name, t.ident == threading.get_ident(), t.ident != main_ident, t.daemon, threading.main_thread().name, t.native_id != threading.main_thread().native_id)
t = threading.Thread(target=who, name="worker-1"); t.start(); t.join()
print(_thread._count(), threading.active_count())

# an exception in a thread
def fails(): raise ValueError("in a thread")
old = threading.excepthook
threading.excepthook = lambda args: print("hook:", args.exc_type.__name__, args.exc_value, args.thread.name)
t = threading.Thread(target=fails, name="failing"); t.start(); t.join()
threading.excepthook = old
# SystemExit ends the thread silently
t = threading.Thread(target=sys.exit); t.start(); t.join(); print("after SystemExit", t.is_alive())

# join with a timeout
ev = threading.Event()
t = threading.Thread(target=ev.wait); t.start()
t.join(0.05); print("alive after timeout", t.is_alive())
ev.set(); t.join(); print("alive after set", t.is_alive())
try:
    threading.current_thread().join()
except RuntimeError as e: print("RuntimeError", e)
t = threading.Thread(target=lambda: None)
try: t.join()
except RuntimeError as e: print("RuntimeError", e)
t.start(); t.join()
try: t.start()
except RuntimeError as e: print("RuntimeError", e)
