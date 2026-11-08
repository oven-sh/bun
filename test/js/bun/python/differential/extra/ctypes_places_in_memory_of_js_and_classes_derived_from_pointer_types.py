# Two things that decide where it is written down who owns what a stored address points into: which cell lies under all the views of a memory, and which types hold addresses at all.
# (In CPython these read memory that has been freed: there is nothing to compare with.)
import gc
from ctypes import *
import js

Longs = c_ulong * 64
PLongs = POINTER(Longs)
class S(Structure): _fields_ = [('n', c_long), ('ptr', PLongs), ('other', PLongs)]
def fresh(value=0x11):
    a = Longs(); memset(a, value, sizeof(a)); return a
def text(letter=b'A'): return bytes(bytearray(letter * 500))
def churn():
    for _ in range(3): gc.collect()
    return [fresh(0x6a) for _ in range(400)] + [bytes(bytearray(b'j' * 500)) for _ in range(400)]
def show(name, pointer_):
    junk = churn()
    try: beyond = hex(pointer_[1][0])
    except ValueError: beyond = 'ValueError'
    print('%-62s %#x; the one behind it: %s' % (name, pointer_[0][63], beyond))
def show_text(name, read):
    junk = churn()
    value = read()
    print('%-62s %d of %r' % (name, len(value), value[:1]))

# The typed arrays and DataViews of one ArrayBuffer are views of one memory.
buffer = js.eval('new ArrayBuffer(64)'); view_of = js.eval('((b, offset) => new Uint8Array(b, offset))')
S.from_buffer(view_of(buffer, 0)).ptr = pointer(fresh())
show('stored and read by way of two typed arrays of one ArrayBuffer', S.from_buffer(view_of(buffer, 0)).ptr)
show('read by way of the ArrayBuffer itself', S.from_buffer(buffer).ptr)
S.from_buffer(view_of(buffer, 32)).ptr = pointer(fresh(0x22))
show('a typed array that begins further in', S.from_buffer(buffer, 32).ptr)

S.from_buffer(js.eval('(b => new DataView(b))')(buffer)).other = pointer(fresh(0x33))
show('stored by way of a DataView', S.from_buffer(view_of(buffer, 0)).other)

# CPython's flags call a class derived from c_char_p no pointer, and a structure with such a field one without pointers.
class Mine(c_char_p): pass
class T(Structure): _fields_ = [('n', c_long), ('a', Mine)]
class DT(Structure): _fields_ = [('before', c_long), ('inner', T), ('two', T * 2)]
# Nor do they say of a structure what it has from the structure that it is derived from.
class Derived(S): _fields_ = [('x', c_int)]
class More(Derived): _fields_ = [('y', c_int)]
class HoldsDerived(Structure): _fields_ = [('before', c_long), ('inner', More), ('two', More * 2)]
m = More(); m.ptr = pointer(fresh()); hd = HoldsDerived(); hd.inner = m; hd.two[1] = m; del m; hd._objects.clear()
show('a structure that has its pointer from its base, stored into a field', hd.inner.ptr)
show('and into an item', hd.two[1].ptr)
t = T(); t.a = Mine(text()); t._objects.clear()
show_text('a field of a class derived from c_char_p', lambda: t.a.value)
dt = DT(); dt.inner = t; dt.two[1] = t; del t; dt._objects.clear()
show_text('the structure stored into a field', lambda: dt.inner.a.value)
show_text('and into an item', lambda: dt.two[1].a.value)

