# atexit, weakref.finalize and __del__ at exit
import atexit, weakref, sys
class A:
    def __init__(self, n): self.n = n
    def __del__(self): print("del", self.n)
a = A(1); b = A(2); c = A(3)
atexit.register(print, "atexit 1")
weakref.finalize(a, print, "finalize a")
atexit.register(print, "atexit 2")
weakref.finalize(b, print, "finalize b")
f = weakref.finalize(c, print, "finalize c, not at exit"); f.atexit = False
r = weakref.ref(a, lambda r: print("callback a"))
print("end")
