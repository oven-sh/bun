# threads and exit
import threading, time, atexit, sys
class A:
    def __init__(self, n): self.n = n
    def __del__(self): print("del", self.n)
def work():
    local = A("local of a thread")
    time.sleep(0.05)
    print("thread ends")
t = threading.Thread(target=work); t.start()
atexit.register(print, "atexit")
threading._register_atexit(print, "threading atexit")
g = A("global")
print("end")
