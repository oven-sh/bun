import select, os, time
def t(f):
    try: print(repr(f()))
    except BaseException as x: print(type(x).__name__ + ':', x)
r, w = os.pipe()
print(select.select([r], [w], [r, w], 0) == ([], [w], []))
os.write(w, b'x')
print(select.select([r], [w], [], 0) == ([r], [w], []))
print(select.select([r], [], [], None) == ([r], [], []))
print(select.select((r,), (), ()) == ([r], [], []))
print(select.select(iter([r]), {w: 1}, set(), 1.5) == ([r], [w], []))
class F:
    def __init__(self, fd): self.fd = fd
    def fileno(self): return self.fd
f = F(r)
res = select.select([f, r], [], [], 0)
print(res[0][0] is f, res[0][1] == r, len(res[0]))
os.read(r, 1)
t0 = time.monotonic(); print(select.select([r], [], [], 0.05)); d = time.monotonic() - t0; print(0.045 <= d < 2)
t0 = time.monotonic(); print(select.select([], [], [], 0.03)); d = time.monotonic() - t0; print(0.025 <= d < 2)
t(lambda: select.select(1, [], []))
t(lambda: select.select([], 2, []))
t(lambda: select.select([], [], None))
t(lambda: select.select([], [], [], 'x'))
t(lambda: select.select([], [], [], -1))
t(lambda: select.select([], [], [], -0.001))
t(lambda: select.select([], [], [], float('nan')))
t(lambda: select.select([], [], [], 1e100))
t(lambda: select.select([], [], [], 10**30))
t(lambda: select.select([-1], [], [], 0))
t(lambda: select.select([1024], [], [], 0))
t(lambda: select.select([10**20], [], [], 0))
t(lambda: select.select(['a'], [], [], 0))
t(lambda: select.select([1.5], [], [], 0))
t(lambda: select.select([None], [], [], 0))
t(lambda: select.select([F('x')], [], [], 0))
t(lambda: select.select([F(-5)], [], [], 0))
t(lambda: select.select([]))
t(lambda: select.select([], [], [], 0, 0))
t(lambda: select.select(rlist=[], wlist=[], xlist=[]))
class Bad:
    def fileno(self): raise KeyError('boom')
t(lambda: select.select([Bad()], [], [], 0))
def gen():
    yield r
    raise ValueError('in generator')
t(lambda: select.select(gen(), [], [], 0))
os.close(r); os.close(w)
t(lambda: select.select([r], [], [], 0))
class I:
    def __index__(self): return 0
print(select.select([], [], [], I()))
import fractions, decimal
print(select.select([], [], [], True))
t(lambda: select.select([], [], [], fractions.Fraction(1, 100)))
t(lambda: select.select([], [], [], decimal.Decimal('0.01')))
a = []
class M:
    def fileno(self):
        del a[-1]
        return 1
a[:] = [M()] * 10
r = select.select([], a, [], 0); print(len(r[1]), len(a), r[1] == a[:5])
