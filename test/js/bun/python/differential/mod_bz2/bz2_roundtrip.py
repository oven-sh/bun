# Every level, one shot and in pieces, with the bytes of the result: the library is the same, so they are too.
import bz2, hashlib, random
def h(b): return hashlib.sha256(b).hexdigest()[:16]
r = random.Random(7)
texts = {
    'empty': b'',
    'one': b'x',
    'run': b'a' * 70000,
    'text': b''.join(b'%d bottles of beer on the wall, %d bottles of beer\n' % (i, i) for i in range(3000)),
    'noise': r.randbytes(50000),
    'bytes': bytes(range(256)) * 300,
    'runs': b''.join(bytes([r.randrange(4)]) * r.randrange(1, 600) for i in range(400)),
}
for name, data in texts.items():
    for level in range(1, 10):
        c = bz2.compress(data, level)
        print(name, level, len(c), h(c), c[:4], bz2.decompress(c) == data)
for name, data in texts.items():
    for step in (1, 7, 1000, 65536):
        if step == 1 and len(data) > 60000: continue
        co = bz2.BZ2Compressor(3); parts = [co.compress(data[i:i + step]) for i in range(0, len(data), step)]; parts.append(co.flush())
        c = b''.join(parts)
        print(name, step, sum(1 for p in parts if p), c == bz2.compress(data, 3))
        de = bz2.BZ2Decompressor(); out = b''.join(de.decompress(c[i:i + step]) for i in range(0, len(c), step))
        print(out == data, de.eof, de.needs_input, de.unused_data)
# Anything with the buffer protocol is input.
import array
data = texts['text']
for make in (bytes, bytearray, memoryview, lambda b: array.array('B', b), lambda b: memoryview(b)[::1], lambda b: array.array('I', b[:len(b) // 4 * 4])):
    v = make(data)
    c = bz2.compress(v)
    print(type(v).__name__, h(c), bz2.decompress(make(c[:len(c) // 4 * 4] if isinstance(v, array.array) and v.typecode == 'I' else c)[:]) == bytes(v) if not (isinstance(v, array.array) and v.typecode == 'I') else len(c))
for bad in ('str', 5, None, [1, 2], memoryview(data)[::2], 1.5, object()):
    for f in (bz2.compress, bz2.decompress, bz2.BZ2Compressor().compress, bz2.BZ2Decompressor().decompress):
        try: print(f(bad))
        except Exception as e: print(type(e).__name__, e)
# Several blocks: at level 1 a block is 100000 bytes.
big = r.randbytes(350000)
c = bz2.compress(big, 1); print(len(c), h(c), bz2.decompress(c) == big)
co = bz2.BZ2Compressor(1); sizes = [len(co.compress(big[i:i + 50000])) for i in range(0, len(big), 50000)]; print(sizes, len(co.flush()))
