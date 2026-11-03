import array, struct, binascii, warnings
warnings.simplefilter('ignore')
def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)
def attrs(m):
    return (m.nbytes, m.readonly, m.itemsize, m.format, m.ndim, m.shape, m.strides, m.c_contiguous, m.contiguous)
for tc in array.typecodes:
    a = array.array(tc, 'abc' if tc in 'uw' else [1, 2, 3])
    m = memoryview(a)
    print(tc, attrs(m), m.obj is a, m.tobytes() == a.tobytes(), bytes(a) == a.tobytes(), bytearray(m) == a.tobytes(), len(m))
    t(lambda: m.tolist() == a.tolist()); t(lambda: m[0] == a[0]); t(lambda: list(m) == list(a)); t(lambda: m == a); t(lambda: a == m); t(lambda: m == m); t(lambda: m == memoryview(a)); t(lambda: m[1:] == memoryview(a)[1:]); t(lambda: m[::-1].tobytes() == a[::-1].tobytes()); t(lambda: m.cast('B').nbytes); t(lambda: hash(m))
    m.release()
a = array.array('i', [1, 2, 3, 4])
m = memoryview(a)
m[0] = -5; m[1:3] = array.array('i', [7, 8]); print(a, m.tolist())
t(lambda: m.__setitem__(slice(0, 2), array.array('I', [1, 2]))); t(lambda: m.__setitem__(slice(0, 2), array.array('h', [1, 2]))); t(lambda: m.__setitem__(slice(0, 2), b'12345678')); t(lambda: m.__setitem__(slice(0, 2), memoryview(b'12345678').cast('i')) or a)
for f in (lambda: a.append(1), lambda: a.pop(), lambda: a.extend([1]), lambda: a.clear(), lambda: a.insert(0, 1), lambda: a.frombytes(b'abcd'), lambda: a.__imul__(2), lambda: a.__iadd__(a), lambda: a.__delitem__(0), lambda: a.__setitem__(slice(0, 1), array.array('i', [1, 2])), lambda: a.remove(4), lambda: a.fromlist([1])):
    t(f)
a[0] = 9; a[1:3] = array.array('i', [5, 6]); a.reverse(); a.byteswap(); a.byteswap(); print(a, m.tolist())
m.release(); a.append(1); print(a)
with memoryview(a) as m, m[1:] as s:
    t(lambda: a.append(1))
a.append(2); print(a)
memoryview(a)[1:]; a.append(3); print(a)
e = array.array('d'); m = memoryview(e); print(attrs(m), m.tolist(), m.tobytes()); m.release(); e.append(1.0); print(e)
for fl in (0, 1, 4, 8, 0x18, 0x11c, 0x100, 0x200):
    def f():
        with a.__buffer__(fl) as x:
            return (fl, x.format, x.itemsize, x.shape, x.strides, x.nbytes, x.readonly, x.obj is a)
    t(f)
v = a.__buffer__(0); t(lambda: a.append(1)); print(a.__release_buffer__(v)); t(lambda: v.tolist()); t(lambda: a.__release_buffer__(v)); t(lambda: a.__release_buffer__(memoryview(b''))); t(lambda: a.__release_buffer__(1)); a.append(4); print(a)
class Sub(array.array): pass
s = Sub('h', [1, 2]); m = memoryview(s); print(attrs(m), m.obj is s, m.tolist()); m.release()
class Sub2(array.array):
    def __buffer__(self, flags):
        print('Sub2.__buffer__', flags)
        return super().__buffer__(flags)
    def __release_buffer__(self, view):
        print('Sub2.__release_buffer__', view.tolist())
        super().__release_buffer__(view)
s = Sub2('h', [1, 2])
with memoryview(s) as m:
    print(m.tolist(), type(m.obj).__name__)
    t(lambda: s.append(1))
s.append(3); print(s, bytes(s))
# consumers
b = bytearray(16); m = memoryview(b)
struct.pack_into('<ih', m, 2, -1, 5); print(b)
struct.pack_into('<h', m[8:], 0, 258); print(b)
t(lambda: struct.unpack_from('<ih', m, 2)); t(lambda: struct.unpack('<4i', m)); t(lambda: struct.unpack('<2i', m[8:])); t(lambda: struct.unpack('<8B', m[::2])); t(lambda: struct.pack_into('<i', m.toreadonly(), 0, 1)); t(lambda: struct.pack_into('<i', memoryview(b'1234'), 0, 1)); t(lambda: struct.pack_into('<i', m[::2], 0, 1)); t(lambda: list(struct.iter_unpack('<h', m[:4]))); t(lambda: struct.unpack('<2i', array.array('i', [1, 2]))); t(lambda: struct.unpack('<2h', memoryview(array.array('h', [1, 2])))); t(lambda: struct.pack('3s', m[:3])); t(lambda: struct.Struct('<i').unpack_from(m, 2))
t(lambda: binascii.hexlify(m[:4])); t(lambda: binascii.hexlify(array.array('h', [1]))); t(lambda: binascii.crc32(m[:4]) == binascii.crc32(bytes(b[:4]))); t(lambda: binascii.b2a_base64(m[:3])); t(lambda: binascii.hexlify(m[::2])); t(lambda: binascii.unhexlify(memoryview(b'6162')))
t(lambda: array.array('B', memoryview(b'abc'))); t(lambda: array.array('h', memoryview(b'abcd'))); t(lambda: array.array('B', memoryview(b'abcd').cast('h'))); x = array.array('h'); t(lambda: x.frombytes(memoryview(b'abcd')) or x); t(lambda: x.frombytes(memoryview(b'abcd')[::2])); t(lambda: x.extend(memoryview(b'ab')) or x); t(lambda: x.frombytes(memoryview(b'abcd').cast('h')) or x)
