# Finalizers of several threads at once: they wait for each other, somebody asks for a collection meanwhile, threads end or die owing.
import collections, gc, sys, threading

count = collections.Counter()
def name(): return threading.current_thread().name

# 1. A's finalizer waits for what B's finalizer does. One collection finds both.
a_done, b_done = threading.Event(), threading.Event()
class WaitsForB:
    def __del__(self): count["1 A got it", b_done.wait(120), name()] += 1; a_done.set()
class SetsB:
    def __del__(self): count["1 B", name()] += 1; b_done.set()
made = threading.Barrier(3)
def a():
    x = WaitsForB(); del x; made.wait(); a_done.wait(150)
def b():
    x = SetsB(); del x; made.wait(); b_done.wait(150)
ts = [threading.Thread(target=a, name="A"), threading.Thread(target=b, name="B")]
for t in ts: t.start()
made.wait()
for t in ts: t.join()
print(sorted(count.items(), key=repr)); count.clear()

# 2. B asks for a collection while A is in the middle of a finalizer, with more to come.
inside, go_on = threading.Event(), threading.Event()
class Slow:
    first = True
    def __del__(self):
        count["2"] += 1
        if Slow.first:
            Slow.first = False; inside.set(); go_on.wait(120)
def a2():
    l = [Slow() for i in range(50)]; del l
    gc.collect()
def b2():
    inside.wait(120)
    l = [Slow() for i in range(50)]; del l
    gc.collect(); gc.collect()
    go_on.set()
ts = [threading.Thread(target=a2, name="A"), threading.Thread(target=b2, name="B")]
for t in ts: t.start()
for t in ts: t.join()
gc.collect()
print(sorted(count.items(), key=repr)); count.clear()

# 3. A collection asked for in a finalizer.
class Asks:
    def __del__(self):
        y = Inner(); del y
        count["3 outer", gc.collect() >= 0] += 1
class Inner:
    def __del__(self): count["3 inner"] += 1
x = Asks(); del x; gc.collect(); gc.collect()
print(sorted(count.items(), key=repr)); count.clear()

# 4. A thread dies of an exception, owing.
class D:
    def __del__(self): count["4"] += 1
def dies():
    l = [D() for i in range(100)]; l.append(l); del l
    raise SystemExit
t = threading.Thread(target=dies); t.start(); t.join(); gc.collect()
print(sorted(count.items(), key=repr)); count.clear()

# 5. Many short threads.
def short():
    l = [D() for i in range(10)]; l.append(l); del l
threads = []
for i in range(500):
    threads.append(threading.Thread(target=short)); threads[-1].start()
    if i % 8 == 0: threads[-1].join()
for t in threads: t.join()
gc.collect()
print(sorted(count.items(), key=repr)); count.clear()

# 6. A finalizer starts a thread, which makes garbage of its own.
class Starts:
    def __del__(self):
        t = threading.Thread(target=short, name="started"); t.start(); started.append(t)
started = []
x = Starts(); del x; gc.collect()
for t in started: t.join()
gc.collect()
print(sorted(count.items(), key=repr)); count.clear()

# 7. A finalizer raises, in a thread that waits.
class Raises:
    def __del__(self): ev.set(); raise ValueError("from a finalizer")
ev = threading.Event()
hooked = []
sys.unraisablehook = lambda u: hooked.append((type(u.exc_value).__name__, name()))
def waits():
    x = Raises(); del x
    print(ev.wait(150))
t = threading.Thread(target=waits, name="W"); t.start(); t.join()
print(hooked)
