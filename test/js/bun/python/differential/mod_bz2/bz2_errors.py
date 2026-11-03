# Bad input, and objects used after their end.
import bz2
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:120] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e, e.args, type(e).__mro__[1].__name__)
C, D = bz2.BZ2Compressor, bz2.BZ2Decompressor
data = b''.join(b'%d green bottles hanging on the wall\n' % i for i in range(3000))
c = bz2.compress(data)
for level in (0, 10, -1, 2**31, -2**31 - 1, 2**64, 'a', None, 1.0, b'1', True, [], 9.5):
    t(C, level)
t(C, 1, 2); t(C, compresslevel=5); t(C, 1, compresslevel=5); t(C, *(1, 2, 3)); t(C, **{'x': 1})
class I:
    def __index__(self): return 4
print(C(I()).compress(b'abc') + b'', len(C(I()).flush()))
co = C(); t(co.compress); t(co.compress, b'', b''); t(co.compress, data=b''); t(co.flush, 1); t(co.flush, x=1)
print(co.compress(b'abc'), co.compress(b''), len(co.flush()))
t(co.compress, b'abc'); t(co.compress, b''); t(co.flush); t(co.flush); t(co.compress, 'str'); t(co.compress)
co = C(); print(co.flush() == bz2.compress(b'')); t(co.flush)
# Garbage
for junk in (b'garbage data here', b'BZ', b'BZh', b'BZh9', b'BZh0' + b'\0' * 20, b'BZhA', b'BZh91AY&SY' + b'\0' * 50, b'BZh91AY&SX', b'\0' * 100, b'BZh9' + b'\x17\x72\x45\x38\x50\x90' + b'\1\2\3\4', c[:4] + c[5:]):
    d = D(); t(d.decompress, junk); print(d.eof, d.needs_input, d.unused_data)
    t(d.decompress, c); t(d.decompress, b''); print(d.eof, d.needs_input, d.unused_data)
# Every byte of a small stream damaged in turn: never more than an error or other data.
small = bz2.compress(b'The quick brown fox jumps over the lazy dog. ' * 4)
kinds = {}
for i in range(len(small)):
    for flip in (1, 0x80, 0xff):
        bad = bytearray(small); bad[i] ^= flip
        d = D()
        try: r = ('ok', d.decompress(bytes(bad)) == b'The quick brown fox jumps over the lazy dog. ' * 4, d.eof)
        except Exception as e: r = (type(e).__name__, str(e), d.needs_input)
        kinds[r] = kinds.get(r, 0) + 1
for k in sorted(kinds, key=repr): print(k, kinds[k])
# Cut short at every length
states = {}
for i in range(len(small)):
    d = D(); out = d.decompress(small[:i]); k = (len(out), d.eof, d.needs_input, d.unused_data); states[k] = states.get(k, 0) + 1
print(sorted(states.items()))
# After an error with kept input
d = D(); print(len(d.decompress(c[:2000] + b'\xff' * 3000, 10))); 
def drain():
    n = 0
    while True: n += len(d.decompress(b'', 100000))
t(drain); print(d.eof, d.needs_input, d.unused_data); t(d.decompress, b''); t(d.decompress, c)
# A wrong checksum of the whole stream is found at the very end.
bad = bytearray(c); bad[-3] ^= 0x10
d = D(); t(lambda: len(d.decompress(bytes(bad)))); print(d.eof, d.needs_input)
d = D(); print(len(d.decompress(bytes(bad), len(data) - 5)), d.eof, d.needs_input); t(lambda: len(d.decompress(b''))); t(d.decompress, b'')
