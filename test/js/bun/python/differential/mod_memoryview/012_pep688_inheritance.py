# After TestPythonBufferProtocol in Lib/test/test_buffer.py.
def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)
class A(bytearray):
    def __buffer__(self, flags):
        return super().__buffer__(flags)
a = A(b'hello')
mv = memoryview(a)
print(mv.tobytes(), type(mv.obj).__name__, mv.readonly)
t(lambda: a.append(1))
mv.release()
a.append(33); print(a)

count = 0
class B(bytearray):
    def __buffer__(self, flags):
        return super().__buffer__(flags)
    def __release_buffer__(self, view):
        global count
        count += 1
        print('release', view.tobytes(), view.obj, view.readonly)
        super().__release_buffer__(view)
b = B(b'hello')
with memoryview(b) as mv:
    print(mv.tobytes(), count)
    t(lambda: b.append(1))
print(count)
b.append(33); print(b)

class A2(bytearray):
    def __buffer__(self, flags):
        return memoryview(b'other')
with memoryview(A2(b'hello')) as mv:
    print(mv.tobytes(), mv.readonly)
x = A2(b'hello'); print(bytes(x), bytearray(x), b'' + x, x + b'!', x == b'hello', x == b'other', len(x), x.find(b'l'))

raised = None
class B2(bytearray):
    def __buffer__(self, flags):
        return memoryview(b'other')
    def __release_buffer__(self, view):
        global raised
        try:
            super().__release_buffer__(view)
        except ValueError as e:
            raised = str(e)
with memoryview(B2(b'hello')) as mv:
    print(mv.tobytes(), raised)
print(raised)

class C(bytearray):
    def __release_buffer__(self, buffer):
        print('C.release', buffer.tobytes(), buffer.obj)
        super().__release_buffer__(buffer)
c = C(b'hello')
with memoryview(c) as mv:
    print(mv.tobytes(), mv.obj is c)
    t(lambda: c.append(1))
c.append(33); print(c)
print(bytes(c), c + b'x')

smuggled = None
class D(bytearray):
    def __release_buffer__(s, buffer):
        global smuggled
        t(lambda: memoryview(buffer)); t(lambda: buffer.cast('b')); t(lambda: buffer.toreadonly()); t(lambda: buffer[:1]); t(lambda: buffer.__buffer__(0)); t(lambda: bytes(buffer)); t(lambda: b'' + buffer)
        t(lambda: buffer[0]); t(lambda: buffer.tolist()); t(lambda: len(buffer)); t(lambda: list(buffer)); t(lambda: buffer == b'hello'); t(lambda: buffer.hex()); t(lambda: buffer.readonly)
        smuggled = buffer
        print(buffer.tobytes())
        super().__release_buffer__(buffer)
        print(buffer.tobytes())
d = D(b'hello')
with memoryview(d) as mv:
    print(mv.tobytes())
d.clear()
t(lambda: smuggled.tobytes())

ba = bytearray(b'hello')
class E:
    def __buffer__(self, flags): return memoryview(ba)
    def __release_buffer__(self, buffer): self.buffer = buffer
e = E()
with memoryview(e) as mv:
    print(mv.tobytes())
print(e.buffer.tobytes())
t(lambda: ba.clear())
e.buffer.release()
ba.clear(); print(ba)

class MA:
    def __buffer__(self, flags): return memoryview(b'hello A')
class MB(MA, bytearray):
    def __buffer__(self, flags): return super().__buffer__(flags)
with memoryview(MB(b'hello')) as mv:
    print(mv.tobytes())
class Releaser:
    buffer = None
    def __release_buffer__(self, buffer): self.buffer = buffer
class MC(Releaser, bytearray):
    def __buffer__(self, flags): return super().__buffer__(flags)
c = MC(b'hello C')
with memoryview(c) as mv:
    print(mv.tobytes())
c.clear()
t(lambda: c.buffer.tobytes())
class RA:
    def __buffer__(self, flags): raise RuntimeError('should not be called')
    def __release_buffer__(self, buffer): raise RuntimeError('should not be called')
class RB(bytearray, RA):
    def __buffer__(self, flags): return super().__buffer__(flags)
with memoryview(RB(b'hello')) as mv:
    print(mv.tobytes())
class RC(bytearray, Releaser):
    def __buffer__(self, flags): return super().__buffer__(flags)
c = RC(b'hello')
with memoryview(c) as mv:
    print(mv.tobytes())
c.clear()
print(c.buffer)

class X:
    def __buffer__(self, flags): return memoryview(bytes(8))
    def __release_buffer__(self, view): print('X.release')
b = bytearray(8)
with memoryview(b):
    t(lambda: b.extend(X()))
b.extend(X()); print(len(b))

# bytes
class Y(bytes):
    def __buffer__(self, flags):
        print('Y.buffer', flags)
        return super().__buffer__(flags)
    def __release_buffer__(self, view):
        print('Y.release', view.tobytes(), view.obj)
y = Y(b'yy')
with memoryview(y) as mv:
    print(mv.tobytes(), type(mv.obj).__name__)
print(bytes(y), b'' + y, y + b'', bytearray(y), b'-'.join([y, y]))
class Y2(bytes):
    def __release_buffer__(self, view):
        print('Y2.release', view.tobytes(), view.obj, view.readonly)
with memoryview(Y2(b'y2')) as mv:
    print(mv.tobytes(), type(mv.obj).__name__)

# what __release_buffer__ raises goes nowhere
import sys
def hook(u): print('unraisable', u.exc_type.__name__, u.exc_value, u.err_msg, u.object)
sys.unraisablehook = hook
class Z:
    def __buffer__(self, flags): return memoryview(b'z')
    def __release_buffer__(self, view): raise KeyError('zz')
with memoryview(Z()) as mv:
    print(mv.tobytes())
print(bytes(Z()))
class Z2(bytearray):
    def __release_buffer__(self, view): raise KeyError('z2')
with memoryview(Z2(b'a')) as mv:
    print(mv.tobytes())
print('done')
