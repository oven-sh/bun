import zlib

def t(f, *a, **k):
    try:
        s = repr(f(*a, **k))
        i = s.find(' at 0x')
        print(s[:200] if i < 0 else s[:i] + '>')
    except BaseException as e:
        print(type(e).__name__ + ':', e)

names = sorted(n for n in dir(zlib) if not n.startswith('__') and n != 'ZLIBNG_VERSION')
print(names)
print({n: getattr(zlib, n) for n in names if n.isupper() and 'VERSION' not in n})
print(zlib.error.__mro__, zlib.error.__module__, zlib.error.__name__, zlib.error.__qualname__)
print(type(zlib.ZLIB_VERSION), type(zlib.ZLIB_RUNTIME_VERSION))

data = b'hello world, hello world, hello world! ' * 50
for level in (-1, 0, 1, 5, 9):
    for wbits in (15, 9, -15, -9, 31, 25):
        c = zlib.compress(data, level, wbits)
        print(level, wbits, type(c).__name__, zlib.decompress(c, wbits) == data, len(c) < len(data) + 40)
print(zlib.decompress(zlib.compress(data, wbits=31), 47) == data, zlib.decompress(zlib.compress(data), 47) == data)
print(zlib.decompress(zlib.compress(b'')), zlib.decompress(zlib.compress(b'', 0)), zlib.decompress(zlib.compress(b'x', level=9)))
for src in (bytearray(data), memoryview(data), memoryview(bytearray(data))[10:100]):
    print(zlib.decompress(zlib.compress(src)) == bytes(src))
c = zlib.compress(data)
for src in (bytearray(c), memoryview(c)):
    print(zlib.decompress(src) == data)
for bufsize in (0, 1, 2, 7, 100, 16384, 1 << 20):
    print(bufsize, zlib.decompress(c, 15, bufsize) == data, zlib.decompress(c, bufsize=bufsize) == data)

t(zlib.compress)
t(zlib.compress, 'abc')
t(zlib.compress, 1)
t(zlib.compress, None)
t(zlib.compress, [1, 2])
t(zlib.compress, data=b'x')
t(zlib.compress, b'x', 10)
t(zlib.compress, b'x', -2)
t(zlib.compress, b'x', 'a')
t(zlib.compress, b'x', 1.5)
t(zlib.compress, b'x', 1, 100)
t(zlib.compress, b'x', 1, 0)
t(zlib.compress, b'x', 1, 15, 1)
t(zlib.compress, b'x', 2**40)
t(zlib.compress, b'x', -2**40)
t(zlib.compress, b'x', lvl=1)
t(zlib.compress, b'x', 1, level=1)
t(zlib.decompress)
t(zlib.decompress, 'abc')
t(zlib.decompress, b'')
t(zlib.decompress, b'abc')
t(zlib.decompress, b'abcdefghijklmnop')
t(zlib.decompress, c[:-1])
t(zlib.decompress, c[:10])
t(zlib.decompress, c[:2])
t(zlib.decompress, c[:1])
t(zlib.decompress, c + b'extra')
t(zlib.decompress, c, -15)
t(zlib.decompress, c, 31)
t(zlib.decompress, c, 100)
t(zlib.decompress, c, 15, -1)
t(zlib.decompress, c, 15, 'x')
t(zlib.decompress, c, 15, 2**70)
t(zlib.decompress, c, bufsize=-5)
t(zlib.decompress, c, 8)
t(zlib.decompress, c, 0)
bad = bytearray(c); bad[-1] ^= 0xff
t(zlib.decompress, bytes(bad))
bad = bytearray(c); bad[5] ^= 0xff
t(zlib.decompress, bytes(bad))
class I:
    def __index__(self): return 6
print(zlib.decompress(zlib.compress(data, I())) == data)
print(zlib.decompress(zlib.compress(data, True)) == data)
import warnings
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter('always')
    print(zlib.__version__, [(x.category.__name__, str(x.message)) for x in w])
t(getattr, zlib, 'nothing')
big = bytes(range(256)) * 4000
print(zlib.decompress(zlib.compress(big)) == big, zlib.decompress(zlib.compress(big, 0)) == big, len(zlib.compress(big, 0)) > len(big))
