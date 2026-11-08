# resize() gives an instance other memory if what it has is too short. There may be addresses of the old memory about: in pointers, which keep the instance alive
# and not its memory, and in the arguments of a call that is being put together. (CPython writes to memory that it has freed.)
import ctypes, gc


def attempt(f):
    try:
        return repr(f())
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


for size in (64, 4096):
    print('--- a pointer from before,', size)
    array = (ctypes.c_char * size)()
    by_cast, by_pointer = ctypes.cast(array, ctypes.POINTER(ctypes.c_int)), ctypes.cast(ctypes.pointer(array), ctypes.POINTER(ctypes.c_int))
    ctypes.resize(array, size * 64)
    ctypes.resize(array, size * 4096)
    gc.collect()
    others = [bytearray(size) for i in range(3000)] + [ctypes.create_string_buffer(size) for i in range(3000)]
    for pointer in (by_cast, by_pointer):
        print(attempt(lambda: pointer.__setitem__(0, 0x41414141)), attempt(lambda: pointer[0]), attempt(lambda: pointer[size // 4]), array[0:4], sum(1 for other in others if b'A' in bytes(other)))
    print(attempt(lambda: ctypes.cast(array, ctypes.POINTER(ctypes.c_int))[size * 1024 - 1]), attempt(lambda: ctypes.cast(array, ctypes.POINTER(ctypes.c_int))[size * 1024]))

    print('--- an argument from before,', size)
    array = (ctypes.c_char * size)()
    others = []
    class Resizes:
        @property
        def _as_parameter_(self):
            ctypes.resize(array, size * 64)
            gc.collect()
            others.extend(bytearray(size) for i in range(3000))
            return 1
    ctypes.CDLL(None).memset(array, 65, Resizes())
    print(array[0:1], sum(1 for other in others if b'A' in other))

print('--- what is kept is not for the program to see')
array = (ctypes.c_int * 4)()
for size in (1000, 100000, 10 ** 6):
    ctypes.resize(array, size)
print(sorted(type(o).__name__ for o in gc.get_referents(array)))

print('--- step by step')
array = (ctypes.c_char * 16)(*b'0123456789abcdef')
first = ctypes.cast(array, ctypes.POINTER(ctypes.c_char))
for size in range(16, 4096 * 2000, 4096):
    ctypes.resize(array, size)
print(ctypes.sizeof(array), array[:], first[0:16], ctypes.string_at(array, 16))
