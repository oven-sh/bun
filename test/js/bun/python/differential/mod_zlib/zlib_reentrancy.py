# The arguments are converted after the buffer of the data is taken: what their methods run cannot take the memory away.
import zlib
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
class N:
    "A number that tries to empty the bytearray when it is asked which number."
    def __init__(self, data, value): self.data, self.value = data, value
    def __index__(self):
        t(self.data.clear); t(self.data.extend, b'x' * 100000); self.data[0] ^= 0
        return self.value
plain = bytes(range(256)) * 40
packed = zlib.compress(plain)
d = bytearray(plain); t(lambda: zlib.compress(d, N(d, 6)) == zlib.compress(plain, 6)); print(len(d)); d.clear()
d = bytearray(plain); t(lambda: zlib.compress(d, 6, N(d, 15)) == zlib.compress(plain, 6)); d.clear()
d = bytearray(packed); t(lambda: zlib.decompress(d, N(d, 15)) == plain); d.clear()
d = bytearray(packed); t(lambda: zlib.decompress(d, 15, N(d, 10)) == plain); d.clear()
d = bytearray(plain); t(lambda: zlib.crc32(d, N(d, 5)) == zlib.crc32(plain, 5)); d.clear()
d = bytearray(plain); t(lambda: zlib.adler32(d, N(d, 5)) == zlib.adler32(plain, 5)); d.clear()
d = bytearray(packed); t(lambda: zlib.decompressobj().decompress(d, N(d, 100)) == plain[:100]); d.clear()
d = bytearray(packed); t(lambda: zlib._ZlibDecompressor().decompress(d, N(d, 100)) == plain[:100]); d.clear()

# The dictionary is asked for its buffer when the stream wants it, and each time.
words = b'the quick brown fox jumps over the lazy dog ' * 4
c = zlib.compressobj(zdict=words); withdict = c.compress(words * 50) + c.flush()
class D:
    def __buffer__(self, flags): print('__buffer__', int(flags)); return memoryview(words)
    def __release_buffer__(self, view): print('__release_buffer__'); view.release()
o = zlib.decompressobj(zdict=D()); print('made'); t(lambda: o.decompress(withdict[:1])); t(lambda: o.decompress(withdict[1:]) == words * 50); print(o.eof)
o = zlib.decompressobj(zdict=D()); t(lambda: o.decompress(packed) == plain)
class Bad:
    def __buffer__(self, flags): raise KeyError('no buffer')
o = zlib.decompressobj(zdict=Bad()); t(o.decompress, withdict); t(o.decompress, withdict); t(o.flush)
o = zlib.decompressobj(-15, zdict=D()); print('made')
# While the dictionary is asked, the input cannot be resized either.
d = bytearray(withdict)
class E:
    def __buffer__(self, flags): t(d.clear); return memoryview(words)
o = zlib.decompressobj(zdict=E()); t(lambda: o.decompress(d) == words * 50); d.clear()
