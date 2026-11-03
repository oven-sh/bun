# Objects of the host (here: Request and Response of Bun) that die while a thread other than the main one has the interpreter. Their
# destructors are for the main thread, so they stay as they are for a while, dead, and later without a cell: collections that come
# meanwhile must not take them for something that has just died, nor run their destructors.
import gc, sys, threading
if sys.implementation.name == "cpython":
    print("done")
    sys.exit(0)
import js

class Noisy:
    def __del__(self): pass

def collect_often():
    for _ in range(4):
        Noisy(), Noisy()
        gc.collect()

for round in range(6):
    dropped = [js.Request.new("http://localhost/%d" % i, method="POST", body="x" * 100) for i in range(4)] + [js.Response.new("body") for i in range(4)]
    for r in dropped:
        r.url, r.headers, r.body
    del dropped, r
    threads = [threading.Thread(target=collect_often) for _ in range(2)]
    for t in threads: t.start()
    for t in threads: t.join()
    gc.collect()
print("done")
