# A structure or a union of no bytes by value, as an argument and as the result.
from ctypes import *
libc = CDLL(None)
class Empty(Structure): pass
class NoFields(Structure): _fields_ = []
class NoItems(Structure): _fields_ = [('a', c_int * 0)]
class EmptyUnion(Union): _fields_ = []
class Holds(Structure): _fields_ = [('e', NoFields), ('x', c_int)]
def attempt(what, act):
    try:
        r = act()
        print(what, '|', type(r).__name__, r if isinstance(r, int) else '')
    except Exception as e:
        print(what, '|', type(e).__name__, e)
for T in (Empty, NoFields, NoItems, EmptyUnion, Holds):
    attempt('argument ' + T.__name__, lambda: libc.labs(T()))
    attempt('second argument ' + T.__name__, lambda: libc.labs(-5, T()))
    attempt('declared ' + T.__name__, lambda: CFUNCTYPE(c_long, c_long, T)(('labs', libc))(-6, T()))
    attempt('result ' + T.__name__, lambda: CFUNCTYPE(T, c_long)(('labs', libc))(-7))
