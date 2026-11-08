# Eight bytes hold an address. What they point to has to live, and it has to be known how far it goes, for as long as the eight bytes say so: whatever has become of _objects, which a program can
# write to, which instances share by reference, and whose keys are places in an instance. (In CPython most of these read memory that has been freed: there is nothing to compare with.)
import gc
from ctypes import *

Longs = c_ulong * 64
PLongs = POINTER(Longs)
class S(Structure): _fields_ = [('n', c_long), ('ptr', PLongs), ('other', PLongs)]
class D(Structure): _fields_ = [('before', c_long), ('inner', S), ('two', S * 2)]
class U(Union): _fields_ = [('ptr', PLongs), ('n', c_size_t)]

def fresh(value=0x11):
    a = Longs(); memset(a, value, sizeof(a)); return a

def churn():
    # What is free is taken again, and written over.
    for _ in range(3): gc.collect()
    return [fresh(0x6a) for _ in range(400)]

def show(name, pointer_):
    junk = churn()
    try: beyond = hex(pointer_[1][0])
    except ValueError: beyond = 'ValueError'
    made = pointer_[0]
    del pointer_
    junk += churn()
    print('%-62s %#x, %#x; the one behind it: %s' % (name, made[0], made[63], beyond))

p = pointer(fresh()); p._objects.clear()
show('a pointer whose _objects have been emptied', p)

p = PLongs(); p.contents = fresh(); p._objects.clear()
show('contents set, _objects emptied', p)

s = S(); s.ptr = pointer(fresh()); s._objects.clear()
show('a field, _objects emptied', s.ptr)

s = S(); s.ptr = pointer(fresh()); s.other = pointer(fresh(0x22)); s._objects.pop('1')
show('a field, its key popped', s.ptr)
show('the field beside it', s.other)

# What is kept for s1.ptr is handed on by reference, under a key that s1 then uses for something else.
s1 = S(); s2 = S(); s1.ptr = pointer(fresh()); s2.ptr = s1.ptr; s1.ptr = pointer(fresh(0x33))
show('a field copied from a field that is then stored to again', s2.ptr)
show('the field that was stored to again', s1.ptr)

s = S(); pointer(s)[0].ptr = pointer(fresh())
show('stored through a pointer to the structure', s.ptr)

s = S(); t = S.from_buffer(s); t.ptr = pointer(fresh()); del t
show('stored by another instance over the same memory', s.ptr)

s = S(); s.ptr = pointer(fresh()); t = S.from_buffer(s); s._objects.clear()
show('read by another instance over the same memory', t.ptr)

b = bytearray(sizeof(S)); S.from_buffer(b).ptr = pointer(fresh())
show('stored and read by two instances over one bytearray', S.from_buffer(b).ptr)

d = D(); s = S(); s.ptr = pointer(fresh()); s.other = pointer(fresh(0x22)); d.inner = s; d.two[1] = s; del s; d._objects.clear()
show('a structure stored into a field', d.inner.ptr)
show('its other pointer', d.inner.other)
show('a structure stored into an item', d.two[1].other)
e = D(); e.two = d.two; del d; e._objects.clear()
show('an array of structures stored into a field', e.two[1].ptr)

a = (PLongs * 300)()
for i in range(300): a[i] = pointer(fresh(i % 251))
a._objects.clear()
junk = churn()
print('300 items, _objects emptied:', all(a[i][0][63] == (i % 251) * 0x0101010101010101 for i in range(300)))

a = (PLongs * 300000)(); a[250000] = pointer(fresh()); a[7] = pointer(fresh(0x22)); a._objects.clear()
show('one item far out in a large array', a[250000])
show('and one near the beginning', a[7])

a = (PLongs * 4)(); a[3] = pointer(fresh()); a[3] = None
try: a[3][0]
except ValueError as e: print('None stored:', e)

s = S(); s.ptr = (Longs * 1)(fresh()); s._objects.clear()
show('an array stored where a pointer is', s.ptr)

# The bytes say something else than what was written down: that is not believed.
kept = fresh(0x44); u = U(); u.ptr = pointer(fresh()); u.n = addressof(kept)
print('an int stored over the pointer: %#x' % u.ptr[0][0])
s = S(); s.ptr = pointer(fresh()); s.other = pointer(kept); memmove(byref(s, S.ptr.offset), byref(s, S.other.offset), 8)
print('memmove() over the pointer: %#x' % s.ptr[0][0])

class Node(Structure): pass
Node._fields_ = [('next', POINTER(Node)), ('value', c_long)]
head = Node(); node = head
for i in range(3000):
    following = Node(); following.value = i + 1; node.next = pointer(following); node._objects.clear(); node = following
del node, following
junk = churn()
count = 0; node = head
while node.next: node = node.next[0]; count += 1
print('a list that nothing but the memory of its nodes holds:', count, node.value)
