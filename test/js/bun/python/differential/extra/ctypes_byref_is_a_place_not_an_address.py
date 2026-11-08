# byref(x) and an array that is passed stand for a place in the memory of an instance. Where that is, is looked at when the call is made, behind all that runs code of the program: until then the memory
# may move (resize()) or go (the view of it is released). (CPython takes the address at once, and then writes to memory that has been freed.)
import gc
from ctypes import *

Longs = c_ulong * 64
def fresh(value=0x11):
    a = Longs(); memset(a, value, sizeof(a)); return a

a = fresh(); r = byref(a); resize(a, 1 << 16)
memset(r, 0x22, 8)
print('byref(), resize(), then a call: %#x' % a[0])

b = bytearray(512); a = Longs.from_buffer(b); r = byref(a); a._objects['ffffffff'].release(); b.clear()
try: memset(r, 0x22, 8); print('written')
except ArgumentError as e: print('byref(), the view released, then a call:', e)

class Meddles:
    def __init__(self, act): self.act = act
    @property
    def _as_parameter_(self): self.act(); return 8
a = fresh(); memset(byref(a), 0x22, Meddles(lambda: resize(a, 1 << 16)))
print('resize() while a later argument is converted: %#x' % a[0])
a = fresh(); memset(a, 0x22, Meddles(lambda: resize(a, 1 << 16)))
print('the same with the array itself: %#x' % a[0])
b = bytearray(512); a = Longs.from_buffer(b)
def let_go(): a._objects['ffffffff'].release(); b.clear()
try: memset(a, 0x22, Meddles(let_go)); print('written')
except ArgumentError as e: print('the view released while a later argument is converted:', e)

a = fresh()
memset(byref(a, 504), 0x22, 8); print('the last item: %#x' % a[63])
memset(byref(a, 512), 0, 0); print('just behind the end: let through')
for offset in (513, 1 << 40, -1, -(1 << 40)):
    try: memset(byref(a, offset), 0, 0); print(offset, 'let through')
    except ArgumentError as e: print(offset, e)
class S(Structure): _fields_ = [('x', c_long), ('y', c_long)]
pair = (S * 2)(); memset(byref(pair[0], sizeof(S)), 0x33, 8)
print('from one item into the next, which is the same memory: %#x' % pair[1].x)
raw = S.from_address(addressof(pair)); memset(byref(raw, sizeof(S) + 8), 0x44, 8)
print('where nothing is known to own the memory nothing is said: %#x' % pair[1].y)
print(repr(byref(c_int(), 4))[:12], type(byref(a)._obj).__name__)
empty = (c_ubyte * 0).from_buffer(bytearray()); print('an instance without memory:', bool(cast(empty, c_void_p)) in (True, False))
