# max_length, needs_input, eof, unused_data, check, memlimit
import lzma
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
D = lzma.LZMADecompressor
data = b''.join(b'%d green bottles hanging on the wall\n' % i for i in range(2500))
RAW = [{'id': lzma.FILTER_DELTA, 'dist': 2}, {'id': lzma.FILTER_LZMA2, 'preset': 1}]
# Made by liblzma 5.4 or by ours: the sizes of the pieces that come out depend on the input alone only where the whole is given.
kinds = [('xz', lzma.compress(data, preset=1), {}), ('xz', lzma.compress(data, preset=1), {'format': lzma.FORMAT_XZ}), ('alone', lzma.compress(data, lzma.FORMAT_ALONE, preset=1), {}),
         ('alone', lzma.compress(data, lzma.FORMAT_ALONE, preset=1), {'format': lzma.FORMAT_ALONE}), ('raw', lzma.compress(data, lzma.FORMAT_RAW, filters=RAW), {'format': lzma.FORMAT_RAW, 'filters': RAW})]
for kind, c, kw in kinds:
    print(kind, sorted(kw))
    d = D(**kw); print(d.eof, d.needs_input, d.unused_data, d.check)
    print(d.decompress(c) == data, d.eof, d.needs_input, d.unused_data, d.check)
    t(d.decompress, b'x'); t(d.decompress, b''); t(d.decompress, c); print(d.eof, d.needs_input, d.unused_data)
    d = D(**kw); print(d.decompress(c + b'junk') == data, d.eof, d.needs_input, d.unused_data, d.unused_data is d.unused_data)
    for limit in (0, 1, 2, 100, 4096, 32768, 32769, 65536, len(data) - 1, len(data), len(data) + 1, 1 << 40, 2**63 - 1, -1, -2, -2**63):
        d = D(**kw); out = [d.decompress(c, limit)]; n = 0
        print(limit, len(out[0]), d.eof, d.needs_input, d.unused_data, d.check)
        while not d.eof and n < 60:
            out.append(d.decompress(b'', max(limit, 5000))); n += 1
            if not d.eof and d.needs_input: print('wants input', n); break
        print(data == b''.join(out), n, d.eof, d.needs_input, d.unused_data)
    for first, step, limit in ((100, 100, 50), (1, 1, 40), (500, 3, 1000), (len(c), 10, 77), (len(c) - 1, 1, 100000)):
        for always in (False, True):
            d = D(**kw); out = [d.decompress(c[:first], limit)]; i = first; n = 0
            while not d.eof:
                piece = b''
                if always or d.needs_input: piece = c[i:i + step]; i += step
                out.append(d.decompress(piece, limit)); n += 1
                if n > 400000: print('stuck'); break
            print(first, step, limit, always, b''.join(out) == data, max(map(len, out)) <= limit, d.unused_data, d.needs_input)
    d = D(**kw); out = [d.decompress(c + b'TAIL' * 3, 1000)]; print(d.unused_data, d.eof)
    while not d.eof: out.append(d.decompress(b'', 50000))
    print(b''.join(out) == data, d.unused_data, d.needs_input)
    d = D(**kw); out = [d.decompress(c[:-10], 1000)]; out.append(d.decompress(c[-10:] + b'more', 1000)); out.append(d.decompress(b'even more'))
    print(b''.join(out) == data, d.unused_data, d.eof)
    # Called twice without room or without input, the library complains that it gets nowhere.
    d = D(**kw); t(d.decompress, c, 0); print(d.needs_input, d.eof); t(d.decompress, b'', 0); print(d.needs_input, d.eof); t(d.decompress, b'', 0); print(d.needs_input, d.eof)
    t(lambda: d.decompress(b'') == data); print(d.needs_input, d.eof)
    d = D(**kw)
    for a in ((b'', 0), (b'',), (b'', 5), (b'', 0), (b'', 0), (c[:20], 0), (b'', 0), (c[20:],)): t(lambda: len(d.decompress(*a))); print(d.needs_input, d.eof)
