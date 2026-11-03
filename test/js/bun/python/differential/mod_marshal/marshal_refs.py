import marshal
def t(f, *a, **k):
    try:
        print(repr(f(*a, **k)))
    except BaseException as e:
        print(type(e).__name__ + ':', e)

# Sharing survives from version 3 on.
for version in range(0, 7):
    x = [1, 2]; y = {'k': x}; s = ''.join(['ab', 'cd ']); b = bytes([1, 2, 3]); big = 3 ** 100; tu = (x, s)
    v = marshal.loads(marshal.dumps([x, x, y, s, s, b, b, big, big, tu, tu], version))
    print(version, v[0] is v[1], v[2]['k'] is v[0], v[3] is v[4], v[5] is v[6], v[9] is v[10], v[9][0] is v[0], v == [x, x, y, s, s, b, b, big, big, tu, tu])

# Recursive containers.
l = []; l.append(l)
for version in (3, 4, 6):
    r = marshal.loads(marshal.dumps(l, version))
    print(version, r[0] is r, len(r))
d = {}; d['self'] = d
r = marshal.loads(marshal.dumps(d)); print(r['self'] is r)
l = [1]; tu = (l,); l.append(tu)
r = marshal.loads(marshal.dumps(tu)); print(r[0][1] is r, r[0][0])
l = []; s = slice(l); l.append(s)
t(marshal.dumps, s)
del s
t(marshal.dumps, l)
l = []; fd = frozendict(a=l); l.append(fd)
t(marshal.dumps, fd)
l = []; l.append(l)
t(marshal.dumps, l, 2)
t(marshal.dumps, l, 0)

# Depth
def nest(n, make):
    v = make(None)
    for i in range(n):
        v = make(v)
    return v
for n in (10, 1000, 1990, 1998, 1999, 2000, 2001, 5000):
    for name, make in (('list', lambda v: [v]), ('tuple', lambda v: (v,)), ('dict', lambda v: {1: v})):
        try:
            d = marshal.dumps(nest(n, make))
            r = marshal.loads(d)
            depth = 0
            while r is not None:
                r = r[1] if isinstance(r, dict) else r[0]
                depth += 1
            print(n, name, 'ok', len(d), depth)
        except ValueError as e:
            print(n, name, 'ValueError', e)
for n in (1998, 1999, 2000, 2001, 3000, 100000):
    t(lambda: type(marshal.loads(b')\x01' * n + b'N')))
    t(lambda: type(marshal.loads(b'[\x01\x00\x00\x00' * n + b'N')))
    t(lambda: type(marshal.loads(b'{N' * n + b'N' + b'0' * n)))

