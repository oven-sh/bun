# JavaScript can only be used from the main thread. What the main thread makes and drops is finalized there, whatever other threads do.
import collections, gc, js, sys, threading

sys.setswitchinterval(0.0001)

out = collections.Counter()


class D:
    def __del__(self):
        try:
            js.Math.abs(-1)
            out["fine, in " + threading.current_thread().name] += 1
        except RuntimeError as e:
            out[str(e) + ", in " + threading.current_thread().name] += 1


stop = False


def busy():
    while not stop:
        [i for i in range(100)]


threads = [threading.Thread(target=busy) for i in range(2)]
for t in threads:
    t.start()
for i in range(30000):
    D()
stop = True
for t in threads:
    t.join()
gc.collect()
print(dict(out))
