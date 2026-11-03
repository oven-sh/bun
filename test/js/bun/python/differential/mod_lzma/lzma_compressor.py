# LZMACompressor: arguments, their errors, and use after the end.
import lzma
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e, e.args)
C = lzma.LZMACompressor
F = lzma
two = [{'id': F.FILTER_LZMA2, 'preset': 0}]; one = [{'id': F.FILTER_LZMA1, 'preset': 0}]
t(C); t(C, F.FORMAT_XZ, -1, None, None); t(C, F.FORMAT_XZ, -1, None, None, None); t(C, format=F.FORMAT_XZ, check=-1, preset=None, filters=None); t(C, foo=1); t(C, 1, format=1); t(C, 1, 4, check=4)
t(C, *range(7)); t(C, 1, 2, 3, 4, foo=5); t(C, **{'format': 1, 'x': 2, 'y': 3}); t(C, **{'a': 1, 'b': 2, 'c': 3, 'd': 4, 'e': 5})
for fmt in (-1, 0, 1, 2, 3, 4, 5, 100, 2**31 - 1, -2**31, 2**31, -2**31 - 1, 2**63, 2**64, -2**64, 'a', None, 1.0, b'', [], True, False):
    t(C, fmt); t(C, format=fmt, filters=two)
for check in (-2, -1, 0, 1, 2, 3, 4, 5, 9, 10, 11, 15, 16, 17, 100, 2**31 - 1, -2**31, 2**31, -2**31 - 1, 2**64, 'a', None, 1.0, True):
    for fmt, kw in ((F.FORMAT_XZ, {}), (F.FORMAT_XZ, {'filters': two}), (F.FORMAT_ALONE, {}), (F.FORMAT_RAW, {'filters': two}), (F.FORMAT_AUTO, {}), (9, {})):
        t(C, fmt, check, **kw)
for preset in (-1, 0, 5, 9, 10, 31, 32, F.PRESET_EXTREME, F.PRESET_EXTREME | 9, F.PRESET_EXTREME | 10, 2**30, 2**32 - 1, 2**32, 2**64, -2**64, 'a', 1.0, b'', [], True, False, None):
    for fmt in (F.FORMAT_XZ, F.FORMAT_ALONE, F.FORMAT_RAW, F.FORMAT_AUTO, 9): t(C, fmt, preset=preset)
    t(C, preset=preset, filters=two); t(C, F.FORMAT_ALONE, 4, preset)
t(C, F.FORMAT_RAW); t(C, F.FORMAT_RAW, preset=1); t(C, F.FORMAT_RAW, filters=None); t(C, F.FORMAT_RAW, 0, None, two); t(C, F.FORMAT_RAW, 1, None, two)
t(C, F.FORMAT_ALONE, filters=two); t(C, F.FORMAT_ALONE, filters=one); t(C, F.FORMAT_ALONE, filters=one + one); t(C, F.FORMAT_ALONE, filters=[{'id': F.FILTER_DELTA}] + one); t(C, F.FORMAT_ALONE, filters=[])
t(C, F.FORMAT_XZ, filters=one); t(C, F.FORMAT_XZ, filters=[]); t(C, F.FORMAT_RAW, filters=[]); t(C, F.FORMAT_RAW, filters=one); t(C, F.FORMAT_RAW, filters=[{'id': F.FILTER_DELTA}])
# The order of the complaints
t(C, 'a', 'b', 'c', 'd'); t(C, 1, 'b', 'c', 'd'); t(C, 1, 1, 'c', 'd'); t(C, 1, 1, 'c', None); t(C, 1, 1, None, 'd'); t(C, 2, 1, 'c', 'd'); t(C, 9, 1, 'c', 'd'); t(C, 9, -1, 'c', 'd'); t(C, 9, -1, 'c'); t(C, 9, -1, 99)
class I:
    def __init__(self, n, v): self.n, self.v = n, v
    def __index__(self): print('index', self.n); return self.v
t(C, I('format', 1), I('check', 4), I('preset', 3)); t(C, preset=I('preset', 3), check=I('check', 4), format=I('format', 1)); t(C, I('format', 2), I('check', 4), I('preset', 3)); t(C, I('format', 1), I('check', 4), I('preset', 3), two)
# Methods
co = C(preset=0); t(co.compress); t(co.compress, b'', b''); t(co.compress, data=b''); t(co.flush, 1); t(co.flush, x=1)
for bad in ('str', 5, None, [1, 2], memoryview(b'abcd')[::2], 1.5, object()): t(co.compress, bad)
print(len(co.compress(b'abc')), co.compress(b''))
out = co.flush(); print(out[-2:]); t(co.compress, b'abc'); t(co.compress, b''); t(co.flush); t(co.flush); t(co.compress, 'str'); t(co.compress)
for fmt, kw in ((F.FORMAT_XZ, {}), (F.FORMAT_ALONE, {}), (F.FORMAT_RAW, {'filters': two}), (F.FORMAT_RAW, {'filters': one})):
    co = C(fmt, **kw); a = co.compress(b''); b = co.compress(b''); c = co.flush(); print(fmt, len(a), len(b), len(c), lzma.decompress(a + b + c, fmt, **kw)); t(co.flush)
    co = C(fmt, **kw); c = co.flush(); print(len(c), lzma.decompress(c, fmt, **kw))
import array
data = b'spam and eggs ' * 300
for make in (bytes, bytearray, memoryview, lambda b: array.array('B', b), lambda b: array.array('H', b), lambda b: memoryview(b).cast('H'), lambda b: memoryview(b).cast('B', (len(b) // 2, 2))):
    co = C(preset=0); print(lzma.decompress(co.compress(make(data)) + co.flush()) == data)
# The module's functions on top
t(lzma.compress, data, 9); t(lzma.compress, data, F.FORMAT_RAW); t(lzma.compress, 'a'); t(lzma.compress); t(lzma.compress, data, preset=77); t(lzma.compress, data, check=7); t(lzma.compress, data, check=16)
t(lzma.decompress, data); t(lzma.decompress, 'a'); t(lzma.decompress, b'', 9); t(lzma.decompress, b'', F.FORMAT_RAW)
print(lzma.is_check_supported(F.CHECK_SHA256), lzma.is_check_supported(2), lzma.is_check_supported(F.CHECK_UNKNOWN))
