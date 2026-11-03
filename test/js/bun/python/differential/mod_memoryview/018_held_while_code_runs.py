# What takes a buffer holds it while code of the program runs.
import codecs, struct, array
def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)
ba = bytearray(b'ab\xffcd'); m = memoryview(ba)
def handler(e):
    t(lambda: m.release())
    t(lambda: ba.append(1))
    t(lambda: ba.clear())
    return ('?', e.end)
codecs.register_error('test.evil', handler)
t(lambda: str(m, 'ascii', 'test.evil'))
t(lambda: codecs.decode(m, 'utf-8', 'test.evil'))
t(lambda: ba.decode('ascii', 'test.evil'))
t(lambda: codecs.utf_8_decode(m, 'test.evil'))
m.release(); ba.append(1); print(ba)
a = array.array('B', b'ab\xffcd')
def handler2(e):
    t(lambda: a.append(1))
    return ('?', e.end)
codecs.register_error('test.evil2', handler2)
t(lambda: str(a, 'ascii', 'test.evil2')); t(lambda: codecs.decode(memoryview(a), 'ascii', 'test.evil2')); a.append(1); print(a)

class Index:
    def __init__(self, f): self.f = f
    def __index__(self):
        t(self.f)
        return 1
b = bytearray(8); v = memoryview(b)
struct.pack_into('<bb', v, 0, 1, Index(lambda: v.release())); print(b)
struct.pack_into('<bb', v, 0, 2, Index(lambda: b.clear())); print(b)
struct.pack_into('<bb', b, 0, 3, Index(lambda: b.clear())); print(b)
v[Index(lambda: b.append(1))] = 5; print(b)
v[0] = Index(lambda: b.append(1)); print(b)
v[Index(lambda: None):3] = b'xy'; print(b)
t(lambda: v.hex(':', Index(lambda: b.append(1))))
t(lambda: v.index(1, Index(lambda: b.append(1))))
t(lambda: v.cast('B', [Index(lambda: None)]))
v.release(); b.append(1); print(b)

# a view of a view of ...
b = bytearray(b'abcdef')
v1 = memoryview(b); v2 = v1.__buffer__(0); v3 = v2.__buffer__(0)
t(lambda: v1.release()); t(lambda: v2.release()); print(v3.obj is v2, v2.obj is v1, v1.obj is b)
v3.release(); t(lambda: v1.release()); v2.release(); v1.release(); b.append(1); print(b)
# slices keep the whole
b = bytearray(b'abcdef'); s = memoryview(b)[2:4]; t(lambda: b.append(1)); s[0] = 88; print(b, s.tobytes()); s.release(); b.append(1); print(b)
# the exporter outlives its name
def make():
    local = bytearray(b'local')
    return memoryview(local)
k = make(); k[0] = 76; print(k.tobytes(), k.obj)
def make2():
    return memoryview(bytes(b'temporary'))[2:6]
import gc
k2 = make2(); gc.collect(); print(k2.tobytes(), k2.obj)
views = [memoryview(bytes([i]) * 3)[1:] for i in range(200)]; gc.collect(); print(sum(v[0] for v in views), len({v.obj for v in views}))
