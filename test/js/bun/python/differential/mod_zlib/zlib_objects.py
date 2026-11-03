import zlib, copy

def t(f, *a, **k):
    try:
        s = repr(f(*a, **k))
        i = s.find(' at 0x')
        print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)

data = b''.join(b'line %d of the text, which repeats itself a lot\n' % i for i in range(3000))
co = zlib.compressobj()
do = zlib.decompressobj()
print(type(co), type(do), type(co).__mro__, type(do).__mro__, type(co).__module__, type(co).__qualname__)
print(sorted(n for n in dir(co) if not n.startswith('__') or n in ('__copy__', '__deepcopy__')))
print(sorted(n for n in dir(do) if not n.startswith('__') or n in ('__copy__', '__deepcopy__')))
t(type(co)); t(type(do)); t(type(co).__new__, type(co))
def sub():
    class X(type(co)): pass
t(sub)
def setattr_(): co.x = 1
t(setattr_)
def setm(): do.eof = True
t(setm)
def setm2(): do.unused_data = b''
t(setm2)
def delm(): del do.unconsumed_tail
t(delm)
print(type(type(do).__dict__['eof']).__name__, type(type(do).__dict__['unused_data']).__name__, type(type(do).__dict__['decompress']).__name__)
print(do.eof, do.unused_data, do.unconsumed_tail)

# Piecewise.
for size in (1, 7, 100, 4096, 100000):
    co = zlib.compressobj()
    parts = [co.compress(data[i:i + size]) for i in range(0, min(len(data), size * 300), size)]
    parts.append(co.flush())
    c = b''.join(parts)
    expected = data[:min(len(data), size * 300)]
    print(size, zlib.decompress(c) == expected, all(type(p) is bytes for p in parts))
    for dsize in (1, 13, 1000, 1 << 20):
        do = zlib.decompressobj()
        out = [do.decompress(c[i:i + dsize]) for i in range(0, len(c), dsize)]
        out.append(do.flush())
        print(' ', dsize, b''.join(out) == expected, do.eof, do.unused_data, do.unconsumed_tail)

# All the options.
for level in (-1, 0, 1, 9):
    for wbits in (15, 10, -15, -10, 31, 26):
        for mem in (1, 8, 9):
            for strategy in (zlib.Z_DEFAULT_STRATEGY, zlib.Z_FILTERED, zlib.Z_HUFFMAN_ONLY, zlib.Z_RLE, zlib.Z_FIXED):
                co = zlib.compressobj(level, zlib.DEFLATED, wbits, mem, strategy)
                c = co.compress(data[:5000]) + co.flush()
                do = zlib.decompressobj(wbits)
                if do.decompress(c) + do.flush() != data[:5000] or not do.eof:
                    print('bad', level, wbits, mem, strategy)
print('options done')
co = zlib.compressobj(level=3, method=8, wbits=12, memLevel=4, strategy=1, zdict=b'line of the text')
c = co.compress(data) + co.flush()
do = zlib.decompressobj(wbits=12, zdict=b'line of the text')
print(do.decompress(c) == data)

t(zlib.compressobj, 10); t(zlib.compressobj, -2); t(zlib.compressobj, 1, 7); t(zlib.compressobj, 1, 8, 100); t(zlib.compressobj, 1, 8, 15, 0); t(zlib.compressobj, 1, 8, 15, 10)
t(zlib.compressobj, 1, 8, 15, 8, 9); t(zlib.compressobj, 1, 8, 15, 8, 0, 'x'); t(zlib.compressobj, 1, 8, 15, 8, 0, None); t(zlib.compressobj, 1, 8, 15, 8, 0, b'', 1)
t(zlib.compressobj, 'a'); t(zlib.compressobj, level=1.0); t(zlib.compressobj, foo=1); t(zlib.compressobj, 1, level=1); t(zlib.compressobj, 2**31)
t(zlib.compressobj, 1, 8, 31, 8, 0, b'dict')
t(zlib.decompressobj, 100); t(zlib.decompressobj, 'a'); t(zlib.decompressobj, 15, 'x'); t(zlib.decompressobj, 15, None); t(zlib.decompressobj, 15, 5); t(zlib.decompressobj, 15, b'', 1); t(zlib.decompressobj, foo=1)
t(zlib.decompressobj, -15, b'x' * 10); t(zlib.decompressobj, 2**31); t(zlib.decompressobj, 0); t(zlib.decompressobj, 8); t(zlib.decompressobj, 7)

co = zlib.compressobj()
t(co.compress); t(co.compress, 'a'); t(co.compress, 1); t(co.compress, b'a', 1); t(co.compress, data=b'a')
t(co.flush, 'a'); t(co.flush, 1.0); t(co.flush, 100); t(co.flush, -1); t(co.flush, 4, 4); t(co.flush, mode=4)
co = zlib.compressobj()
print(co.flush(zlib.Z_NO_FLUSH), co.compress(b''))
x = co.compress(b'abc' * 100)
for mode in (zlib.Z_PARTIAL_FLUSH, zlib.Z_SYNC_FLUSH, zlib.Z_FULL_FLUSH, zlib.Z_BLOCK):
    x += co.flush(mode) + co.compress(b'def' * 10)
x += co.flush()
print(zlib.decompress(x) == b'abc' * 100 + b'def' * 40)
t(co.flush); t(co.compress, b'more'); t(co.flush, zlib.Z_SYNC_FLUSH); t(co.copy)
# A sync flush makes everything so far available.
co = zlib.compressobj(); do = zlib.decompressobj()
for i in range(5):
    piece = b'piece %d ' % i * 20
    print(do.decompress(co.compress(piece) + co.flush(zlib.Z_SYNC_FLUSH)) == piece, do.eof)

do = zlib.decompressobj()
t(do.decompress); t(do.decompress, 'a'); t(do.decompress, b'', -1); t(do.decompress, b'', 'a'); t(do.decompress, b'', 1.0); t(do.decompress, b'', 2**70); t(do.decompress, b'', 0, 0); t(do.decompress, data=b''); t(do.decompress, b'', max_length=-3); t(do.decompress, b'', maxlength=3)
t(do.flush, 0); t(do.flush, -1); t(do.flush, 'a'); t(do.flush, 1.0); t(do.flush, 2**70); t(do.flush, 1, 1); t(do.flush, length=1)
t(do.decompress, b'not zlib data at all'); print(do.eof, do.unused_data, do.unconsumed_tail)
t(do.decompress, b'again'); t(do.flush)
