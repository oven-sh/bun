import array, struct, binascii
from array import array as A

def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)

a = A("i", [1, 2, 3])
m = memoryview(a)
print(m.format, m.itemsize, m.nbytes, m.ndim, m.shape, m.strides, m.readonly, m.obj is a, len(m), m.tolist(), m[0], m[-1], m.contiguous, bytes(m))
m[0] = 100; print(a); a[1] = 200; print(m.tolist())
t(lambda: a.append(4)); t(lambda: a.pop()); t(lambda: a.extend([1])); t(lambda: a.clear()); t(lambda: a.insert(0, 1)); t(lambda: a.remove(3)); t(lambda: a.fromlist([1])); t(lambda: a.frombytes(b"abcd")); t(lambda: a.__delitem__(0)); t(lambda: a.__delitem__(slice(0, 1))); t(lambda: a.__delitem__(slice(None, None, 2))); t(lambda: a.__setitem__(slice(0, 1), A("i", [1, 2]))); t(lambda: a.__setitem__(slice(0, 1), A("i"))); t(lambda: a.__imul__(2)); t(lambda: a.__iadd__(A("i", [1]))); t(lambda: a.__imul__(0))
print(a)
a[0:1] = A("i", [7]); a[::2] = A("i", [8, 9]); a.reverse(); a.byteswap(); a.byteswap(); a *= 1; a += A("i"); a.extend([]); a.fromlist([]); a.frombytes(b""); print(a, m.tolist())
m2 = memoryview(a); m.release(); t(lambda: a.append(4)); m2.release(); a.append(4); print(a)
with memoryview(a) as v:
    t(lambda: a.append(5))
a.append(5); print(a)
memoryview(a); a.append(6); print(a)
for tc in array.typecodes:
    if tc == "u": continue
    x = A(tc, "ab" if tc == "w" else [1, 2]); v = memoryview(x)
    print(tc, v.format, v.itemsize, v.nbytes, v.shape, end=" "); t(lambda: v.tolist())
e = memoryview(A("i")); print(e.nbytes, e.shape, e.tolist(), bytes(e), e.format)
print(bytes(A("h", [1, 2])), bytearray(A("b", [1, 2])), bytes(A("i")), b"".join([A("b", b"ab"), b"cd"]), b"x" + A("b", b"ab") if False else None, int.from_bytes(A("B", [1, 2]), "big"), A("b", b"abc").tobytes().decode(), bytes(A("b", b"abc")).decode())
print(struct.unpack("<2h", A("h", [1, 2])), struct.unpack_from("<h", A("h", [1, 2]), 2), list(struct.iter_unpack("<h", A("h", [1, 2]))), struct.unpack("<2h", memoryview(A("h", [1, 2]))), binascii.hexlify(A("h", [1, 2])), binascii.crc32(A("b", b"abc")) == binascii.crc32(b"abc"), binascii.b2a_base64(A("b", b"abc")), binascii.a2b_base64(A("b", b"YWJj")), binascii.hexlify(memoryview(b"ab")), binascii.unhexlify(memoryview(b"6162")))
x = A("b", bytes(4)); struct.pack_into("<hh", x, 0, 1, 2); print(x); struct.pack_into("<h", memoryview(x), 1, -1); print(x); t(lambda: struct.pack_into("<h", memoryview(b"abcd"), 0, 1)); t(lambda: struct.pack_into("<h", memoryview(x).toreadonly(), 0, 1))
b = A("b", b"ab"); b.frombytes(memoryview(b"cd")); b.frombytes(A("b", b"ef")); b.frombytes(A("B", b"gh")); print(b); t(lambda: b.frombytes(A("h", [1]))); t(lambda: b.frombytes(b)); t(lambda: b.frombytes(memoryview(A("i", [1])))); b.frombytes(memoryview(A("i", [1])).cast("B")); print(b)
print(A("b", memoryview(b"ab")), A("i", memoryview(A("i", [5, 6]))), A("B", memoryview(b"abcd")[::2]))
v = a.__buffer__(0); print(type(v).__name__, v.nbytes, v.format, v.obj is a); t(lambda: a.append(1)); a.__release_buffer__(v); a.append(1); print(a[-1]); t(lambda: v.tolist())
t(lambda: a.__buffer__("x")); t(lambda: a.__release_buffer__(1)); t(lambda: a.__release_buffer__(memoryview(b"")))
it = struct.iter_unpack("<b", x); next(it); t(lambda: x.append(1)); list(it); x.append(1); print(x)
ba = bytearray(b"abcd"); it = struct.iter_unpack("<b", ba); t(lambda: ba.append(1)); del it; ba.append(1); print(ba)
import collections.abc
print(isinstance(a, collections.abc.Buffer), issubclass(A, collections.abc.Buffer))
class S(A): pass
s = S("h", [1, 2]); print(bytes(s), memoryview(s).tolist(), memoryview(s).obj is s)
