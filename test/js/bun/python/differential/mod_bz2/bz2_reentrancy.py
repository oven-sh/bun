# What runs while the arguments are converted cannot take the memory of the data away, nor use the object halfway.
import bz2
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
plain = bytes(range(256)) * 40
packed = bz2.compress(plain)
class N:
    "A number that tries to empty the bytearray when it is asked which number."
    def __init__(self, data, value): self.data, self.value = data, value
    def __index__(self):
        t(self.data.clear); t(self.data.extend, b'x' * 100000); self.data[0] ^= 0
        return self.value
d = bytearray(packed); t(lambda: bz2.BZ2Decompressor().decompress(d, N(d, 100)) == plain[:100]); print(len(d)); d.clear()
d = bytearray(packed); t(lambda: bz2.BZ2Decompressor().decompress(data=d, max_length=N(d, -1)) == plain); d.clear()
# The same object is used while max_length is asked for.
class Use:
    def __init__(self, o, data): self.o, self.data = o, data
    def __index__(self): print('inner', len(self.o.decompress(self.data, 50)), self.o.needs_input); return 70
o = bz2.BZ2Decompressor(); a = o.decompress(b'', Use(o, packed)); print(len(a), a == plain[50:120], o.needs_input, o.eof)
o = bz2.BZ2Decompressor(); t(lambda: len(o.decompress(packed[10:], Use(o, packed[:10])))); print(o.needs_input, o.eof)
class End:
    def __init__(self, o): self.o = o
    def __index__(self): print('inner', self.o.decompress(packed) == plain, self.o.eof); return 5
o = bz2.BZ2Decompressor(); t(o.decompress, b'more', End(o)); print(o.eof, o.unused_data)
# Objects that give out a buffer of their own making
class B:
    def __init__(self, data): self.data = data
    def __buffer__(self, flags): print('__buffer__', int(flags)); return memoryview(self.data)
    def __release_buffer__(self, view): print('__release_buffer__'); view.release()
t(lambda: bz2.decompress(bz2.compress(B(plain))) == plain); t(lambda: bz2.BZ2Decompressor().decompress(B(packed)) == plain)
class Bad:
    def __buffer__(self, flags): raise KeyError('no buffer')
t(bz2.compress, Bad()); t(bz2.BZ2Decompressor().decompress, Bad()); c = bz2.BZ2Compressor(); t(c.compress, Bad()); print(bz2.decompress(c.compress(b'ok') + c.flush()))
class Flush:
    def __init__(self, c): self.c = c
    def __buffer__(self, flags): print('flushed', len(self.c.flush())); return memoryview(b'late')
c = bz2.BZ2Compressor(); t(c.compress, Flush(c)); t(c.flush)
# The result does not share memory with the input, and the kept input does not either.
d = bytearray(packed); o = bz2.BZ2Decompressor(); a = o.decompress(d, 10); d[:] = b'\0' * len(d); d.clear(); print(a + o.decompress(b'') == plain, o.eof)
d = bytearray(packed + b'tail'); o = bz2.BZ2Decompressor(); a = o.decompress(d); d[:] = b'\0' * len(d); print(a == plain, o.unused_data)
