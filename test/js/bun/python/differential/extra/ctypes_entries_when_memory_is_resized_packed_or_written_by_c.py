# What is written down beside an address (who owns what it points into) when the memory that holds the address is resized, when the address does not lie at a multiple of eight, and when C has
# written other bytes there. What is written down is never believed against the bytes. (In CPython the rows with "_objects emptied" read memory that has been freed.)
import gc
from ctypes import *

Longs = c_ulong * 64
PLongs = POINTER(Longs)
def fresh(value=0x11):
    a = Longs(); memset(a, value, sizeof(a)); return a
def churn():
    for _ in range(3): gc.collect()
    return [fresh(0x6a) for _ in range(400)]
def show(name, pointer_):
    junk = churn()
    try: beyond = hex(pointer_[1][0])
    except ValueError: beyond = 'ValueError'
    print('%-60s %#x; the one behind it: %s' % (name, pointer_[0][63], beyond))

# ---- resize()
a = (PLongs * 4)(); a[0] = pointer(fresh()); a[3] = pointer(fresh(0x22)); a._objects.clear(); resize(a, 4096)
show('an array of pointers, resized: the first', a[0])
show('the last', a[3])
p = pointer(fresh()); p._objects.clear(); resize(p, 4096)
show('a pointer, resized', p)
a = (PLongs * 4)(); part = a[2]; resize(a, 4096); part.contents = fresh(); a._objects.clear()
show('a part from before goes on with the memory from before', part)
print('and the array does not see it:', bool(a[2]))

# ---- places that are not at a multiple of eight
class Packed(Structure):
    _pack_ = 1; _layout_ = 'ms'
    _fields_ = [('c', c_char), ('ptr', PLongs), ('d', c_char), ('text', c_char_p), ('other', PLongs)]
class Holder(Structure):
    _pack_ = 1; _layout_ = 'ms'
    _fields_ = [('e', c_char * 3), ('inner', Packed), ('two', Packed * 2)]
print('offsets:', Packed.ptr.offset, Packed.text.offset, Packed.other.offset, sizeof(Packed), Holder.inner.offset, Holder.two.offset)
s = Packed(); s.ptr = pointer(fresh()); s.other = pointer(fresh(0x22)); s.text = bytes(bytearray(b'A' * 500)); s._objects.clear()
show('a packed structure: a pointer at 1', s.ptr)
show('one at 18', s.other)
junk = churn(); print('a c_char_p at 10:', len(s.text), s.text[:1])
h = Holder(); h.inner = s; h.two[1] = s; del s; h._objects.clear()
show('the structure stored into a field at 3', h.inner.ptr)
show('its other pointer', h.inner.other)
show('stored into an item', h.two[1].other)
k = Holder(); k.two = h.two; del h; k._objects.clear()
show('the array of them stored into a field', k.two[1].ptr)
s = Packed(); s.ptr = pointer(fresh()); s.ptr = None
print('None stored:', bool(s.ptr))
class Plain(Structure): _fields_ = [('ptr', PLongs)]
class Shifted(Structure):
    _pack_ = 1; _layout_ = 'ms'
    _fields_ = [('c', c_char), ('plain', Plain)]
x = Plain(); x.ptr = pointer(fresh()); y = Shifted(); y.plain = x; del x; y._objects.clear()
show('from a multiple of eight to a place that is none', y.plain.ptr)
z = Plain(); z.ptr = y.plain.ptr; del y; z._objects.clear()
show('and back', z.ptr)

# ---- C writes other bytes
libc = CDLL(None)
n = 40
targets = [fresh(n - i) for i in range(n)]          # The first item of each says where it belongs.
a = (PLongs * n)(*[pointer(t) for t in targets])
Compare = CFUNCTYPE(c_int, POINTER(PLongs), POINTER(PLongs))
libc.qsort.argtypes = [c_void_p, c_size_t, c_size_t, Compare]; libc.qsort.restype = None
libc.qsort(a, n, sizeof(PLongs), Compare(lambda x, y: (x[0][0][0] > y[0][0][0]) - (x[0][0][0] < y[0][0][0])))
del targets
junk = churn()
print('an array of 40 pointers sorted by qsort():', [a[i][0][0] & 0xff for i in range(n)] == list(range(1, n + 1)))

kept = fresh(0x44)
s = (PLongs * 2)(); s[0] = pointer(fresh()); s[1] = pointer(kept); memmove(s, byref(s, 8), 8)
print('memmove() over a pointer: %#x' % s[0][0][0])
s = (PLongs * 2)(); s[0] = pointer(fresh()); memset(s, 0, 8)
print('memset() over a pointer:', bool(s[0]))

# ---- an entry that is out of date goes on holding what it held, until the place is stored to again
b = bytearray(512); s = (PLongs * 1)(); s[0] = pointer(Longs.from_buffer(b)); s._objects.clear(); memset(s, 0, 8)
for _ in range(3): gc.collect()
try: b.clear(); print('the bytearray can be emptied')
except BufferError: print('the pointer was overwritten by C: the bytearray is still exported')
s[0] = None
for _ in range(3): gc.collect()
try: b.clear(); print('stored to again: the bytearray can be emptied')
except BufferError: print('stored to again: still exported')
