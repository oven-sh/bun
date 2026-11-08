# The result of cast() points into what the address was taken from: an instance, what a pointer points to, a bytes object, the copy that was made of a str, what byref() refers to, what an
# _as_parameter_ made on the spot. That lives, and says how far it goes, for as long as the result says so. (In CPython most of these read memory that has been freed.)
import gc
from ctypes import *

Longs = c_ulong * 64
PL = POINTER(c_ulong)
def fresh(value=0x11):
    a = Longs(); memset(a, value, sizeof(a)); return a
def text(): return bytes(bytearray(b'A' * 500))
def churn():
    for _ in range(3): gc.collect()
    return [fresh(0x6a) for _ in range(300)] + [bytes(bytearray(b'j' * 500)) for _ in range(300)] + [create_string_buffer(b'j' * 2000) for _ in range(100)]
def show(name, result, read, beyond=None):
    junk = churn()
    said = read(result)
    if beyond:
        try: beyond(result); said = '%s; beyond it: let through' % (said,)
        except ValueError: said = '%s; beyond it: ValueError' % (said,)
    print('%-52s %s' % (name, said))
last = lambda r: hex(r[63])
behind = lambda r: r[65]

show('an array', cast(fresh(), PL), last, behind)
r = cast(fresh(), PL); r._objects.clear()
show('an array, _objects emptied', r, last, behind)
show('byref() of an array', cast(byref(fresh()), PL), last, behind)
show('byref() with an offset', cast(byref(fresh(), 8), PL), lambda r: hex(r[62]), lambda r: r[64])
show('a pointer', cast(pointer(fresh()), PL), last, behind)
p = pointer(fresh()); q = cast(p, PL); p.contents = fresh(0x22)
show('a pointer that is then made to point elsewhere', q, last, behind)
show('the result of a cast', cast(cast(fresh(), POINTER(c_ubyte)), PL), last, behind)
show('by way of a c_void_p', cast(cast(fresh(), c_void_p), PL), last, behind)
class Fresh:
    @property
    def _as_parameter_(self): return fresh()
show('what an _as_parameter_ made on the spot', cast(Fresh(), PL), last, behind)
show('bytes, to c_char_p', cast(text(), c_char_p), lambda r: (len(r.value), r.value[:1]))
show('bytes, to a pointer', cast(text(), POINTER(c_char)), lambda r: r[0:500] == b'A' * 500, lambda r: r[502])
show('bytes: the NUL behind them', cast(text(), POINTER(c_char)), lambda r: r[500])
show('a c_char_p', cast(c_char_p(text()), POINTER(c_char)), lambda r: r[499], lambda r: r[502])
show('a str, to c_wchar_p', cast(str(bytearray(b'A' * 500), 'ascii'), c_wchar_p), lambda r: (len(r.value), r.value[:1]))

# What is made through such a pointer holds on to the memory itself.
c = cast(text(), POINTER(c_char * 500)).contents
junk = churn()
print('an instance in a bytes object:', c.raw == b'A' * 500, bytes(memoryview(c)) == b'A' * 500)
c = cast(b'abc', POINTER(c_char * 4)).contents
print('with the NUL behind the bytes:', c.raw, bytes(c), bytes(memoryview(c)), bytearray(c), (c_char * 4).from_buffer_copy(c).raw)
class Holds(Structure): _fields_ = [('ptr', POINTER(Longs))]
room = bytes(bytearray(64)); h = cast(room, POINTER(Holds)).contents; Holds.from_buffer(h).ptr = pointer(fresh())
junk = churn()
print('stored by from_buffer() of an instance in a bytes object, read by the instance: %#x' % h.ptr[0][63])
c = cast(fresh(), POINTER(Longs)).contents
junk = churn()
print('an instance in an array that is gone: %#x' % c[63])

a = fresh(); r = cast(a, PL); resize(a, 4096); del a
show('an array that is resized behind the cast', r, last, behind)

b = bytearray(b'\x11' * 512); a = Longs.from_buffer(b); r = cast(a, PL)
show('an array over a bytearray', r, last, behind)
a._objects['ffffffff'].release(); del a; b.clear(); b.extend(b'\x6a' * 16)
try: print('the view released, the bytearray emptied: %#x' % r[0])
except ValueError as e: print('the view released, the bytearray emptied: ValueError:', e)

print('None:', bool(cast(None, PL)), '; 0:', bool(cast(0, PL)))
kept = fresh(0x44)
print('an int: %#x' % cast(addressof(kept), PL)[63])
