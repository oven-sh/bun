import zlib, copy

def t(f, *a, **k):
    try:
        s = repr(f(*a, **k))
        i = s.find(' at 0x')
        print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)

data = b''.join(b'%d bottles of beer on the wall\n' % i for i in range(5000))
c = zlib.compress(data)

# max_length and unconsumed_tail
for limit in (1, 2, 10, 1000, 16384, 16385, 100000, len(data), len(data) + 1):
    do = zlib.decompressobj()
    out = []
    buf = c
    n = 0
    while buf and not do.eof:
        piece = do.decompress(buf, limit)
        assert len(piece) <= limit, (len(piece), limit)
        out.append(piece)
        buf = do.unconsumed_tail
        n += 1
        if n > 200 and limit < 1000:
            break
    got = b''.join(out)
    print(limit, data.startswith(got), len(got) == len(data) or n > 200, do.eof, do.unused_data, len(do.unconsumed_tail) if n <= 200 else '-')
do = zlib.decompressobj()
print(len(do.decompress(c, 100)), len(do.unconsumed_tail) > 0, do.eof)
rest = do.flush()
print(len(rest) == len(data) - 100, do.eof, do.unconsumed_tail, do.unused_data)
print(do.flush(), do.flush(5))
t(do.decompress, b'x'); print(do.unused_data, do.unconsumed_tail, do.eof)
do = zlib.decompressobj()
print(len(do.decompress(c, 100)), len(do.decompress(b'', 100)), len(do.decompress(do.unconsumed_tail, 50)), do.eof)
print(len(do.decompress(do.unconsumed_tail)) == len(data) - 150, do.unconsumed_tail, do.eof)

# unused_data
for extra in (b'', b'x', b'trailing garbage', c):
    do = zlib.decompressobj()
    print(do.decompress(c + extra) == data, do.eof, do.unused_data == extra, do.unconsumed_tail)
    print(do.decompress(b'more'), do.unused_data == extra + b'more', do.flush(), do.unused_data == extra + b'more')
    do = zlib.decompressobj()
    got = b''
    for i in range(0, len(c + extra), 1000):
        got += do.decompress((c + extra)[i:i + 1000])
    print(got == data, do.eof, do.unused_data == extra)
    do = zlib.decompressobj()
    got = do.decompress(c + extra, 10)
    print(len(got), do.eof, do.unused_data, len(do.unconsumed_tail) > len(extra))
    got += do.flush()
    print(got == data, do.eof, do.unused_data == extra, do.unconsumed_tail)

# Truncated input
do = zlib.decompressobj()
got = do.decompress(c[:-5])
print(data.startswith(got), do.eof); got += do.flush(); print(data.startswith(got), do.eof, do.unused_data, do.unconsumed_tail)
do = zlib.decompressobj()
print(do.flush(), do.eof)
do = zlib.decompressobj()
print(do.decompress(b''), do.flush(), do.eof)

# Dictionaries
zdict = b'bottles of beer on the wall'
for wbits in (15, -15):
    co = zlib.compressobj(wbits=wbits, zdict=zdict)
    cd = co.compress(data) + co.flush()
    print(len(cd) <= len(c) + 20)
    for d in (zdict, bytearray(zdict), memoryview(zdict)):
        do = zlib.decompressobj(wbits=wbits, zdict=d)
        print(do.decompress(cd) == data, do.eof)
    do = zlib.decompressobj(wbits=wbits)
    t(lambda: do.decompress(cd) == data)
    do = zlib.decompressobj(wbits=wbits, zdict=b'the wrong dictionary')
    t(lambda: do.decompress(cd) == data)
    t(zlib.decompress, cd, wbits)
big = bytes(range(256)) * 200
co = zlib.compressobj(zdict=big); cd = co.compress(big) + co.flush()
print(zlib.decompressobj(zdict=big).decompress(cd) == big)

# Copies
co = zlib.compressobj()
head = co.compress(data[:50000])
for cp in (co.copy, lambda: copy.copy(co), lambda: copy.deepcopy(co), co.__copy__, lambda: co.__deepcopy__({})):
    c2 = cp()
    print(type(c2) is type(co), c2 is not co, zlib.decompress(head + c2.compress(b'tail two') + c2.flush()) == data[:50000] + b'tail two')
print(zlib.decompress(head + co.compress(b'tail one') + co.flush()) == data[:50000] + b'tail one')
t(co.copy); t(co.__deepcopy__); t(co.copy, 1)
do = zlib.decompressobj()
got = do.decompress(c[:2000])
for cp in (do.copy, lambda: copy.copy(do), lambda: copy.deepcopy(do), do.__copy__, lambda: do.__deepcopy__(None)):
    d2 = cp()
    print(type(d2) is type(do), got + d2.decompress(c[2000:]) == data, d2.eof, do.eof)
do = zlib.decompressobj(); do.decompress(c + b'xyz', 7)
d2 = do.copy(); print(d2.unconsumed_tail == do.unconsumed_tail, d2.unused_data, d2.eof)
do.flush(); d3 = None
t(do.copy)
do = zlib.decompressobj(); do.decompress(c + b'xyz'); d2 = do.copy(); print(d2.unused_data, d2.eof, d2.flush(), d2.eof)
import pickle
t(pickle.dumps, zlib.compressobj()); t(pickle.dumps, zlib.decompressobj())
