# A c_char_p, a c_wchar_p and a c_void_p hold an address that was stored as a value. What it points into lives for as long as the eight bytes say so, whatever has become of _objects.
# (In CPython most of these read memory that has been freed: there is nothing to compare with.)
import gc
from ctypes import *

class S(Structure): _fields_ = [('n', c_long), ('a', c_char_p), ('w', c_wchar_p), ('v', c_void_p)]
class D(Structure): _fields_ = [('before', c_long), ('inner', S)]

def text(letter=b'A'): return bytes(bytearray(letter * 500))
def wide(letter='A'): return str(bytearray(letter.encode() * 500), 'ascii')
def churn():
    for _ in range(3): gc.collect()
    return [bytes(bytearray(b'j' * 500)) for _ in range(400)] + [create_string_buffer(b'j' * 2000) for _ in range(200)]
def show(name, read):
    junk = churn()
    value = read()
    print('%-58s %d of %r' % (name, len(value), value[:1]))

s = S(); s.a = text(); s.w = wide(); s._objects.clear()
show('a c_char_p field, _objects emptied', lambda: s.a)
show('a c_wchar_p field, _objects emptied', lambda: s.w)

d = D(); x = S(); x.a = text(); d.inner = x; x.a = text(b'B')
show('d.inner = x; x.a = other', lambda: d.inner.a)
show('x.a', lambda: x.a)

s = S(); pointer(s).contents.a = text()
show('stored through a pointer to the structure', lambda: s.a)

a = (c_char_p * 100)(*[text(bytes([65 + i % 26])) for i in range(100)]); a._objects.clear()
junk = churn()
print('100 items, _objects emptied:', all(a[i] == bytes([65 + i % 26]) * 500 for i in range(100)))

s = S(); s.a = text(); t = S(); t.a = s.a; del s
show('the value read and stored elsewhere (a new bytes object)', lambda: t.a)

# An int says nothing about what it points into. If that is what the place pointed into before, it goes on being known.
Longs = c_ulong * 64
def through(s): return cast(byref(s, S.v.offset), POINTER(POINTER(c_ulong)))[0]
target = Longs(); memset(target, 0x11, sizeof(target))
s = S(); cast(byref(s, S.v.offset), POINTER(POINTER(Longs)))[0] = pointer(target); del target
s.v = s.v
junk = churn()
print('the same int stored again: %#x' % through(s)[63])
s.v = s.v + 8
junk = churn()
print('moved on by eight: %#x' % through(s)[62])
try: through(s)[63]
except ValueError: print('and the bounds are those of what it points into: ValueError')
s.v = None
print('None stored:', s.v, bool(through(s)))
