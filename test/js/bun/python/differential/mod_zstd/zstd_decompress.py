import _zstd
from compression import zstd
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:150] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
C, D, Z, E = _zstd.ZstdCompressor, _zstd.ZstdDecompressor, _zstd.ZstdDict, _zstd.ZstdError
data = b''.join(b'%d: never gonna give you up, never gonna let you down\n' % i for i in range(4000))
x = C().compress(data, 2)
d = D(); print(d.eof, d.needs_input, d.unused_data)
print(d.decompress(x) == data, d.eof, d.needs_input, d.unused_data)
t(d.decompress, b''); t(d.decompress, b'x'); print(d.eof, d.unused_data)
for extra in (b'x', b'trailing', x):
    d = D(); print(d.decompress(x + extra) == data, d.eof, d.needs_input, d.unused_data == extra, d.unused_data is d.unused_data)
for step in (1, 7, 100, 5000, 1 << 20):
    d = D(); out = []
    for i in range(0, len(x), step):
        out.append(d.decompress(x[i:i + step]))
        if i + step < len(x) and (d.eof or not d.needs_input): print('odd', step, i)
    print(step, b''.join(out) == data, d.eof, d.needs_input, d.unused_data)
for limit in (0, 1, 10, 1000, 32768, 32769, 131072, len(data) - 1, len(data), len(data) + 1, 2**62):
    d = D(); out = [d.decompress(x, limit)]; print(limit, len(out[0]), d.eof, d.needs_input, d.unused_data); n = 0
    while not d.eof and n < 60:
        piece = d.decompress(b'', max(limit, 4000)); assert len(piece) <= max(limit, 4000); out.append(piece); n += 1
    print(' ', b''.join(out) == data, d.eof, d.needs_input)
d = D(); a = d.decompress(x[:50], 10); b = d.decompress(x[50:120], 10); print(len(a), len(b), d.needs_input)
rest = d.decompress(x[120:] + b'TAIL'); print(a + b + rest == data, d.eof, d.unused_data)
d = D(); a = d.decompress(x + b'TAIL', 100); print(len(a), d.eof, d.unused_data, d.needs_input)
while not d.eof: a += d.decompress(b'', 50000)
print(a == data, d.unused_data)
d = D(); print(d.decompress(b''), d.needs_input, d.eof, d.decompress(b'', 0), d.decompress(b'', 5))
d = D(); print(len(d.decompress(x[:-1])), d.eof, d.needs_input); print(d.decompress(x[-1:]), d.eof, d.needs_input)
e = C().compress(b'', 2); d = D(); print(d.decompress(e), d.eof, d.needs_input, len(e) < 20)
# Errors put it back to the start.
d = D(); t(d.decompress, b'this is not zstd data'); print(d.eof, d.needs_input, d.unused_data); print(d.decompress(x) == data, d.eof)
d = D(); d.decompress(x[:100]); t(d.decompress, b'\xff' * 100); print(d.eof, d.needs_input); t(lambda: d.decompress(x) == data)
bad = bytearray(C(options={zstd.CompressionParameter.checksum_flag: 1}).compress(data, 2)); bad[-1] ^= 1; t(D().decompress, bytes(bad))
d = D(); t(d.decompress); t(d.decompress, 'a'); t(d.decompress, 1); t(d.decompress, b'', 'a'); t(d.decompress, b'', 1.0); t(d.decompress, b'', 2**70); t(d.decompress, b'', -2**70); t(d.decompress, b'', 1, 2); t(d.decompress, data=x[:10], max_length=-5); t(d.decompress, x=1); t(d.decompress, b'', None)
def se(): d.eof = 1
t(se)
def su(): d.unused_data = b''
t(su)
def sn(): del d.needs_input
t(sn)
Q, P = zstd.DecompressionParameter, zstd.CompressionParameter
t(D, 5); t(D, b'a'); t(D, None, 5); t(D, None, []); t(D, options={Q.window_log_max: 20}); t(D, options={Q.window_log_max: 100}); t(D, options={Q.window_log_max: 1}); t(D, options={P.window_log: 20}); t(D, options={5: 5}); t(D, options={'a': 1}); t(D, options={100: 'b'}); t(D, None, None, None); t(D, x=1); t(D, zstd_dict=None, options=None); t(D, options={2**40: 0}); t(D, options={100: -2**40})
w = C(options={P.window_log: 25}).compress(data * 300, 2)
t(lambda: len(D(options={Q.window_log_max: 27}).decompress(w))); t(lambda: len(D(options={Q.window_log_max: 12}).decompress(w)))
# Skippable frames
skip = b'\x50\x2a\x4d\x18\x04\x00\x00\x00abcd'
d = D(); print(d.decompress(skip), d.eof, d.needs_input, d.unused_data); t(_zstd.get_frame_size, skip); t(_zstd.get_frame_info, skip)
d = D(); print(d.decompress(skip + x)[:5], d.eof, len(d.unused_data) == len(x))
