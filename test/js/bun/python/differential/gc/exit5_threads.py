# threads and exit
import threading, atexit, sys
class A:
    def __init__(self, n): self.n = n
    def __del__(self): print("del", self.n)
go = threading.Event()   # No clock: the thread ends when the main thread has ended, and not a moment that the main thread may miss.
def work():
    local = A("local of a thread")
    go.wait()
    print("thread ends")
t = threading.Thread(target=work); t.start()
atexit.register(print, "atexit")
threading._register_atexit(go.set)   # The last to be registered is called first.
threading._register_atexit(print, "threading atexit")
g = A("global")
print("end")
