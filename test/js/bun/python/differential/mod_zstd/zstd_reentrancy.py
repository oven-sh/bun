# The arguments are converted after the buffer of the data is taken: what their methods run cannot take the memory away.
from compression import zstd
import _zstd
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
class N:
    def __init__(self, data, value): self.data, self.value = data, value
    def __index__(self):
        t(self.data.clear); t(self.data.extend, b'x' * 100000)
        return self.value
    def __bool__(self):
        t(self.data.clear)
        return bool(self.value)
plain = bytes(range(256)) * 40
packed = zstd.compress(plain)
d = bytearray(plain); t(lambda: zstd.decompress(_zstd.ZstdCompressor().compress(d, N(d, 2))) == plain); d.clear()
d = bytearray(packed); t(lambda: _zstd.ZstdDecompressor().decompress(d, N(d, 100)) == plain[:100]); d.clear()
d = bytearray(plain); t(lambda: _zstd.ZstdDict(d, is_raw=N(d, 1)).dict_content == plain); d.clear()
# The options are gone through while their keys and values are asked what they are.
class K:
    def __init__(self, options, value): self.options, self.value = options, value
    def __index__(self): self.options.clear(); return self.value
o = {}; o[_zstd.ZSTD_c_compressionLevel] = K(o, 3); o[_zstd.ZSTD_c_checksumFlag] = 1
t(lambda: type(_zstd.ZstdCompressor(options=o)).__name__); print(o)
