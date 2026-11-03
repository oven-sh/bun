# Damaged and truncated input.
import lzma
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:120] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e, e.args, type(e).__mro__[1].__name__)
D = lzma.LZMADecompressor
F = lzma
text = b'The quick brown fox jumps over the lazy dog. ' * 4
RAW = [{'id': F.FILTER_LZMA2, 'preset': 0}]
for junk in (b'garbage data here', b'\xfd7zXZ', b'\xfd7zXZ\0', b'\xfd7zXZ\0\0\0', b'\xfd7zXZ\0\0\4\0\0\0\0', b'\xfd7zXZ\0\0\x0f' + b'\0' * 20, b'\xfd7zXZ\0\1\4' + b'\0' * 20, b'\0' * 100, b'\xff' * 100, b']\0\0\x80\0' + b'\xff' * 8 + b'\1' * 30,
             b']\0\0\x80\0' + b'\0' * 8, b']\0\0\x80\0' + b'\5' + b'\0' * 7 + b'\0' * 30, b'\xe1\0\0\x80\0' + b'\xff' * 8 + b'\0' * 10, b'LZIP', b'LZIP\1', b'LZIP\2\x10' + b'\0' * 30, b'LZIP\1\x01' + b'\0' * 30, b'LZIP\0\x10' + b'\0' * 40):
    for fmt in (F.FORMAT_AUTO, F.FORMAT_XZ, F.FORMAT_ALONE):
        d = D(fmt); t(d.decompress, junk); print(d.eof, d.needs_input, d.unused_data, d.check)
        t(d.decompress, junk); t(d.decompress, b''); print(d.eof, d.needs_input, d.unused_data, d.check)
    d = D(F.FORMAT_RAW, filters=RAW); t(d.decompress, junk); print(d.eof, d.needs_input, d.unused_data, d.check); t(d.decompress, b'')
# Every byte of a small stream damaged in turn, in streams that both sides make alike: with no compression to speak of.
def stored(check): return lzma.compress(text[:45], check=check, preset=0)
for check in (F.CHECK_NONE, F.CHECK_CRC32, F.CHECK_CRC64, F.CHECK_SHA256):
    small = stored(check); kinds = {}
    for i in range(len(small)):
        for flip in (1, 0x80, 0xff):
            bad = bytearray(small); bad[i] ^= flip
            d = D()
            try: r = ('ok', d.decompress(bytes(bad)) == text[:45], d.eof, d.needs_input)
            except Exception as e: r = (type(e).__name__, str(e), d.needs_input, d.eof)
            kinds[r] = kinds.get(r, 0) + 1
    print(check, len(small), small.hex())
    for k in sorted(kinds, key=repr): print(k, kinds[k])
    states = {}
    for i in range(len(small)):
        d = D(); out = d.decompress(small[:i]); k = (len(out), d.eof, d.needs_input, d.unused_data, d.check); states[k] = states.get(k, 0) + 1
    print(sorted(states.items()))
# After an error the object goes on answering, as the library does.
import random
c = lzma.compress(random.Random(3).randbytes(20000), preset=0)
d = D(); print(len(c), len(d.decompress(c[:5000] + b'\xff' * 3000, 10)))
def drain():
    n = 0
    while not d.needs_input: n += len(d.decompress(b'', 100000))
    return n
t(drain); print(d.eof, d.needs_input, d.unused_data); t(d.decompress, b''); t(d.decompress, c); t(d.decompress, c, 5)
bad = bytearray(c); bad[-20] ^= 0x10
d = D(); t(lambda: len(d.decompress(bytes(bad)))); print(d.eof, d.needs_input)
# A check that the library does not know: the data comes out all the same.
u = bytearray(lzma.compress(text, check=F.CHECK_CRC32, preset=0))
import zlib
for cid in (2, 3, 5, 15):
    v = bytearray(u); v[7] = cid; v[8:12] = zlib.crc32(bytes(v[6:8])).to_bytes(4, 'little')
    d = D(); t(d.decompress, bytes(v)); print(d.check, d.eof)
