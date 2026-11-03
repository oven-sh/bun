import pickle, gc, weakref, array
from pickle import PickleBuffer as P
def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)
def attrs(m):
    return (m.tobytes(), m.nbytes, m.readonly, m.itemsize, m.format, m.ndim, m.shape, m.strides, m.c_contiguous, m.f_contiguous)
t(lambda: P()); t(lambda: P(1, 2)); t(lambda: P(x=1)); t(lambda: P(b'a', x=1)); t(lambda: P(1)); t(lambda: P('a'))
print(P, P.__module__, P.__name__, P.__qualname__, P.__doc__, sorted(set(dir(P)) - set(dir(object))))
def sub():
    class S(P): pass
t(sub)
for src in (b'abc', bytearray(b'abc'), memoryview(b'abcd').cast('h'), array.array('i', [1, 2]), memoryview(bytes(range(12))).cast('B', (3, 4)), memoryview(b'a').cast('B', ()), b''):
    p = P(src)
    m = memoryview(p)
    print(attrs(m), m.obj is src, attrs(p.raw()), p.raw().obj is src, bytes(p), bytearray(p) == bytes(p))
    m.release(); p.release(); p.release()
    t(lambda: memoryview(p)); t(lambda: p.raw()); t(lambda: bytes(p))
t(lambda: P(memoryview(b'abcdef')[::2]).raw()); t(lambda: bytes(P(memoryview(b'abcdef')[::2]))); t(lambda: P(memoryview(b'abcdef')[::-1]).raw()); t(lambda: attrs(P(memoryview(b'abcdef')[2:4]).raw()))
b = bytearray(b'abc'); p = P(b)
t(lambda: b.append(1)); r = p.raw(); p.release(); t(lambda: b.append(1)); r[0] = 65; r.release(); b.append(1); print(b)
p = P(b); del p; b.append(2); print(b)
p = P(b); w = weakref.ref(p); print(w() is p); del p; gc.collect(); b.append(3); print(b)
class A:
    def __buffer__(self, flags): return memoryview(b'abc')
t(lambda: memoryview(P(A()))); t(lambda: P(A()).raw())
t(lambda: P(b'a') == P(b'a')); t(lambda: len(P(b'a'))); t(lambda: P(b'a')[0]); t(lambda: P(b'a').__buffer__(0).tobytes()); t(lambda: P(b'a').__buffer__(1))
# protocol 5
for proto in range(0, 6):
    t(lambda: pickle.dumps(P(b'abc'), proto))
t(lambda: pickle.loads(pickle.dumps(P(b'abc'), 5))); t(lambda: pickle.loads(pickle.dumps(P(bytearray(b'abc')), 5))); t(lambda: pickle.loads(pickle.dumps(bytearray(b'abc'), 5)))
bufs = []
d = pickle.dumps([P(b'abc'), P(bytearray(b'xyz'))], 5, buffer_callback=bufs.append)
print(d, [bytes(x) for x in bufs], [type(x).__name__ for x in bufs])
t(lambda: [type(x).__name__ for x in pickle.loads(d, buffers=bufs)]); t(lambda: pickle.loads(d, buffers=[b'1', bytearray(b'2')])); t(lambda: pickle.loads(d)); t(lambda: pickle.loads(d, buffers=[]))
x = pickle.loads(d, buffers=bufs); print(x[0] == b'abc', type(x[0]).__name__, type(x[1]).__name__)
