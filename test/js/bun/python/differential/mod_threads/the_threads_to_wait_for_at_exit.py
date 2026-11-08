# The interpreter keeps the handles of the threads that it waits for before it exits. Nothing gives them to the program in a list that it could change: gc finds none.
# And the wait itself: threads end, and start others, while the main thread goes through them. Each case is a program of its own.
# No case goes by the clock: a thread that is to outlast the main one waits until that one is about to join it (threading._register_atexit()).
import os, subprocess, sys, tempfile
cases = {
"gc.get_referrers(handle) gives no list; an int appended": '''
import gc, threading
go = threading.Event()
t = threading.Thread(target=go.wait); t.start()
lists = [l for l in gc.get_referrers(t._os_thread_handle) if type(l) is list]
print(len(lists), [[type(x).__name__ for x in l] for l in lists], flush=True)
for l in lists: l.append(5)
go.set(); t.join()
print("the program ends", flush=True)
''',
"an object appended": '''
import gc, threading
go = threading.Event()
t = threading.Thread(target=go.wait); t.start()
lists = [l for l in gc.get_referrers(t._os_thread_handle) if type(l) is list]
for l in lists: l.append(object())
go.set(); t.join()
print("the program ends", flush=True)
''',
"a handle of a thread that never ends appended": '''
import gc, threading, _thread
go = threading.Event()
t = threading.Thread(target=go.wait); t.start()
for l in gc.get_referrers(t._os_thread_handle):
    if type(l) is list: l.append(_thread._make_thread_handle(1))
go.set(); t.join()
print("the program ends", flush=True)
''',
"emptied: the thread is waited for all the same": '''
import gc, threading
ending = threading.Event(); threading._register_atexit(ending.set)
t = threading.Thread(target=lambda: (ending.wait(), print("thread done", flush=True))); t.start()
for l in gc.get_referrers(t._os_thread_handle):
    if type(l) is list: l.clear()
print("main done", flush=True)
''',
"who refers to a handle: running, joined, of a daemon": '''
import gc, threading
def who(t): return sorted(type(o).__name__ for o in gc.get_referrers(t._os_thread_handle))
go = threading.Event()
t = threading.Thread(target=go.wait); t.start(); d = threading.Thread(target=go.wait, daemon=True); d.start()
print(who(t), who(d))
go.set(); t.join(); d.join()
print(who(t), who(d))
''',
"gc.get_objects() has no list or tuple with a handle in it": '''
import gc, threading
go = threading.Event()
threads = [threading.Thread(target=go.wait) for i in range(3)]
for t in threads: t.start()
print([type(o).__name__ for o in gc.get_objects() if type(o) in (list, tuple, set, dict) and any(type(x).__name__ == "_ThreadHandle" for x in (o.values() if type(o) is dict else o))])
go.set()
''',
"each thread starts the next while the main thread waits": '''
import threading
ending = threading.Event(); threading._register_atexit(ending.set)
def run(n):
    ending.wait(); print("thread", n, flush=True)
    if n < 6: threading.Thread(target=run, args=(n + 1,)).start()
threading.Thread(target=run, args=(1,)).start()
print("main done", flush=True)
''',
"sixty threads end in an order of their own, each behind a thread that it has started": '''
import atexit, threading
ending = threading.Event(); threading._register_atexit(ending.set)
done = []
def leaf(n): done.append(n)
def run(n):
    ending.wait()
    t = threading.Thread(target=leaf, args=(n,)); t.start()
    if n % 3 == 0: t.join()
for n in range(60): threading.Thread(target=run, args=(n,)).start()
atexit.register(lambda: print(sorted(done) == list(range(60)), threading.active_count()))
print("main done", flush=True)
''',
"the first in the row ends last": '''
import threading
ending = threading.Event(); threading._register_atexit(ending.set)
previous = ending; threads = []
for n in range(8):
    mine = threading.Event()
    threads.append((n, previous, mine)); previous = mine
def run(n, before, after): before.wait(); print("thread", n, flush=True); after.set()
for n, before, after in reversed(threads): threading.Thread(target=run, args=(n, before, after)).start()
print("main done", flush=True)
''',
"a thread that is waited for itself waits for the others: _thread._shutdown()": '''
import threading, _thread
go = threading.Event()
def other(): go.wait(); print("other done", flush=True)
def waiter():
    threading.Thread(target=other).start()
    go.set(); _thread._shutdown(); print("waiter done", flush=True)
t = threading.Thread(target=waiter); t.start(); t.join()
print("main done", flush=True)
''',
"_thread._shutdown() with nothing to wait for, twice": '''
import _thread
print(_thread._shutdown(), _thread._shutdown())
''',
"daemon threads are not waited for, the others are": '''
import threading
ending = threading.Event(); threading._register_atexit(ending.set)
never = threading.Event()
for i in range(5): threading.Thread(target=never.wait, daemon=True).start()
threading.Thread(target=lambda: (ending.wait(), print("thread done", flush=True))).start()
for i in range(5): threading.Thread(target=never.wait, daemon=True).start()
print("main done", flush=True)
''',
"a handle of the program's own": '''
import _thread, threading
ending = threading.Event(); threading._register_atexit(ending.set)
h = _thread._ThreadHandle()
r = _thread.start_joinable_thread(lambda: (ending.wait(), print("thread done", flush=True)), handle=h, daemon=False)
print(r is h, "main done", flush=True)
''',
"start_new_thread(): not waited for": '''
import _thread, threading
never = threading.Event(); started = threading.Event()
_thread.start_new_thread(lambda: (started.set(), never.wait()), ())
started.wait(); print("main done", flush=True)
''',
"an atexit callback registered by a thread that is waited for": '''
import atexit, threading
ending = threading.Event(); threading._register_atexit(ending.set)
threading.Thread(target=lambda: (ending.wait(), atexit.register(print, "callback of the thread"), print("thread done", flush=True))).start()
atexit.register(print, "callback of the main thread")
print("main done", flush=True)
''',
"collections while the threads come and go": '''
import gc, threading
ending = threading.Event(); threading._register_atexit(ending.set)
def run(n):
    ending.wait(); gc.collect()
    if n: threading.Thread(target=run, args=(n - 1,)).start()
    [[i] for i in range(20000)]
for i in range(4): threading.Thread(target=run, args=(5,)).start()
gc.collect(); print("main done", flush=True)
''',
}
for name, source in cases.items():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "case.py")
        with open(path, "w") as f: f.write(source)
        try:
            r = subprocess.run([sys.executable, path], capture_output=True, text=True, timeout=60)
            print(name, "|", r.returncode, "|", r.stdout.replace("\n", ";"), "|", "" if r.returncode >= 0 and not r.stderr.strip() else "(something on stderr)" if r.returncode >= 0 else "")
        except subprocess.TimeoutExpired: print(name, "| IT DOES NOT END")
