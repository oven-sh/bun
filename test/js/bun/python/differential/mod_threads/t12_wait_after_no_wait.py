# A function that has to wait, called right after one that might have had to and did not, from the same frame.
import threading, _thread, time
l = threading.Lock()
r = threading.RLock()
started = threading.Event()
def holder():
    r.acquire(); started.set(); time.sleep(0.3); r.release()
t = threading.Thread(target=holder); t.start(); started.wait()
state = (1, _thread.get_ident())
def f():
    l.acquire(True)
    r._acquire_restore(state)
    print("restored")
f()
r.release(); l.release(); t.join()
print("done")
