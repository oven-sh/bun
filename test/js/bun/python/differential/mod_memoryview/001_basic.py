def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)

def attrs(m):
    return (m.nbytes, m.readonly, m.itemsize, m.format, m.ndim, m.shape, m.strides, m.suboffsets, m.c_contiguous, m.f_contiguous, m.contiguous)

print(memoryview, type(memoryview), memoryview.__name__, memoryview.__module__, memoryview.__qualname__, memoryview.__mro__, memoryview.__doc__)
print(sorted(set(dir(memoryview)) - set(dir(object))))
print(sorted(k for k in memoryview.__dict__))
for src in (b'', b'a', b'abc', bytearray(), bytearray(b'hello'), bytes(range(256))):
    m = memoryview(src)
    print(type(m).__name__, attrs(m), len(m), m.obj is src, m.tobytes() == bytes(src), m.tolist() == list(src), bytes(m) == bytes(src), bytearray(m) == src, list(m) == list(src))
t(lambda: memoryview())
t(lambda: memoryview(1))
t(lambda: memoryview('abc'))
t(lambda: memoryview(None))
t(lambda: memoryview([1, 2]))
t(lambda: memoryview(b'a', b'b'))
t(lambda: memoryview(object=b'ab').tobytes())
t(lambda: memoryview(obj=b'ab'))
t(lambda: memoryview(b'ab', x=1))
class S(memoryview): pass
