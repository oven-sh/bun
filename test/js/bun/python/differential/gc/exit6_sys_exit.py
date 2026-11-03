# sys.exit in the middle of frames, with objects in them
import sys
class A:
    def __init__(self, n): self.n = n
    def __del__(self): print("del", self.n)
def inner():
    x = A("inner local")
    sys.exit(3)
def outer():
    y = A("outer local")
    inner()
g = A("global")
outer()
