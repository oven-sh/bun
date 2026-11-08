# How far the memory of an instance goes is a matter of the instance. What its class says of sizes, lengths and shapes is another: a class can be assigned, can be
# given its fields late, and code of the program runs between a look and what the look was for. (CPython reads and writes beyond in these, or dies.)
import ctypes, gc, sys


def attempt(f):
    try:
        return repr(f())
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


class S64(ctypes.Structure):
    _fields_ = [('f%d' % i, ctypes.c_char) for i in range(64)]


def as_class(target):
    x = S64()
    x.__class__ = target
    return x


print('--- a class is assigned that takes the instance for more than it is')
for target in (ctypes.c_wchar * 16, ctypes.c_wchar * 4000, ctypes.c_char * 64, ctypes.c_char * 65, ctypes.c_ubyte * 400000, (ctypes.c_ubyte * 1000) * 1000, ctypes.c_int * 16, ctypes.c_int * 17):
    x = as_class(target)
    print(target.__name__, len(x), ctypes.sizeof(x), '|', attempt(lambda: len(x[:])), '|', attempt(lambda: len(x[::-1])), '|', attempt(lambda: x[len(x) - 1] and None), '|',
        attempt(lambda: memoryview(x).shape), '|', attempt(lambda: len(bytes(x))), '|', attempt(lambda: len(x.raw)), '|', attempt(lambda: len(x.value)))
x = ctypes.c_char()
x.__class__ = ctypes.c_long
print(attempt(lambda: x.value), '|', attempt(lambda: setattr(x, 'value', 1)), '|', attempt(lambda: memoryview(x).nbytes), '|', attempt(lambda: ctypes.CDLL(None).labs(x)))
ctypes.resize(x, 8)
print(attempt(lambda: x.value), '|', attempt(lambda: memoryview(x).nbytes))

print('--- an array as the parameter of a callback: C passes a pointer')
got = []
array = (ctypes.c_ubyte * 4000)()
ctypes.CFUNCTYPE(None, ctypes.c_ubyte * 4000)(lambda a: got.append(bytes(a)))(array)
print(len(got[0]), int.from_bytes(got[0][:8], sys.byteorder) == ctypes.addressof(array), any(got[0][8:]))

print('--- a class is given its fields by a hook, between the look at the buffer and the making of the instance')
armed = []
def hook(event, args):
    if armed and event.startswith('ctypes.cdata'):
        armed.pop()._fields_ = [('a', ctypes.c_char * 100000)]
sys.addaudithook(hook)
for method in ('from_buffer', 'from_buffer_copy'):
    class Late(ctypes.Structure):
        pass
    armed.append(Late)
    print(method, attempt(lambda: ctypes.sizeof(getattr(Late, method)(bytearray(8)))), ctypes.sizeof(Late))

print('--- a result type is given its fields by a callback, while the call is under way')
class Begun(ctypes.Structure):
    _fields_ = [('first', ctypes.c_int)]
class Result(Begun):
    pass
def callback():
    print(attempt(lambda: setattr(Result, '_fields_', [('a', ctypes.c_char * 100000)])))
    return 0
inner = ctypes.CFUNCTYPE(ctypes.c_int)(callback)
outer = ctypes.CFUNCTYPE(Result)(ctypes.cast(inner, ctypes.c_void_p).value)
print(attempt(lambda: ctypes.sizeof(outer())), ctypes.sizeof(Result))

print('--- what a pointer points into goes away while the value is converted')
memory = bytearray(4096)
array = (ctypes.c_long * 512).from_buffer(memory)
pointer = ctypes.cast(array, ctypes.POINTER(ctypes.c_long))
class Releases:
    def __index__(self):
        for kept in array._objects.values():
            if isinstance(kept, memoryview):
                kept.release()
        del memory[:]
        gc.collect()
        return 7
print(attempt(lambda: pointer.__setitem__(3, Releases())), len(memory))
print(attempt(lambda: pointer[3]), '|', attempt(lambda: pointer.contents), '|', attempt(lambda: pointer[0:2]), '|', attempt(lambda: array[3]))

print('--- the conversion makes the pointer point elsewhere: the value goes there')
first, second = (ctypes.c_long * 2)(1, 2), (ctypes.c_long * 2)(3, 4)
pointer = ctypes.POINTER(ctypes.c_long)(ctypes.c_long.from_buffer(first))
class Moves:
    def __index__(self):
        pointer.contents = ctypes.c_long.from_buffer(second)
        return 9
pointer[0] = Moves()
print(first[:], second[:])

print('--- beyond what the pointer points into')
array = (ctypes.c_int * 4)(1, 2, 3, 4)
pointer = ctypes.cast(array, ctypes.POINTER(ctypes.c_int))
for index in (0, 3, 4, -1, 1000, 2 ** 61, 2 ** 62, -2 ** 62, 2 ** 63 - 1, -2 ** 63):
    print(index, attempt(lambda: pointer[index]), '|', attempt(lambda: pointer.__setitem__(index, 5)))
