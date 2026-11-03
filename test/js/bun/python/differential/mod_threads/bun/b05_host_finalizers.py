# Dead objects of the host (timers and watchers of the event loop, objects of JS with destructors) are not swept by a thread other than the main one.
import gc, os, threading, _bun_loop, js

def in_thread(f, *a):
    out = []
    t = threading.Thread(target=lambda: out.append(f(*a))); t.start(); t.join()
    return out[0]

def churn(n=200000):
    # Allocates enough for the allocator to go through the blocks there are, and for collections of its own.
    keep = None
    for i in range(n):
        keep = [i, str(i), (i, keep and keep[0]), {i: i}]
    return gc.collect()

def drop_timers():
    for _ in range(50):
        _bun_loop.Timer(lambda: print("fired")).set(1000)
def drop_watchers():
    pipes = [os.pipe() for _ in range(30)]
    for r, w in pipes:
        _bun_loop.Watcher(r, lambda: print("ready"))
    return pipes
def drop_js():
    for i in range(300):
        js.Response.new("body %d" % i); js.URL.new("http://example.com/%d" % i); js.TextDecoder.new(); js.Headers.new(); js.Bun.file("/tmp/x%d" % i); js.Blob.new(["x"]); js.AbortController.new(); js.Buffer.alloc(100000)

drop_timers(); print("timers", in_thread(churn))
pipe = drop_watchers(); print("watchers", in_thread(churn))
drop_js(); print("js", in_thread(churn))
# And while the main thread waits, it does its part.
drop_timers(); drop_js()
threads = [threading.Thread(target=churn) for _ in range(4)]
for t in threads: t.start()
for t in threads: t.join()
gc.collect()
print("done")
