import zlib
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k))
        i = s.find(' at 0x')
        print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
D = zlib._ZlibDecompressor
print(D, D.__mro__, D.__module__, sorted(n for n in dir(D) if not n.startswith('__')))
data = b''.join(b'%d green bottles hanging on the wall\n' % i for i in range(4000))
for wbits in (15, -15, 31):
    c = zlib.compress(data, wbits=wbits)
    d = D(wbits)
    print(d.eof, d.needs_input, d.unused_data)
    print(d.decompress(c) == data, d.eof, d.needs_input, d.unused_data)
    t(d.decompress, b'x'); t(d.decompress, b'')
    d = D(wbits=wbits)
    print(d.decompress(c + b'junk') == data, d.eof, d.needs_input, d.unused_data)
    for step in (1, 10, 999, 100000):
        d = D(wbits); out = []
        for i in range(0, len(c), step):
            out.append(d.decompress(c[i:i + step]))
            if i + step < len(c) and (d.eof or not d.needs_input):
                print('odd', step, i)
        print(step, b''.join(out) == data, d.eof, d.needs_input)
    for limit in (0, 1, 100, 16384, 1 << 20, len(data), 2**63 - 1):
        d = D(wbits); out = [d.decompress(c, limit)]; n = 0
        print(limit, len(out[0]), d.eof, d.needs_input)
        while not d.eof and n < 50:
            out.append(d.decompress(b'', max(limit, 5000))); n += 1
        print(data.startswith(b''.join(out)), len(b''.join(out)), d.eof, d.needs_input, d.unused_data)
    d = D(wbits)
    a = d.decompress(c[:100], 10); b = d.decompress(c[100:200], 10); print(len(a), len(b), d.needs_input)
    rest = d.decompress(c[200:] + b'TAIL'); print(a + b + rest == data, d.eof, d.unused_data)
c = zlib.compress(data)
d = D(); t(d.decompress); t(d.decompress, 'a'); t(d.decompress, b'', 'a'); t(d.decompress, b'', 1.5); t(d.decompress, b'', 2**64); t(d.decompress, data=c[:10], max_length=-1); t(d.decompress, b'', 1, 2); t(d.decompress, foo=1)
t(D, 100); t(D, 'a'); t(D, 15, 'x'); t(D, 15, None); t(D, 15, b'', 0); t(D, foo=1); t(D, wbits=15, zdict=b'abc')
d = D(); t(d.decompress, b'garbage data here'); print(d.eof, d.needs_input, d.unused_data); t(d.decompress, c)
d = D(); print(d.decompress(c[:-3]) == data or 'partial', d.eof, d.needs_input)
def sub():
    class X(D): pass
t(sub)
def seta(): D().eof = 1
t(seta)
def setb(): D().foo = 1
t(setb)
zdict = b'green bottles hanging on the wall'
co = zlib.compressobj(wbits=-15, zdict=zdict); cd = co.compress(data) + co.flush()
print(D(-15, zdict).decompress(cd) == data)