text = ctypes.cast((ctypes.c_char * 8)(*b'abcdefgh'), ctypes.POINTER(ctypes.c_char))
for where in (slice(0, 8), slice(0, 16), slice(0, 17), slice(7, None, -1), slice(-1, 3), slice(2 ** 62, 2 ** 62 + 2), slice(0, 2 ** 62), slice(0, 2 ** 63 - 1, 2 ** 62), slice(5, 5), slice(8, 2)):
    print(where, attempt(lambda: text[where]))
null = ctypes.POINTER(ctypes.c_char)()
print(attempt(lambda: null[0]), '|', attempt(lambda: null[0:2]), '|', attempt(lambda: null[0:0]), '|', attempt(lambda: null.contents), '|', attempt(lambda: null.__setitem__(0, 'no')), '|', attempt(lambda: null.__setitem__(0, b'x')))

print('--- the type of the items is given its fields after the type of the array was made')
class Item(ctypes.Structure):
    pass
Items = Item * 100000
Item._fields_ = [('a', ctypes.c_long), ('b', ctypes.c_long)]
items = Items()
print(ctypes.sizeof(Item), ctypes.sizeof(Items), len(items), '|', attempt(lambda: memoryview(items).nbytes), '|', attempt(lambda: bytes(items)), '|', attempt(lambda: items[5].a), '|', attempt(lambda: items[99999]))

print('--- of the pointers in a structure one has lost what it points into; the others have not')
libc = ctypes.CDLL(None)
libc.malloc.restype, libc.malloc.argtypes = ctypes.c_void_p, [ctypes.c_size_t]
class Three(ctypes.Structure):
    _fields_ = [('a', ctypes.POINTER(ctypes.c_int)), ('c', ctypes.POINTER(ctypes.c_int)), ('d', ctypes.POINTER(ctypes.c_char))]
memory = bytearray(16)
number = ctypes.c_int.from_buffer(memory)
number.value = 7
of_c = libc.malloc(64)
ctypes.memset(of_c, 1, 64)
three = Three(ctypes.pointer(number), ctypes.cast(of_c, ctypes.POINTER(ctypes.c_int)), ctypes.cast(ctypes.c_char_p(b'hello'), ctypes.POINTER(ctypes.c_char)))
def look():
    print(attempt(lambda: three.a[0]), '|', attempt(lambda: three.c[0]), '|', attempt(lambda: three.c.__setitem__(1, 5)), '|', attempt(lambda: three.c.contents.value), '|', attempt(lambda: three.d[0]), '|', attempt(lambda: three.d[0:5]))
look()
number._objects.release()
del memory[:]
look()
three.a = ctypes.pointer(ctypes.c_int(9))
look()

print('--- many pointers in one structure: each is looked up under its own place')
class Many(ctypes.Structure):
    _fields_ = [('p%d' % i, ctypes.POINTER(ctypes.c_int)) for i in range(40)]
memories = [bytearray(b'\x11' * 65536) for i in range(40)]
numbers = [ctypes.c_int.from_buffer(memory) for memory in memories]
many = Many(*[ctypes.pointer(number) for number in numbers])
print(attempt(lambda: many.p39[0]), '|', attempt(lambda: many.p39[10 ** 6]))
numbers[39]._objects.release()
memories[39].clear()
gc.collect()
print(attempt(lambda: many.p39[0]), '|', attempt(lambda: many.p39.__setitem__(0, 1)), '|', attempt(lambda: many.p0[0]), '|', attempt(lambda: many.p38[0]))

print('--- a pointer in something that was stored whole: what is kept for it came along')
class Inner(ctypes.Structure):
    _fields_ = [('n', ctypes.c_int), ('p', ctypes.POINTER(ctypes.c_int))]
class Outer(ctypes.Structure):
    _fields_ = [('m', ctypes.c_int), ('s', Inner), ('a', ctypes.POINTER(ctypes.c_int) * 3)]
memory = bytearray(16)
four = (ctypes.c_int * 4).from_buffer(memory)
four[:] = 1, 2, 3, 4
inner = Inner(5, ctypes.cast(four, ctypes.POINTER(ctypes.c_int)))
of_c_too = Inner(6, ctypes.cast(of_c, ctypes.POINTER(ctypes.c_int)))
inners = (Inner * 3)()
inners[1], inners[2] = inner, of_c_too
outer = Outer(1, inner)
pointers = (ctypes.POINTER(ctypes.c_int) * 3)()
pointers[2], pointers[0] = inner.p, of_c_too.p
outer.a = pointers
outers = (Outer * 2)()
outers[1] = outer
def look():
    for name, pointer in (('inner.p', inner.p), ('inners[1].p', inners[1].p), ('outer.s.p', outer.s.p), ('outer.a[2]', outer.a[2]), ('outers[1].s.p', outers[1].s.p), ('outers[1].a[2]', outers[1].a[2]),
            ('inners[2].p', inners[2].p), ('outer.a[0]', outer.a[0]), ('outers[1].a[0]', outers[1].a[0])):
        print(name, attempt(lambda: pointer[3]), '|', attempt(lambda: pointer[400]) if name not in ('inners[2].p', 'outer.a[0]', 'outers[1].a[0]') else 'memory of C')
