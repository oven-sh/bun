# A view that is dropped without being released stops holding the exporter: at once in CPython; here, when a resize that
# finds exports has the collector look.
import gc
def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)
def churn(n=12, *args):
    return churn(n - 1, None, None, None, None) if n else gc.collect() and None
def soon(f):
    return f()
b = bytearray(b'abc')
m = memoryview(b)
del m
soon(lambda: b.append(1)); print(b)
def f():
    m = memoryview(b); s = m[1:]; c = s.cast('b'); r = m.toreadonly()
    return len(s)
print(f())
soon(lambda: b.append(2)); print(b)
m = memoryview(b); s = m[1:]; m.release(); del s
soon(lambda: b.append(3)); print(b)
m = memoryview(b); s = m[1:]; del m
t(lambda: b.append(4))
churn()
t(lambda: b.append(4))
print(s.tobytes())
del s
soon(lambda: b.append(4)); print(b)
memoryview(b)
soon(lambda: b.pop()); print(b)
for i in range(5):
    memoryview(b)[i:]
    soon(lambda: b.append(i))
print(b)
[memoryview(b) for _ in range(10)]
soon(lambda: b.clear()); print(b)
b.extend(b'xyz')
it = iter(memoryview(b)); next(it)
t(lambda: b.append(1))
del it
soon(lambda: b.append(1)); print(b)
for x in memoryview(b): pass
soon(lambda: b.append(2)); print(b)
print(bytes(memoryview(b)), memoryview(b).tolist(), memoryview(b)[1], memoryview(b).hex()); soon(lambda: b.append(3)); print(b)
def readexactly(n):
    data = bytes(memoryview(b)[:n])
    del b[:n]
    return data
print(soon(lambda: readexactly(2)), b)

class A:
    def __buffer__(self, flags): return memoryview(b)
m = memoryview(A())
t(lambda: b.append(1))
del m
soon(lambda: b.append(4)); print(b)
print(bytes(A())); soon(lambda: b.append(5)); print(b)
with memoryview(A()) as m: pass
soon(lambda: b.append(6)); print(b)
m = memoryview(b).__buffer__(0).__buffer__(0)
t(lambda: b.append(1))
del m
soon(lambda: b.append(7)); print(b)

# cycles
class Node: pass
n = Node(); n.view = memoryview(b); n.self = n
t(lambda: b.append(1))
del n
gc.collect()
soon(lambda: b.append(8)); print(b)

# __release_buffer__ of a dropped view is called in the end
calls = []
class R(bytearray):
    def __release_buffer__(self, view):
        calls.append(view.tobytes())
        super().__release_buffer__(view)
r = R(b'rr')
m = memoryview(r)
del m
for i in range(10):
    if not calls: churn()
print(calls)
r.append(1); print(r)
class W:
    def __buffer__(self, flags): return memoryview(b'w')
    def __release_buffer__(self, view): calls.append(('W', view.tobytes()))
m = memoryview(W())
del m
for i in range(10):
    if len(calls) < 2: churn()
print(calls)
