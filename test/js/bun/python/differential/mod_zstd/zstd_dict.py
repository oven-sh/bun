import _zstd
from compression import zstd
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:150] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
C, D, Z, E = _zstd.ZstdCompressor, _zstd.ZstdDecompressor, _zstd.ZstdDict, _zstd.ZstdError
samples = [b'{"id": %d, "name": "user%d", "email": "user%d@example.com", "active": %s, "tags": ["a", "b", "c"]}' % (i, i, i, b'true' if i % 2 else b'false') for i in range(2000)]
joined = b''.join(samples); sizes = tuple(len(s) for s in samples)
raw = _zstd.train_dict(joined, sizes, 4096)
print(type(raw), 0 < len(raw) <= 4096, raw[:4].hex())
zd = Z(raw)
print(len(zd) == len(raw), zd.dict_content == raw, zd.dict_id != 0, type(zd.dict_id), repr(zd) == '<ZstdDict dict_id=%d dict_size=%d>' % (zd.dict_id, len(raw)))
print(zd.as_digested_dict == (zd, 0), zd.as_undigested_dict == (zd, 1), zd.as_prefix == (zd, 2), type(zd.as_prefix), zd.as_prefix[0] is zd)
msg = samples[7] + samples[1234]
plain = C().compress(msg, 2)
for how in (zd, zd.as_digested_dict, zd.as_undigested_dict, zd.as_prefix, (zd, 0), (zd, 1), (zd, 2), (zd, True)):
    x = C(zstd_dict=how).compress(msg, 2)
    use = how if isinstance(how, tuple) and how[1] == 2 else zd
    print(len(x) < len(plain), D(use).decompress(x) == msg, D(zstd_dict=use).decompress(x) == msg, _zstd.get_frame_info(x)[1] == (0 if use is not zd else zd.dict_id))
x = C(zstd_dict=zd).compress(msg, 2)
for how in (zd.as_digested_dict, zd.as_undigested_dict):
    print(D(how).decompress(x) == msg)
t(D().decompress, x); t(D(zd.as_prefix).decompress, x)
for level in (1, 3, 19):
    c = C(level, zstd_dict=zd.as_digested_dict); print(D(zd).decompress(c.compress(msg, 2)) == msg, D(zd).decompress(c.compress(msg, 2)) == msg)
# A prefix is for one frame only.
c = C(zstd_dict=zd.as_prefix); a = c.compress(msg, 2); b = c.compress(msg, 2); print(D(zd.as_prefix).decompress(a) == msg, D().decompress(b) == msg, len(a) < len(b))
other = Z(b'some raw content that is no dictionary at all', is_raw=True); print(other.dict_id, len(other), other)
x = C(zstd_dict=other).compress(b'some raw content that is no dictionary', 2); print(D(other).decompress(x))
t(Z); t(Z, b''); t(Z, b'1234567'); t(Z, b'12345678'); t(Z, b'12345678', is_raw=True); t(Z, b'12345678', True); t(Z, 'a'); t(Z, 5); t(Z, dict_content=raw); t(Z, raw, is_raw=0); t(Z, raw, x=1); t(Z, bytearray(raw)); t(Z, memoryview(raw)); t(Z, raw, is_raw=[])
ba = bytearray(raw); z2 = Z(ba); ba[:] = bytes(len(ba)); print(z2.dict_content == raw)
def sd(): zd.dict_id = 1
t(sd)
def sc(): zd.dict_content = b''
t(sc)
def sx(): zd.x = 1
t(sx)
for bad in ((zd, 3), (zd, -1), (zd, 'a'), (zd,), (zd, 1, 2), [zd, 1], (1, zd), (zd, 2**40), (zd, 1.0), None and 0, 'x'):
    t(C, zstd_dict=bad); t(D, zstd_dict=bad)
class T2(tuple): pass
t(C, zstd_dict=T2((zd, 1)))
# The dictionary outlives the names for it.
import gc
c = C(zstd_dict=Z(raw).as_digested_dict); d = D(Z(raw)); gc.collect(); print(d.decompress(c.compress(msg, 2)) == msg)
del c, d; gc.collect()

T = _zstd.train_dict
t(T); t(T, joined, sizes); t(T, 'a', sizes, 100); t(T, bytearray(joined), sizes, 100); t(T, joined, list(sizes), 100); t(T, joined, sizes, 'a'); t(T, joined, sizes, 0); t(T, joined, sizes, -1); t(T, joined, sizes[:-1], 100); t(T, joined, sizes + (1,), 100); t(T, joined, ('a',) * 3, 100); t(T, joined, (-1,), 100); t(T, joined, (2**70,), 100); t(T, joined, (1.0,), 100); t(T, b'', (), 100); t(T, b'abc', (3,), 100); t(T, joined, sizes, 2**70); t(T, joined, sizes, 100, 1)
F = _zstd.finalize_dict
fin = F(raw, joined, sizes, 8192, 3); print(type(fin), 0 < len(fin) <= 8192, fin[:4].hex()); zf = Z(fin); print(D(zf).decompress(C(zstd_dict=zf).compress(msg, 2)) == msg)
t(F); t(F, raw, joined, sizes, 100); t(F, 'a', joined, sizes, 100, 1); t(F, raw, 'a', sizes, 100, 1); t(F, raw, joined, [1], 100, 1); t(F, raw, joined, sizes, 'a', 1); t(F, raw, joined, sizes, 100, 'a'); t(F, raw, joined, sizes, 0, 1); t(F, raw, joined, sizes[:-1], 100, 1); t(F, raw, joined, sizes, 10, 1); t(F, raw, joined, sizes, 100, 2**40)
