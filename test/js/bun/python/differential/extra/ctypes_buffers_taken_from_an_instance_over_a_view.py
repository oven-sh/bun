# c = T.from_buffer(v) keeps a view of the memory. A buffer taken from c is a buffer taken from that view: while it is in use the view cannot be released, so whoever owns the memory goes on counting it as exported.
# (No oracle: CPython lets the view be released by hand, and what was taken from c dangles.)
import array, gc, io, mmap, pickle
from ctypes import *
def attempt(f):
    try: return f()
    except Exception as e: return '%s: %s' % (type(e).__name__, str(e)[:70])
class Exporter:
    def __init__(self): self.ba = bytearray(b'x' * 64); self.log = []
    def __buffer__(self, flags): self.log.append('get'); return memoryview(self.ba)
    def __release_buffer__(self, view): self.log.append('release'); view.release()
def shrink(o):
    if isinstance(o, bytearray): return attempt(o.clear)
    if isinstance(o, array.array): return attempt(lambda: o.__delitem__(slice(None)))
    if isinstance(o, io.BytesIO): return attempt(lambda: o.truncate(0))
    if isinstance(o, mmap.mmap): return attempt(o.close)
    return (list(o.log), attempt(o.ba.clear))
MAKERS = (('bytearray', lambda: bytearray(b'x' * 64)), ('array', lambda: array.array('b', b'x' * 64)), ('BytesIO', lambda: io.BytesIO(b'x' * 64)), ('mmap', lambda: mmap.mmap(-1, 64)), ('Exporter', Exporter))
class S(Structure): _fields_ = [('a', c_char * 8), ('b', c_int)]
TAKERS = (('memoryview(c)', lambda c: memoryview(c)), ('from_buffer(c)', lambda c: (c_ubyte * 2).from_buffer(c)), ('PickleBuffer(c)', lambda c: pickle.PickleBuffer(c)), ('PickleBuffer(c).raw()', lambda c: pickle.PickleBuffer(c).raw()),
          ('a slice', lambda c: memoryview(c)[1:3]), ('of a part', lambda c: memoryview(S.from_buffer(c, 8).a)), ('of a part of c', lambda c: memoryview((c_char * 8 * 8).from_buffer(c)[2])), ('twice over', lambda c: memoryview((c_char * 4).from_buffer((c_char * 8).from_buffer(c, 8), 2))))
def read(m):
    if isinstance(m, pickle.PickleBuffer): m = m.raw()
    return bytes(m[:2]) if isinstance(m, memoryview) else m[0]
def let_go(m):
    if hasattr(m, 'release'): m.release()
for name, make in MAKERS:
    for taker, take in TAKERS:
        o = make()
        v = o.getbuffer() if name == 'BytesIO' else memoryview(o)
        c = (c_char * 64).from_buffer(v)
        m = take(c)
        r = [attempt(v.release), attempt(c._objects['ffffffff'].release)]
        gc.collect()
        r += [shrink(o), attempt(lambda: read(m))]
        print('%-10s %-22s' % (name, taker), r)
        let_go(m); del m; gc.collect()
        print('    when it has been let go of:', attempt(c._objects['ffffffff'].release), shrink(o), attempt(lambda: c[0]))

print('--- an export that fails gives back what it counted')
ba = bytearray(64); c = (c_char * 64).from_buffer(ba)
print(attempt(lambda: c.__buffer__('x')), attempt(lambda: c.__buffer__(1 << 70)), attempt(c._objects['ffffffff'].release), attempt(ba.clear))

print('--- all is dropped: the collector lets go in the right order')
for taker, take in TAKERS:
    ba = bytearray(64); c = (c_char * 64).from_buffer(memoryview(ba)); m = take(c)
    before = attempt(ba.clear)
    del c, m; gc.collect(); gc.collect()
    print('%-22s' % taker, before, '|', attempt(ba.clear))

print('--- many at once')
ba = bytearray(64); c = (c_char * 64).from_buffer(ba); ms = [memoryview(c) for _ in range(5)]
for m in ms:
    print(attempt(c._objects['ffffffff'].release))
    m.release()
print(attempt(c._objects['ffffffff'].release), attempt(ba.clear))
