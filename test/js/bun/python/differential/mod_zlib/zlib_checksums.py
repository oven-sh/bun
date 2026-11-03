import zlib
def t(f, *a, **k):
    try:
        s = repr(f(*a, **k))
        i = s.find(' at 0x')
        print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)
for f in (zlib.adler32, zlib.crc32):
    print(f.__name__)
    for d in (b'', b'a', b'abc', b'hello world' * 100, bytes(range(256)) * 300, bytearray(b'xyz'), memoryview(b'0123456789')[2:8]):
        print(f(d), f(d, 0), f(d, 1), f(d, 12345), f(d, 2**32), f(d, 2**32 + 5), f(d, -2**40 + 3), f(d, 2**100 + 7))
        # What adler32 makes of a start that is no checksum differs between zlib and zlib-ng.
        if f is zlib.crc32:
            print(f(d, 0xffffffff), f(d, -1))
    x = f(b'abc'); print(f(b'def', x) == f(b'abcdef'))
    t(f); t(f, 'a'); t(f, 1); t(f, b'a', 'x'); t(f, b'a', 1.5); t(f, b'a', None); t(f, b'a', 1, 2); t(f, data=b'a'); t(f, b'a', value=1)
    class I:
        def __index__(self): return 77
    print(f(b'q', I()), f(b'q', True))
for comb, f in ((zlib.adler32_combine, zlib.adler32), (zlib.crc32_combine, zlib.crc32)):
    print(comb.__name__)
    for a, b in ((b'', b''), (b'a', b''), (b'', b'b'), (b'abc', b'defgh'), (b'x' * 1000, b'y' * 70000)):
        print(comb(f(a), f(b), len(b)) == f(a + b), comb(f(a), f(b), len(b)))
    print(comb(1, 2, 3), comb(0, 0, 0), comb(2**32 + 1, -1, 5), comb(123, 456, 2**31), comb(123, 456, 2**40), comb(5, 6, True))
    t(comb); t(comb, 1, 2); t(comb, 1, 2, -1); t(comb, 1, 2, 1.0); t(comb, 1, 2, '3'); t(comb, 1, 2, None); t(comb, 'a', 2, 3); t(comb, 1, 'b', 3)
    t(comb, 1, 2, 2**63); t(comb, 1, 2, 2**64); t(comb, 1, 2, -2**70); t(comb, 1, 2, 3, 4); t(comb, adler1=1, adler2=2, len2=3)
    class I:
        def __index__(self): return 3
    t(comb, 1, 2, I()); t(comb, I(), I(), 3)
