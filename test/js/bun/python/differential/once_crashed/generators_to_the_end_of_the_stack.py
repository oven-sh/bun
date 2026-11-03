# A chain of generators that delegate to each other until the stack ends. The frame for which there was no room was taken for a frame of Python when a
# collection came while the error was being thrown, and what C++ had on the stack there was overwritten.
import sys
sys.setrecursionlimit(10 ** 8)
def g(f):
    yield from f(f)
try:
    next(g(g))
except RecursionError:
    print("RecursionError")