# Data written by hand
for data in (
    b'', b'0', b'N', b'NN', b'?', b'\x00', b'\xff', b'q', b'r', b'r\x00\x00\x00\x00', b'\xdb\x01\x00\x00\x00r\x00\x00\x00\x00', b'\xa9\x01r\x00\x00\x00\x00',
    b'[\x01\x00\x00\x00r\x00\x00\x00\x00', b'r\xff\xff\xff\xff', b'[\x02\x00\x00\x00\xe9\x01\x00\x00\x00r\x01\x00\x00\x00',
    b'i', b'i\x01\x00\x00', b'i\x01\x00\x00\x00', b'i\xff\xff\xff\xff', b'I\x01\x00\x00\x00\x00\x00\x00\x00', b'I\xff\xff\xff\xff\xff\xff\xff\xff', b'I\x00\x00\x00\x00\x00\x00\x00\x80', b'I\x00',
    b'l\x00\x00\x00\x00', b'l\x01\x00\x00\x00\x01\x00', b'l\xff\xff\xff\xff\x01\x00', b'l\x01\x00\x00\x00\x00\x00', b'l\x02\x00\x00\x00\x01\x00\x00\x00', b'l\x01\x00\x00\x00\x00\x80', b'l\x01\x00\x00\x00\xff\xff',
    b'l\x02\x00\x00\x00\x00\x80\x01\x00', b'l\x01\x00\x00\x00\xff\x7f', b'l\x00\x00\x00\x80', b'l\x01\x00\x00\x00', b'l\x05\x00\x00\x00\x01\x00', b'l\x03\x00\x00\x00\xff\x7f\xff\x7f\xff\x7f', b'l\xfb\xff\xff\xff\x01\x00\x02\x00\x03\x00\x04\x00\x05\x00',
    b'f', b'f\x00', b'f\x031.5', b'f\x041.5', b'f\x03abc', b'f\x03inf', b'f\x04-inf', b'f\x03nan', b'f\x051e400', b'f\x04 1.5', b'f\x041.5 ', b'f\x031_0', b'f\x080x1.8p+1', b'f\x08infinity', b'f\x041\x00zz',
    b'g', b'g\x00\x00\x00\x00\x00\x00\xf8?', b'g\x00\x00\x00\x00\x00\x00\xf8', b'x\x011\x012', b'x\x011', b'x\x01a\x012', b'y' + b'\x00' * 16, b'y' + b'\x00' * 15,
    b's', b's\x00\x00\x00\x00', b's\x03\x00\x00\x00abc', b's\x04\x00\x00\x00abc', b's\xff\xff\xff\xff', b's\xff\xff\xff\x7f',
    b'u\x00\x00\x00\x00', b'u\x03\x00\x00\x00abc', b'u\x02\x00\x00\x00\xc3\xa9', b'u\x01\x00\x00\x00\xc3', b'u\x01\x00\x00\x00\xff', b'u\x03\x00\x00\x00\xed\xa0\x80', b'u\xff\xff\xff\xff', b'u\x05\x00\x00\x00ab',
    b't\x03\x00\x00\x00abc', b'a\x03\x00\x00\x00abc', b'A\x03\x00\x00\x00abc', b'a\x02\x00\x00\x00\xc3\xa9', b'a\xff\xff\xff\xff', b'z\x03abc', b'Z\x03abc', b'z\x00', b'z', b'z\x04abc', b'z\x01\xe9', b'Z\x01\xe9',
    b')\x00', b')\x01', b')\x01N', b')\x010', b')\x02NN', b'(\x00\x00\x00\x00', b'(\x01\x00\x00\x00N', b'(\xff\xff\xff\xff', b'(\x01\x00\x00\x000', b'(\x02\x00\x00\x00N',
    b'[\x00\x00\x00\x00', b'[\x01\x00\x00\x00N', b'[\x01\x00\x00\x000', b'[\xff\xff\xff\xff', b'[\x02\x00\x00\x00N',
    b'{0', b'{', b'{N', b'{NN', b'{NN0', b'{N0', b'{NNTF0', b'{[\x00\x00\x00\x00N0', b'{NNNT0', b'}0', b'}NN0', b'}', b'\xfd0', b'[\x02\x00\x00\x00\xfdNN0r\x00\x00\x00\x00', b'\xfdNr\x00\x00\x00\x000',
    b'<\x00\x00\x00\x00', b'<\x01\x00\x00\x00N', b'<\x02\x00\x00\x00NN', b'<\x01\x00\x00\x000', b'<\x01\x00\x00\x00[\x00\x00\x00\x00', b'<\xff\xff\xff\xff', b'<\x02\x00\x00\x00N',
    b'>\x00\x00\x00\x00', b'>\x01\x00\x00\x00N', b'\xbe\x01\x00\x00\x00r\x00\x00\x00\x00', b'[\x02\x00\x00\x00\xbe\x01\x00\x00\x00Nr\x00\x00\x00\x00', b'[\x02\x00\x00\x00\xbe\x00\x00\x00\x00r\x00\x00\x00\x00',
    b':NNN', b':NN', b':NN0', b':0NN', b':', b'\xbaNNr\x00\x00\x00\x00', b'[\x02\x00\x00\x00\xbaNNNr\x00\x00\x00\x00', b':\xe9\x01\x00\x00\x00r\x00\x00\x00\x00N',
    b'S', b'.', b'T', b'F', b'\xce', b'\xd4', b'\xae', b'\xb0',
):
    t(marshal.loads, data)
r = marshal.loads(b'[\x02\x00\x00\x00\xbaNNNr\x00\x00\x00\x00'); print(r[0] is r[1])
r = marshal.loads(b'[\x02\x00\x00\x00\xda\x03abcr\x00\x00\x00\x00'); print(r[0] is r[1], r)
import sys
print(marshal.loads(b'Z\x07qwertyz') is sys.intern('qwer' + 'tyz'), marshal.loads(b't\x04\x00\x00\x00\xc3\xa9\xc3\xa9') is sys.intern('é' + 'é'), marshal.loads(b'A\x07\x00\x00\x00qwertyz') is sys.intern('qwertyz'))
# Extra bytes are ignored.
print(marshal.loads(b'i\x01\x00\x00\x00garbage'), marshal.loads(bytearray(b'T')), marshal.loads(memoryview(b'xF')[1:]))
