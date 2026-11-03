# Threads and the collector.
import threading, gc, time, weakref, sys

class Node:
    def __init__(self, i): self.i = i; self.next = None; self.data = [i] * 10
def churn(n, out):
    keep = []
    total = 0
    for i in range(n):
        a = Node(i); b = Node(i + 1); a.next = b; b.next = a
        total += sum(a.data) + len(str(i)) + len({i: [i]})
        if i % 50 == 0: keep.append(a)
        if len(keep) > 20: keep.pop(0)
    out.append((total, all(k.next.next is k for k in keep)))
out = []
ts = [threading.Thread(target=churn, args=(3000, out)) for _ in range(6)]
[t.start() for t in ts]
for _ in range(5): gc.collect(); time.sleep(0.01)
[t.join() for t in ts]
print(len(out), len(set(out)), out[0])

# what only the stack of a blocked thread refers to stays
ready = threading.Event(); go = threading.Event(); res = []
def holder():
    mine = Node(123); w = weakref.ref(mine); res.append(w)
    ready.set(); go.wait()
    res.append(mine.data[0] == 123 and w() is mine)
t = threading.Thread(target=holder); t.start(); ready.wait()
for _ in range(3): gc.collect()
junk = [[i] * 50 for i in range(20000)]; del junk; gc.collect()
print(res[0]() is not None)
go.set(); t.join(); print(res[1])
gc.collect(); gc.collect(); print(res[0]() is None)

# finalizers run, whichever thread
log = []
class F:
    def __del__(self): log.append(1)
def make():
    for _ in range(100): F()
ts = [threading.Thread(target=make) for _ in range(4)]
[t.start() for t in ts]; [t.join() for t in ts]
gc.collect(); gc.collect(); print(len(log))

# a thread ends while another collects
def brief(): x = [Node(i) for i in range(50)]
for _ in range(30):
    ts = [threading.Thread(target=brief) for _ in range(4)]
    [t.start() for t in ts]; gc.collect(); [t.join() for t in ts]
print("ended during collections")

# collections started by threads other than the main one, which is blocked
def collector(): 
    for _ in range(5): gc.collect()
t = threading.Thread(target=collector); mine = Node(7); t.start(); t.join(); print(mine.data[0], mine.i)
