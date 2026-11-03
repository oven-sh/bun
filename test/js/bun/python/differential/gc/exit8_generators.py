# Generators and coroutines that are left when the program ends.
import atexit
def gen(name):
    try:
        yield 1
    finally:
        print("closed", name)
g1 = gen("g1"); next(g1)
g2 = gen("g2, never started")
g3 = gen("g3"); next(g3)
def holder():
    inner = gen("held by a generator"); next(inner)
    try:
        yield
    finally:
        print("closed holder")
h = holder(); next(h)
atexit.register(print, "atexit")
print("end")