look()
for kept in four._objects.values():
    if isinstance(kept, memoryview):
        kept.release()
del memory[:]
look()

print('--- what a place was once made to point into has gone; the pointer that is there now points to memory of C')
def lost():
    memory = bytearray(64)
    number = ctypes.c_int.from_buffer(memory)
    pointer = ctypes.pointer(number)
    number._objects.release()
    del memory[:]
    return pointer
def to_c():
    return ctypes.cast(of_c, ctypes.POINTER(ctypes.c_int))
class Either(ctypes.Union):
    _fields_ = [('p', ctypes.POINTER(ctypes.c_int)), ('q', ctypes.POINTER(ctypes.c_int))]
inners = (Inner * 2)()
inners[0].p = lost()
inners[0] = Inner(1, to_c())
print(attempt(lambda: inners[0].p[0]))
inners[1] = Inner(1, lost())
inners[1].p = to_c()
print(attempt(lambda: inners[1].p[0]))
either = Either()
either.p = lost()
either.q = to_c()
print(attempt(lambda: either.p[0]), attempt(lambda: either.q[0]))
inner = Inner()
inner.p = lost()
ctypes.memmove(ctypes.byref(inner, Inner.p.offset), ctypes.byref(ctypes.c_void_p(of_c)), ctypes.sizeof(ctypes.c_void_p))
print(attempt(lambda: inner.p[0]))
alone = lost()
ctypes.memmove(ctypes.byref(alone), ctypes.byref(ctypes.c_void_p(of_c)), ctypes.sizeof(ctypes.c_void_p))
print(attempt(lambda: alone[0]))

print('--- it has gone, and is looked at by another way than it was stored by')
class Named(ctypes.Structure):
    _fields_ = [('b', ctypes.POINTER(ctypes.c_int))]
class Anonymous(ctypes.Structure):
    _anonymous_ = ('an',)
    _fields_ = [('an', Named)]
either = Either()
either.q = lost()
print(attempt(lambda: either.p[0]), '|', attempt(lambda: either.p.__setitem__(0, 1)))
anonymous = Anonymous()
anonymous.b = lost()
print(attempt(lambda: anonymous.an.b[0]), '|', attempt(lambda: anonymous.b[0]))
anonymous = Anonymous()
anonymous.an.b = lost()
print(attempt(lambda: anonymous.an.b[0]), '|', attempt(lambda: anonymous.b[0]))

print('--- a pointer type that points to no type: the pointer is looked at first')
class Abstract(ctypes._Pointer):
    pass
abstract = Abstract.from_buffer(bytearray(8))
print(attempt(lambda: abstract[0]), '|', attempt(lambda: abstract.contents), '|', attempt(lambda: abstract[0:1]))
abstract = Abstract.from_buffer(bytearray(b'\1' * 8))
print(attempt(lambda: abstract[0]), '|', attempt(lambda: abstract.contents), '|', attempt(lambda: abstract[0:1]))

print('--- an instance over an instance over a bytearray: the view of the first cannot be released under the second, so the memory does not move')
memory = bytearray(64)
over_it = (ctypes.c_char * 64).from_buffer(memory)
over_that = (ctypes.c_int * 4).from_buffer(over_it)
pointer = ctypes.cast(over_that, ctypes.POINTER(ctypes.c_int))
print([attempt(kept.release) for kept in over_it._objects.values()], '|', attempt(memory.clear), '|', attempt(lambda: memory.extend(b'w' * 4096)))
print(attempt(lambda: over_that[0]), '|', attempt(lambda: pointer[0]), '|', attempt(lambda: pointer.__setitem__(0, 1)), '|', attempt(lambda: ctypes.cast(over_that, ctypes.POINTER(ctypes.c_int))[0]))

print('--- a hook releases the view that from_buffer() has just made')
memory = bytearray(64)
releases = ['ctypes.cdata/buffer', 'ctypes.cdata']
def hook(event, args):
    if releases and event == releases[0]:
        for o in gc.get_objects():
            if type(o) is memoryview and o.obj is memory:
                o.release()
sys.addaudithook(hook)
while releases:
    print(releases[0], attempt(lambda: (ctypes.c_int * 4).from_buffer(memory)[0]))
    del releases[0]
print(attempt(lambda: (ctypes.c_int * 4).from_buffer(memory)[0]))
