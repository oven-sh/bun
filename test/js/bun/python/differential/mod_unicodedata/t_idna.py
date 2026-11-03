# What the standard library does with ucd_3_2_0.
# stringprep refuses to be imported unless unicodedata has the very version of Unicode it was generated for, which ours has only
# if the ICU it is linked with does.
import unicodedata
unicodedata.unidata_version = '17.0.0'
import stringprep

def attempt(f, *args, **kwargs):
    try:
        r = f(*args, **kwargs)
    except BaseException as e:
        print('%s: %s' % (type(e).__name__, e))
    else:
        print(ascii(r))

tables = [n for n in dir(stringprep) if n.startswith(('in_table_', 'map_table_'))]
sample = list(range(0x500)) + list(range(0x500, 0x11000, 7)) + list(range(0x1d000, 0x1d800, 5)) + list(range(0x20000, 0x110000, 2039)) + [0xe0001, 0xe0020, 0xfffe, 0xffff, 0x1fffe, 0x10ffff]
for name in sorted(tables):
    f = getattr(stringprep, name)
    last = None
    out = []
    for c in sample:
        v = f(chr(c))
        if v != last:
            out.append(('%04X' % c, v))
            last = v
    print(name, len(out), ascii(out[:40]), ascii(out[-5:]))

for s in ['b\xfccher.example', 'B\xdcCHER.example', 'stra\xdfe.de', '日本語.jp', 'a.b.c', '', '.', 'a..b', 'Ⅸ.com', 'é.com', 'ςσ.gr', 'xn--bcher-kva.example', 'a' * 63 + '.com', 'a' * 64 + '.com',
          'الa.com', '‍abc.com', 'abc。def', '\U0001f600.com', 'ȡ.com', 'A\xad B.com', 'ﬁ.com']:
    attempt(s.encode, 'idna')
for b in [b'xn--bcher-kva.example', b'xn--strae-oqa.de', b'abc.', b'xn--', b'xn--a', b'XN--BCHER-KVA.example', b'\xff.com', b'xn--wgv71a119e.jp']:
    attempt(b.decode, 'idna')