# All the input taken, output still held: needs_input is False though nothing is kept.
c = lzma.compress(b'z' * 100000, preset=0)
d = D(); a = d.decompress(c[:-40], 10); print(len(a), d.needs_input, d.eof)
n = len(a)
while not d.needs_input and not d.eof: n += len(d.decompress(b'', 9000))
print(n, d.needs_input, d.eof); n += len(d.decompress(c[-40:])); print(n, d.needs_input, d.eof)
# When the check becomes known
for check in (lzma.CHECK_NONE, lzma.CHECK_CRC32, lzma.CHECK_CRC64, lzma.CHECK_SHA256):
    c = lzma.compress(data, check=check, preset=0); d = D(); seen = []
    for i in range(0, 16): d.decompress(c[i:i + 1]); seen.append(d.check)
    print(check, seen)
# Memory limits
c = lzma.compress(data, preset=6)
for limit in (0, 1, 1000, 100000, 2**20, 2**24, 2**27, 2**64 - 1, None):
    for fmt in (lzma.FORMAT_AUTO, lzma.FORMAT_XZ):
        d = D(fmt, memlimit=limit); t(lambda: d.decompress(c) == data); print(d.eof, d.needs_input, d.check)
        t(lambda: d.decompress(c) == data)
a = lzma.compress(data, lzma.FORMAT_ALONE, preset=6)
for limit in (1, 100000, 2**27): d = D(lzma.FORMAT_ALONE, memlimit=limit); t(lambda: d.decompress(a) == data)
for limit in (-1, 2**64, 'a', 1.5, b'', [], -2**70, 2**200): t(D, memlimit=limit)
t(lzma.decompress, c, memlimit=100); t(lambda: lzma.decompress(c, memlimit=2**30) == data)
# Arguments
d = D(); t(d.decompress); t(d.decompress, 'a'); t(d.decompress, b'', 'a'); t(d.decompress, b'', 1.5); t(d.decompress, b'', 2**63); t(d.decompress, b'', -2**63 - 1)
t(d.decompress, b'', None); t(d.decompress, b'', 1, 2); t(d.decompress, data=c[:10], max_length=3); t(d.decompress, max_length=3); t(d.decompress, b'', data=b''); t(d.decompress, b'', foo=1)
t(D, 0, None, None); t(D, 0, None, None, None); t(D, format=0, memlimit=None, filters=None); t(D, foo=1); t(D, 0, format=0); t(D, 'a'); t(D, 1.0); t(D, None); t(D, 2**31); t(D, -2**31 - 1); t(D, 2**64)
for fmt in (-1, 4, 5, 100, 2**31 - 1, -2**31): t(D, fmt); t(D, format=fmt, memlimit=5)
t(D, lzma.FORMAT_RAW); t(D, lzma.FORMAT_RAW, 5); t(D, lzma.FORMAT_RAW, 5, RAW); t(D, lzma.FORMAT_RAW, None, RAW); t(D, lzma.FORMAT_RAW, memlimit='a', filters=RAW)
t(D, lzma.FORMAT_XZ, None, RAW); t(D, lzma.FORMAT_AUTO, filters=RAW); t(D, lzma.FORMAT_ALONE, filters=[]); t(D, 77, filters=RAW); t(D, 77, memlimit='a')
t(D, True); t(D, lzma.FORMAT_RAW, filters=[]); t(D, lzma.FORMAT_RAW, filters=()); t(D, lzma.FORMAT_RAW, filters=5); t(D, lzma.FORMAT_RAW, filters={}); t(D, lzma.FORMAT_RAW, filters='ab')
# lzma.decompress() goes on with what follows a stream.
x = lzma.compress(data, preset=0); e = lzma.compress(b'')
print(lzma.decompress(x + x) == data + data, lzma.decompress(e + x + e) == data, lzma.decompress(e * 5)); t(lzma.decompress, b''); t(lambda: lzma.decompress(x + b'\0' * 8 + x) == data * 2)
t(lambda: lzma.decompress(x + b'junk') == data); t(lzma.decompress, b'junk' + x); t(lzma.decompress, x[:-1]); t(lzma.decompress, x + x[:50]); t(lzma.decompress, x[:3]); t(lambda: lzma.decompress(x + b'\0' * 3) == data)
