# max_length, needs_input, eof, unused_data
import bz2
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k)); i = s.find(' at 0x'); print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
D = bz2.BZ2Decompressor
data = b''.join(b'%d green bottles hanging on the wall\n' % i for i in range(2500))
c = bz2.compress(data)
d = D(); print(d.eof, d.needs_input, d.unused_data)
print(d.decompress(c) == data, d.eof, d.needs_input, d.unused_data)
t(d.decompress, b'x'); t(d.decompress, b''); t(d.decompress, c); print(d.eof, d.needs_input, d.unused_data)
d = D(); print(d.decompress(c + b'junk') == data, d.eof, d.needs_input, d.unused_data, d.unused_data is d.unused_data)
for limit in (0, 1, 2, 100, 4096, 32768, 32769, 65536, 100000, len(data) - 1, len(data), len(data) + 1, 1 << 40, 2**63 - 1, -1, -2, -2**63):
    d = D(); out = [d.decompress(c, limit)]; n = 0
    print(limit, len(out[0]), d.eof, d.needs_input, d.unused_data)
    while not d.eof and n < 60:
        out.append(d.decompress(b'', max(limit, 5000))); n += 1
        if not d.eof and d.needs_input: print('wants input', n); break
    print(data == b''.join(out), n, d.eof, d.needs_input, d.unused_data)
# Input that arrives while some is still kept.
for first, step, limit in ((100, 100, 50), (1, 1, 40), (5000, 3, 1000), (len(c), 10, 77), (len(c) - 1, 1, 100000)):
    d = D(); out = [d.decompress(c[:first], limit)]; states = {(d.needs_input, d.eof)}; i = first
    while not d.eof:
        out.append(d.decompress(c[i:i + step], limit)); i += step
        states.add((d.needs_input, d.eof))
        if i > len(c) + 400000 * step: print('stuck'); break
    print(first, step, limit, b''.join(out) == data, sorted(states), max(map(len, out)), d.unused_data)
# The tail is kept through calls with a limit.
d = D(); out = [d.decompress(c + b'TAIL' * 3, 1000)]
print(d.unused_data, d.eof)
while not d.eof: out.append(d.decompress(b'', 50000))
print(b''.join(out) == data, d.unused_data, d.needs_input)
d = D(); out = [d.decompress(c[:-10], 1000)]; out.append(d.decompress(c[-10:] + b'more', 1000)); out.append(d.decompress(b'even more'))
print(b''.join(out) == data, d.unused_data, d.eof)
# With a limit of nothing, input is taken in all the same.
d = D(); print(d.decompress(c, 0), d.needs_input, d.eof); print(d.decompress(b'', 0), d.needs_input); print(d.decompress(b'') == data, d.eof)
d = D(); print(d.decompress(b'', 0), d.needs_input, d.decompress(b''), d.needs_input, d.decompress(b'', 5), d.needs_input)
d = D(); print(d.decompress(c[:1]), d.needs_input, d.decompress(c[1:2]), d.decompress(c[2:4]), d.needs_input, d.eof)
# The empty stream
e = bz2.compress(b''); print(e); d = D(); print(d.decompress(e), d.eof, d.needs_input, d.unused_data)
d = D(); print(d.decompress(e, 0), d.eof, d.needs_input); d = D(); print(d.decompress(e + e), d.eof, d.unused_data == e)
# Arguments
d = D(); t(d.decompress); t(d.decompress, 'a'); t(d.decompress, b'', 'a'); t(d.decompress, b'', 1.5); t(d.decompress, b'', 2**63); t(d.decompress, b'', -2**63 - 1)
t(d.decompress, b'', None); t(d.decompress, b'', 1, 2); t(d.decompress, data=c[:10], max_length=3); t(d.decompress, max_length=3); t(d.decompress, b'', data=b''); t(d.decompress, b'', foo=1)
t(d.decompress, b'', max_length=True); t(d.decompress, **{'data': b'', 'max_length': 0, 'x': 1}); t(d.decompress, b'', 1, max_length=1)
class I:
    def __index__(self): return 12
d = D(); print(len(d.decompress(c, I())))
class Bad:
    def __index__(self): raise KeyError('index')
t(D().decompress, b'', Bad())
t(D, 1); t(D, x=1); t(D, *(), **{}); t(D, None)
# bz2.decompress() goes on with what follows a stream.
print(bz2.decompress(c + c) == data + data, bz2.decompress(e + c + e) == data, bz2.decompress(b''), bz2.decompress(e * 5))
t(bz2.decompress, c + b'junk'); print(bz2.decompress(c + b'junk') == data)
t(bz2.decompress, b'junk' + c); t(bz2.decompress, c[:-1]); t(bz2.decompress, c + c[:50]); t(bz2.decompress, c[:3])
