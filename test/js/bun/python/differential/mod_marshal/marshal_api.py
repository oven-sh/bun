import marshal, io
def t(f, *a, **k):
    try:
        print(repr(f(*a, **k)))
    except BaseException as e:
        print(type(e).__name__ + ':', e)

t(marshal.dumps)
t(marshal.dumps, 1, 2, 3)
t(marshal.dumps, 1, version=2)
t(marshal.dumps, value=1)
t(marshal.dumps, 1, 'x')
t(marshal.dumps, 1, 2.0)
t(marshal.dumps, 1, None)
t(marshal.dumps, 1, 2**40)
t(marshal.dumps, 1, True)
t(marshal.dumps, 1, 2, allow_code=False)
t(marshal.dumps, 1, 2, allow_code=0)
t(marshal.dumps, 1, 2, allow_code=[])
t(marshal.dumps, 1, 2, False)
t(marshal.dumps, 1, allow=1)
t(marshal.loads)
t(marshal.loads, 'abc')
t(marshal.loads, 1)
t(marshal.loads, None)
t(marshal.loads, [1])
t(marshal.loads, b'N', 1)
t(marshal.loads, b'N', allow_code=False)
t(marshal.loads, bytes=b'N')
t(marshal.loads, b'N', nope=1)
t(marshal.dump)
t(marshal.dump, 1)
t(marshal.dump, 1, None)
t(marshal.dump, 1, 5)
t(marshal.load)
t(marshal.load, None)
t(marshal.load, 5)
t(marshal.load, b'N')

code = (lambda: 1).__code__
t(marshal.dumps, code, allow_code=False)
t(marshal.dumps, [1, (code,)], allow_code=False)
t(marshal.dumps, {code}, allow_code=False)
t(marshal.loads, b'c' + b'\x00' * 40, allow_code=False)
t(marshal.loads, b'[\x01\x00\x00\x00\xe3' + b'\x00' * 40, allow_code=False)

# Files
f = io.BytesIO()
print(marshal.dump([1, 'two', 3.0, (4,), {5: 6}], f), marshal.dump('next', f), marshal.dump(2**70, f, 2), marshal.dump(None, f, 0, allow_code=False))
print(f.getvalue() == marshal.dumps([1, 'two', 3.0, (4,), {5: 6}]) + marshal.dumps('next') + marshal.dumps(2**70, 2) + b'N')
f.seek(0)
print(marshal.load(f), marshal.load(f), marshal.load(f), marshal.load(f, allow_code=False), f.tell() == len(f.getvalue()))
t(marshal.load, f)
f = io.BytesIO(b'[\x02\x00\x00\x00N'); t(marshal.load, f)
f = io.BytesIO(b's\x05\x00\x00\x00ab'); t(marshal.load, f)
f = io.BytesIO(b'i\x01'); t(marshal.load, f)
f = io.BytesIO(b'z'); t(marshal.load, f)
f = io.BytesIO(b'q'); t(marshal.load, f)
f = io.BytesIO(b'0'); t(marshal.load, f)
t(marshal.load, io.StringIO('N'))

class W:
    def write(self, b):
        print('write', type(b).__name__, b)
        return 'written'
t(marshal.dump, (1, 2), W(), 2)
class BadW:
    def write(self, b): raise OSError('disk full')
t(marshal.dump, 1, BadW())
t(marshal.dump, len, W())

class R:
    def __init__(self, data): self.data = data; self.log = []
    def read(self, n):
        self.log.append(('read', n)); return b''
    def readinto(self, buf):
        self.log.append(('readinto', type(buf).__name__, len(buf), buf.readonly if isinstance(buf, memoryview) else None))
        n = len(buf); buf[:] = self.data[:n]; self.data = self.data[n:]
        return n
r = R(marshal.dumps(['ab', 5, b'xyz'], 2)); t(marshal.load, r); print(r.log)
class NoReadinto:
    def read(self, n): return b''
t(marshal.load, NoReadinto())
class StrRead:
    def read(self, n): return ''
t(marshal.load, StrRead())
class NoneRead:
    def read(self, n): return None
t(marshal.load, NoneRead())
class TooMuch(io.BytesIO):
    def readinto(self, buf):
        n = super().readinto(buf)
        return n + 10**6 if n > 4 else n
t(marshal.load, TooMuch(marshal.dumps(b'hello world', 2)))
class Short(io.BytesIO):
    def readinto(self, buf):
        return super().readinto(buf) - 1
t(marshal.load, Short(b'N'))
class Weird(io.BytesIO):
    def readinto(self, buf):
        super().readinto(buf); return 'x'
t(marshal.load, Weird(b'N'))
class Huge(io.BytesIO):
    def readinto(self, buf):
        super().readinto(buf); return 2**70
t(marshal.load, Huge(b'N'))
class Raises(io.BytesIO):
    def readinto(self, buf): raise KeyError('k')
t(marshal.load, Raises(b'N'))
class Idx:
    def __index__(self): return 1
class IndexRead(io.BytesIO):
    def readinto(self, buf):
        super().readinto(buf); return Idx()
t(marshal.load, IndexRead(b'N'))

# A set that changes while it is written
class Buf:
    def __init__(self, s): self.s = s
    def __buffer__(self, flags):
        self.s.add(len(self.s) + 100)
        return memoryview(b'x')
    def __hash__(self): return 1
s = set(); s.add(Buf(s)); s.add(1)
t(marshal.dumps, s)
class Buf2:
    def __buffer__(self, flags): raise RuntimeError('no buffer')
t(marshal.dumps, Buf2())
t(marshal.dumps, [1, Buf2()])
class Buf3:
    def __buffer__(self, flags): return memoryview(b'from buffer')
t(marshal.loads, marshal.dumps(Buf3()))
t(marshal.loads, marshal.dumps([Buf3(), {1: Buf3()}]))
print(marshal.dumps.__name__, marshal.dumps.__module__, marshal.__name__, type(marshal.dumps).__name__)
